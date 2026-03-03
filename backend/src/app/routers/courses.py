from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.orm import selectinload
from sse_starlette.sse import EventSourceResponse

from app.agents.diagnostic import run_diagnostic_analyzer
from app.agents.logging import AgentContext
from app.auth.dependencies import get_current_user
from app.db.models import CourseInstance, Lesson, User
from app.db.session import get_db_session
from app.schemas.diagnostic import DiagnosticSubmitRequest
from app.services.generation import generate_course_background, generate_diagnostic
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

    # Transition to awaiting_diagnostic and commit before running LLM call
    await transition_course(db, course, "awaiting_diagnostic")
    await db.commit()

    # Generate diagnostic questions synchronously (fast model, quick)
    diagnostic_spec = await generate_diagnostic(course_id, user.id)

    return {
        "id": course.id,
        "status": "awaiting_diagnostic",
        "diagnostic_spec": diagnostic_spec,
    }


@router.get("/{course_id}/diagnostic", response_model=dict)
async def get_diagnostic(
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

    return {
        "status": course.status,
        "diagnostic_spec": course.diagnostic_spec,
    }


@router.post("/{course_id}/diagnostic/submit", response_model=dict)
async def submit_diagnostic(
    course_id: str,
    req: DiagnosticSubmitRequest,
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

    if course.status != "awaiting_diagnostic":
        raise HTTPException(
            status_code=400,
            detail=f"Course must be in 'awaiting_diagnostic' state, got '{course.status}'",
        )

    # Store responses and commit
    course.diagnostic_responses = req.responses
    await db.flush()
    await db.commit()

    # Analyze responses synchronously (fast model)
    ctx = AgentContext(db=db, user_id=user.id, course_instance_id=course_id)
    analysis = await run_diagnostic_analyzer(
        ctx,
        objectives=list(course.input_objectives),
        course_description=course.input_description or "",
        diagnostic_spec=course.diagnostic_spec or {},
        responses=req.responses,
    )

    # Store analysis, transition to generating, commit
    result = await db.execute(
        select(CourseInstance).where(CourseInstance.id == course_id)
    )
    course = result.scalar_one()
    course.diagnostic_analysis = analysis.model_dump()
    await transition_course(db, course, "generating")
    await db.commit()

    profile_dict = user.learner_profile.to_agent_dict() if user.learner_profile else None
    objectives = list(course.input_objectives)
    description = course.input_description or ""
    diagnostic_analysis = analysis.model_dump()

    kickoff_background_task(
        course_id,
        generate_course_background(
            course_id=course_id,
            user_id=user.id,
            objectives=objectives,
            description=description,
            learner_profile=profile_dict,
            diagnostic_analysis=diagnostic_analysis,
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

    # Build catchup events from lessons already in DB (one lesson_planned per objective)
    seen_objectives: set[int] = set()
    catchup_events: list[dict] = []
    for lesson in sorted(course.lessons, key=lambda l: (l.objective_index, l.sub_lesson_index)):
        obj_idx = lesson.objective_index
        if obj_idx not in seen_objectives:
            seen_objectives.add(obj_idx)
            catchup_events.append({
                "event": "lesson_planned",
                "data": {
                    "objective_index": obj_idx,
                    "objective_title": lesson.lesson_title,
                    "skipped": True,
                },
            })
        if lesson.lesson_content is not None:
            catchup_events.append({
                "event": "lesson_written",
                "data": {
                    "objective_index": obj_idx,
                    "sub_lesson_index": lesson.sub_lesson_index,
                    "skipped": True,
                },
            })
        if lesson.activities:
            catchup_events.append({
                "event": "activity_created",
                "data": {
                    "objective_index": obj_idx,
                    "sub_lesson_index": lesson.sub_lesson_index,
                    "activity_id": lesson.activities[0].id,
                    "lesson_role": lesson.lesson_role,
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
            "data": {"course_id": course_id, "lesson_count": len(course.lessons)},
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
    if course.status == "generating" and not is_running(course_id):
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
        status=course.status,
        diagnostic_spec=course.diagnostic_spec,
        lessons=[
            LessonResponse(
                id=l.id,
                objective_index=l.objective_index,
                sub_lesson_index=l.sub_lesson_index,
                lesson_role=l.lesson_role,
                lesson_title=l.lesson_title,
                lesson_content=l.lesson_content,
                status=l.status,
                activity=ActivitySummary(
                    id=l.activities[0].id,
                    activity_spec=l.activities[0].activity_spec,
                    latest_score=l.activities[0].latest_score,
                    latest_feedback=l.activities[0].latest_feedback,
                    mastery_decision=l.activities[0].mastery_decision,
                    attempt_count=l.activities[0].attempt_count,
                )
                if l.activities
                else None,
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
