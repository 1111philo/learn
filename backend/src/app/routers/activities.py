import logging
from datetime import datetime, timezone

from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.orm import selectinload
from sqlalchemy.orm.attributes import flag_modified
from sse_starlette.sse import EventSourceResponse

from app.auth.dependencies import get_current_user
from app.db.models import Activity, Lesson, User
from app.db.session import get_db_session
from app.schemas.activity import (
    ActivityResponse,
    ActivitySubmitRequest,
    ActivitySubmitResponse,
)
from app.services.activity_review import review_activity_background, review_key
from app.services.generation_tracker import is_running
from app.services.sse import kickoff_background_task, sse_event_generator

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/api/activities", tags=["activities"])


def _build_review_data(activity: Activity) -> dict:
    """Build the review_complete payload from an Activity row."""
    fb = activity.latest_feedback or {}
    return {
        "score": activity.latest_score,
        "mastery_decision": activity.mastery_decision,
        "rationale": fb.get("rationale", ""),
        "strengths": fb.get("strengths", []),
        "improvements": fb.get("improvements", []),
        "tips": fb.get("tips", []),
    }


@router.get("/by-lesson/{lesson_id}", response_model=list[ActivityResponse])
async def list_activities_for_lesson(
    lesson_id: str,
    user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db_session),
):
    result = await db.execute(
        select(Lesson)
        .where(Lesson.id == lesson_id)
        .options(
            selectinload(Lesson.course_instance),
            selectinload(Lesson.activities),
        )
    )
    lesson = result.scalar_one_or_none()
    if not lesson or lesson.course_instance.user_id != user.id:
        raise HTTPException(status_code=404, detail="Lesson not found")

    return [
        ActivityResponse(
            id=a.id,
            activity_index=a.activity_index,
            activity_status=a.activity_status,
            activity_spec=a.activity_spec,
            latest_score=a.latest_score,
            latest_feedback=a.latest_feedback,
            mastery_decision=a.mastery_decision,
            attempt_count=a.attempt_count,
            submissions=a.submissions or [],
            reviewing=is_running(review_key(a.id)),
            portfolio_readiness=a.portfolio_readiness,
            revision_count=a.revision_count,
            portfolio_artifact_id=a.portfolio_artifact_id,
        )
        for a in sorted(lesson.activities, key=lambda x: x.activity_index)
    ]


@router.get("/{activity_id}", response_model=ActivityResponse)
async def get_activity(
    activity_id: str,
    user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db_session),
):
    result = await db.execute(
        select(Activity)
        .where(Activity.id == activity_id)
        .options(
            selectinload(Activity.lesson).selectinload(Lesson.course_instance)
        )
    )
    activity = result.scalar_one_or_none()
    if not activity:
        raise HTTPException(status_code=404, detail="Activity not found")

    if activity.lesson.course_instance.user_id != user.id:
        raise HTTPException(status_code=404, detail="Activity not found")

    key = review_key(activity_id)
    return ActivityResponse(
        id=activity.id,
        activity_index=activity.activity_index,
        activity_status=activity.activity_status,
        activity_spec=activity.activity_spec,
        latest_score=activity.latest_score,
        latest_feedback=activity.latest_feedback,
        mastery_decision=activity.mastery_decision,
        attempt_count=activity.attempt_count,
        submissions=activity.submissions or [],
        reviewing=is_running(key),
        portfolio_readiness=activity.portfolio_readiness,
        revision_count=activity.revision_count,
        portfolio_artifact_id=activity.portfolio_artifact_id,
    )


@router.post("/{activity_id}/submit", response_model=ActivitySubmitResponse)
async def submit_activity(
    activity_id: str,
    req: ActivitySubmitRequest,
    user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db_session),
):
    key = review_key(activity_id)

    result = await db.execute(
        select(Activity)
        .where(Activity.id == activity_id)
        .options(
            selectinload(Activity.lesson).selectinload(Lesson.course_instance)
        )
    )
    activity = result.scalar_one_or_none()
    if not activity:
        raise HTTPException(status_code=404, detail="Activity not found")

    lesson = activity.lesson
    course = lesson.course_instance

    if course.user_id != user.id:
        raise HTTPException(status_code=404, detail="Activity not found")

    spec = activity.activity_spec or {}
    objective = (
        course.input_objectives[lesson.objective_index]
        if lesson.objective_index < len(course.input_objectives)
        else ""
    )

    submissions = list(activity.submissions or [])
    submissions.append({
        "text": req.text,
        "submitted_at": datetime.now(timezone.utc).isoformat(),
    })
    activity.submissions = submissions
    flag_modified(activity, "submissions")
    await db.flush()
    await db.commit()

    kickoff_background_task(
        key,
        review_activity_background(
            activity_id=activity_id,
            user_id=user.id,
            submission_text=req.text,
            objective=objective,
            activity_prompt=spec.get("prompt", ""),
            scoring_rubric=spec.get("scoring_rubric", []),
            course_id=course.id,
            professional_quality_checklist=spec.get("professional_quality_checklist"),
        ),
        conflict_detail="Review already in progress",
    )

    return ActivitySubmitResponse(id=activity_id, status="reviewing")


@router.get("/{activity_id}/review-stream")
async def review_stream(
    activity_id: str,
    user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db_session),
):
    key = review_key(activity_id)

    result = await db.execute(
        select(Activity)
        .where(Activity.id == activity_id)
        .options(
            selectinload(Activity.lesson).selectinload(Lesson.course_instance)
        )
    )
    activity = result.scalar_one_or_none()
    if not activity:
        raise HTTPException(status_code=404, detail="Activity not found")
    if activity.lesson.course_instance.user_id != user.id:
        raise HTTPException(status_code=404, detail="Activity not found")

    if not is_running(key):
        db.expire_all()
        result_fresh = await db.execute(
            select(Activity).where(Activity.id == activity_id)
        )
        activity = result_fresh.scalar_one()

    has_feedback = activity.latest_feedback is not None and activity.latest_score is not None

    async def _timeout_fallback():
        db.expire_all()
        result_inner = await db.execute(
            select(Activity).where(Activity.id == activity_id)
        )
        act = result_inner.scalar_one_or_none()
        if act and act.latest_feedback and act.latest_score is not None:
            return {"event": "review_complete", "data": _build_review_data(act)}
        return None

    return EventSourceResponse(sse_event_generator(
        key,
        is_done=has_feedback and not is_running(key),
        done_event={"event": "review_complete", "data": _build_review_data(activity)},
        not_started_event={"event": "review_error", "data": {"error": "No review in progress"}},
        terminal_events={"review_complete", "review_error"},
        on_timeout_fallback=_timeout_fallback,
    ))
