from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.orm import selectinload
from sse_starlette.sse import EventSourceResponse

from app.auth.dependencies import get_current_user
from app.db.models import CourseInstance, Lesson, User
from app.db.session import get_db_session
from app.services.generation import generate_course_background
from app.services.generation_tracker import is_running
from app.services.sse import kickoff_background_task, sse_event_generator
from app.schemas.course import CourseCreateRequest, CourseListItem
from app.services.progression import InvalidTransitionError, transition_course

router = APIRouter(prefix="/api/courses", tags=["courses"])


@router.post("", response_model=dict)
async def create_course(
    req: CourseCreateRequest,
    user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db_session),
):
    course = CourseInstance(
        user_id=user.id,
        source_type="custom",
        input_description=req.description,
        input_objectives=req.objectives,
        status="draft",
    )
    db.add(course)
    await db.flush()
    return {"id": course.id, "status": course.status}


@router.post("/{course_id}/generate", response_model=dict)
async def trigger_generation(
    course_id: str,
    user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db_session),
):
    result = await db.execute(
        select(CourseInstance)
        .where(CourseInstance.id == course_id, CourseInstance.user_id == user.id)
        .options(selectinload(CourseInstance.lessons))
    )
    course = result.scalar_one_or_none()
    if not course:
        raise HTTPException(status_code=404, detail="Course not found")

    if course.status not in ("draft", "generation_failed"):
        raise HTTPException(
            status_code=400,
            detail=f"Course must be in 'draft' or 'generation_failed' state, got '{course.status}'",
        )

    profile_dict = user.learner_profile.to_agent_dict() if user.learner_profile else None

    # Capture plain data for the background task
    objectives = list(course.input_objectives)
    description = course.input_description or ""

    # Transition to generating and commit so the status is visible
    await transition_course(db, course, "generating")
    await db.commit()

    kickoff_background_task(
        course_id,
        generate_course_background(
            course_id=course_id,
            user_id=user.id,
            objectives=objectives,
            description=description,
            learner_profile=profile_dict,
        ),
        conflict_detail="Generation already in progress",
    )

    return {"id": course.id, "status": "generating"}


@router.get("/{course_id}/generation-stream")
async def generation_stream(
    course_id: str,
    user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db_session),
):
    user_id = user.id

    result = await db.execute(
        select(CourseInstance)
        .where(CourseInstance.id == course_id, CourseInstance.user_id == user_id)
        .options(
            selectinload(CourseInstance.lessons).selectinload(Lesson.activities)
        )
    )
    course = result.scalar_one_or_none()
    if not course:
        raise HTTPException(status_code=404, detail="Course not found")

    # Build catchup events from lessons already in DB
    existing_lessons = sorted(course.lessons, key=lambda l: l.objective_index)
    catchup_events: list[dict] = []

    # Replay course_described if Phase 0 already completed
    if course.lesson_titles:
        catchup_events.append({
            "event": "course_described",
            "data": {
                "lesson_previews": [
                    {"index": i, "title": lt["lesson_title"], "summary": lt["lesson_summary"]}
                    for i, lt in enumerate(course.lesson_titles)
                ],
                "narrative_description": course.generated_description or course.input_description or "",
            },
        })

    for lesson in existing_lessons:
        idx = lesson.objective_index
        catchup_events.append({
            "event": "lesson_planned",
            "data": {"objective_index": idx, "lesson_title": None, "skipped": True},
        })
        if lesson.lesson_content is not None:
            catchup_events.append({
                "event": "lesson_written",
                "data": {"objective_index": idx, "skipped": True},
            })
        for act in sorted(lesson.activities, key=lambda a: a.activity_index):
            catchup_events.append({
                "event": "activity_created",
                "data": {
                    "objective_index": idx,
                    "activity_id": act.id,
                    "activity_index": act.activity_index,
                    "skipped": True,
                },
            })

    is_done = not is_running(course_id) and course.status != "generating"

    async def _timeout_fallback():
        db.expire_all()
        result_inner = await db.execute(
            select(Lesson).where(Lesson.course_instance_id == course_id)
        )
        lesson_count = len(result_inner.scalars().all())
        return {
            "event": "generation_complete",
            "data": {"course_id": course_id, "lesson_count": lesson_count},
        }

    return EventSourceResponse(sse_event_generator(
        course_id,
        catchup=catchup_events or None,
        is_done=is_done,
        done_event={
            "event": "generation_complete",
            "data": {"course_id": course_id, "lesson_count": len(existing_lessons)},
        },
        terminal_events={"generation_complete"},
        on_timeout_fallback=_timeout_fallback,
    ))


@router.get("", response_model=list)
async def list_courses(
    status: str | None = None,
    user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db_session),
):
    query = (
        select(CourseInstance)
        .where(CourseInstance.user_id == user.id)
        .options(selectinload(CourseInstance.lessons))
    )
    if status:
        query = query.where(CourseInstance.status == status)
    result = await db.execute(query.order_by(CourseInstance.created_at.desc()))
    courses = result.scalars().all()

    return [
        CourseListItem(
            id=c.id,
            source_type=c.source_type,
            input_description=c.input_description,
            status=c.status,
            lesson_count=len(c.lessons),
            lessons_completed=sum(1 for l in c.lessons if l.status == "completed"),
        )
        for c in courses
    ]


@router.get("/{course_id}")
async def get_course(
    course_id: str,
    user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db_session),
):
    result = await db.execute(
        select(CourseInstance)
        .where(CourseInstance.id == course_id, CourseInstance.user_id == user.id)
        .options(
            selectinload(CourseInstance.lessons).selectinload(Lesson.activities),
            selectinload(CourseInstance.assessments),
        )
    )
    course = result.scalar_one_or_none()
    if not course:
        raise HTTPException(status_code=404, detail="Course not found")

    # Auto-heal zombie courses: stuck in "generating" with no active background task
    # Only trigger if the course has been generating for more than 10 minutes to avoid
    # false positives under slow environments (e.g. Rosetta emulation).
    if course.status == "generating" and not is_running(course_id):
        from datetime import datetime, timezone, timedelta
        age = datetime.now(timezone.utc) - (course.updated_at.replace(tzinfo=timezone.utc) if course.updated_at.tzinfo is None else course.updated_at)
        if age > timedelta(minutes=10):
            course.status = "generation_failed"
            await db.flush()
            await db.commit()

    from app.schemas.course import ActivitySummary, AssessmentSummary, CourseResponse, LessonResponse

    return CourseResponse(
        id=course.id,
        source_type=course.source_type,
        input_description=course.input_description,
        input_objectives=course.input_objectives,
        generated_description=course.generated_description,
        lesson_titles=course.lesson_titles,
        status=course.status,
        portfolio_artifact_id=course.portfolio_artifact_id,
        lessons=[
            LessonResponse(
                id=l.id,
                objective_index=l.objective_index,
                lesson_content=l.lesson_content,
                status=l.status,
                activities=[
                    ActivitySummary(
                        id=a.id,
                        activity_index=a.activity_index,
                        activity_status=a.activity_status,
                        activity_spec=a.activity_spec,
                        latest_score=a.latest_score,
                        latest_feedback=a.latest_feedback,
                        mastery_decision=a.mastery_decision,
                        attempt_count=a.attempt_count,
                        portfolio_readiness=a.portfolio_readiness,
                        revision_count=a.revision_count,
                        portfolio_artifact_id=a.portfolio_artifact_id,
                    )
                    for a in sorted(l.activities, key=lambda x: x.activity_index)
                ],
                total_activities=len(l.activities),
                completed_activities=sum(
                    1 for a in l.activities if a.activity_status == "completed"
                ),
            )
            for l in course.lessons
        ],
        assessments=[
            AssessmentSummary(
                id=a.id, status=a.status, score=a.score, passed=a.passed
            )
            for a in course.assessments
        ],
    )


@router.patch("/{course_id}/state", response_model=dict)
async def update_course_state(
    course_id: str,
    target_state: str,
    user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db_session),
):
    result = await db.execute(
        select(CourseInstance)
        .where(CourseInstance.id == course_id, CourseInstance.user_id == user.id)
        .options(
            selectinload(CourseInstance.lessons),
            selectinload(CourseInstance.assessments),
        )
    )
    course = result.scalar_one_or_none()
    if not course:
        raise HTTPException(status_code=404, detail="Course not found")

    try:
        await transition_course(db, course, target_state)
    except InvalidTransitionError as e:
        raise HTTPException(status_code=400, detail=str(e))

    return {"id": course.id, "status": course.status}


@router.delete("/{course_id}")
async def delete_course(
    course_id: str,
    user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db_session),
):
    result = await db.execute(
        select(CourseInstance)
        .where(CourseInstance.id == course_id, CourseInstance.user_id == user.id)
    )
    course = result.scalar_one_or_none()
    if not course:
        raise HTTPException(status_code=404, detail="Course not found")

    await db.delete(course)
    return {"deleted": True}
