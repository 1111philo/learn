import logging

from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.orm import selectinload
from sse_starlette.sse import EventSourceResponse

from app.auth.dependencies import get_current_user
from app.db.models import Assessment, CourseInstance, Lesson, User
from app.db.session import get_db_session
from app.schemas.assessment import AssessmentResponse, AssessmentSubmitRequest
from app.services.assessment import (
    assessment_key,
    assessment_review_key,
    generate_assessment_background,
    review_assessment_background,
)
from app.services.generation_tracker import is_running
from app.services.progression import transition_course
from app.services.sse import kickoff_background_task, sse_event_generator

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/api/assessments", tags=["assessments"])


# ---------------------------------------------------------------------------
# Endpoints
# ---------------------------------------------------------------------------


@router.post("/{course_id}/generate", response_model=dict)
async def generate_assessment(
    course_id: str,
    user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db_session),
):
    key = assessment_key(course_id)

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

    if course.status not in ("awaiting_assessment", "assessment_ready"):
        raise HTTPException(
            status_code=400,
            detail=f"Course is in '{course.status}' state, not ready for assessment",
        )

    # Gather activity scores
    activity_scores = []
    for lesson in course.lessons:
        for activity in lesson.activities:
            if activity.latest_score is not None:
                activity_scores.append({
                    "objective": course.input_objectives[lesson.objective_index]
                    if lesson.objective_index < len(course.input_objectives)
                    else "",
                    "score": activity.latest_score,
                    "mastery": activity.mastery_decision,
                })

    profile_dict = user.learner_profile.to_agent_dict() if user.learner_profile else None

    objectives = list(course.input_objectives)
    description = course.input_description or ""

    await transition_course(db, course, "generating_assessment")
    await db.commit()

    kickoff_background_task(
        key,
        generate_assessment_background(
            course_id=course_id,
            user_id=user.id,
            objectives=objectives,
            description=description,
            activity_scores=activity_scores or None,
            learner_profile=profile_dict,
        ),
        conflict_detail="Assessment generation already in progress",
    )

    return {"id": course_id, "status": "generating_assessment"}


@router.get("/{course_id}/assessment", response_model=AssessmentResponse)
async def get_assessment(
    course_id: str,
    user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db_session),
):
    result = await db.execute(
        select(CourseInstance)
        .where(CourseInstance.id == course_id, CourseInstance.user_id == user.id)
        .options(selectinload(CourseInstance.assessments))
    )
    course = result.scalar_one_or_none()
    if not course:
        raise HTTPException(status_code=404, detail="Course not found")

    # Auto-heal zombie: stuck in generating_assessment with no active task
    key = assessment_key(course_id)
    if course.status == "generating_assessment" and not is_running(key):
        course.status = "awaiting_assessment"
        await db.flush()
        await db.commit()

    assess_result = await db.execute(
        select(Assessment)
        .where(Assessment.course_instance_id == course_id)
        .order_by(Assessment.id.desc())
        .limit(1)
    )
    assessment = assess_result.scalar_one_or_none()
    if not assessment:
        raise HTTPException(status_code=404, detail="No assessment generated yet")

    # Auto-heal zombie: stuck in submitted with no active review task
    rkey = assessment_review_key(assessment.id)
    if assessment.status == "submitted" and not is_running(rkey):
        assessment.status = "pending"
        await db.flush()
        await db.commit()

    return AssessmentResponse(
        id=assessment.id,
        status=assessment.status,
        score=assessment.score,
        passed=assessment.passed,
        feedback=assessment.feedback,
        assessment_spec=assessment.assessment_spec,
    )


@router.get("/{course_id}/assessment-stream")
async def assessment_stream(
    course_id: str,
    user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db_session),
):
    key = assessment_key(course_id)

    result = await db.execute(
        select(CourseInstance)
        .where(CourseInstance.id == course_id, CourseInstance.user_id == user.id)
        .options(selectinload(CourseInstance.assessments))
    )
    course = result.scalar_one_or_none()
    if not course:
        raise HTTPException(status_code=404, detail="Course not found")

    has_assessment = bool(course.assessments)

    async def _timeout_fallback():
        db.expire_all()
        result_inner = await db.execute(
            select(Assessment)
            .where(Assessment.course_instance_id == course_id)
            .order_by(Assessment.id.desc())
            .limit(1)
        )
        latest = result_inner.scalar_one_or_none()
        if latest:
            return {"event": "assessment_complete", "data": {"assessment_id": latest.id}}
        return None

    # Build done_event eagerly if assessment already exists
    done_event = None
    if has_assessment:
        assess_result = await db.execute(
            select(Assessment)
            .where(Assessment.course_instance_id == course_id)
            .order_by(Assessment.id.desc())
            .limit(1)
        )
        latest = assess_result.scalar_one()
        done_event = {"event": "assessment_complete", "data": {"assessment_id": latest.id}}

    return EventSourceResponse(sse_event_generator(
        key,
        is_done=has_assessment,
        done_event=done_event,
        not_started_event={"event": "assessment_error", "data": {"error": "No assessment generation in progress"}},
        terminal_events={"assessment_complete", "assessment_error"},
        on_timeout_fallback=_timeout_fallback,
    ))


@router.post("/{assessment_id}/submit", response_model=dict)
async def submit_assessment(
    assessment_id: str,
    req: AssessmentSubmitRequest,
    user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db_session),
):
    review_key = assessment_review_key(assessment_id)

    result = await db.execute(
        select(Assessment)
        .where(Assessment.id == assessment_id)
        .options(selectinload(Assessment.course_instance))
    )
    assessment = result.scalar_one_or_none()
    if not assessment:
        raise HTTPException(status_code=404, detail="Assessment not found")

    course = assessment.course_instance
    if course.user_id != user.id:
        raise HTTPException(status_code=404, detail="Assessment not found")

    # Save submissions and mark as submitted
    submissions = [{"objective": r.objective, "text": r.text} for r in req.responses]
    assessment.submissions = submissions
    assessment.status = "submitted"
    await db.flush()
    await db.commit()

    kickoff_background_task(
        review_key,
        review_assessment_background(
            assessment_id=assessment_id,
            user_id=user.id,
            course_id=course.id,
            assessment_spec=assessment.assessment_spec,
            submissions=submissions,
        ),
        conflict_detail="Review already in progress",
    )

    return {"id": assessment_id, "status": "submitted"}


@router.get("/{assessment_id}/review-stream")
async def assessment_review_stream(
    assessment_id: str,
    user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db_session),
):
    review_key = assessment_review_key(assessment_id)

    result = await db.execute(
        select(Assessment)
        .where(Assessment.id == assessment_id)
        .options(selectinload(Assessment.course_instance))
    )
    assessment = result.scalar_one_or_none()
    if not assessment:
        raise HTTPException(status_code=404, detail="Assessment not found")
    if assessment.course_instance.user_id != user.id:
        raise HTTPException(status_code=404, detail="Assessment not found")

    is_reviewed = assessment.status == "reviewed"

    async def _timeout_fallback():
        db.expire_all()
        result_inner = await db.execute(
            select(Assessment).where(Assessment.id == assessment_id)
        )
        assess = result_inner.scalar_one_or_none()
        if assess and assess.status == "reviewed":
            return {"event": "review_complete", "data": {"assessment_id": assessment_id}}
        return None

    return EventSourceResponse(sse_event_generator(
        review_key,
        is_done=is_reviewed,
        done_event={"event": "review_complete", "data": {"assessment_id": assessment_id}},
        not_started_event={"event": "review_error", "data": {"error": "No review in progress"}},
        terminal_events={"review_complete", "review_error"},
        on_timeout_fallback=_timeout_fallback,
    ))
