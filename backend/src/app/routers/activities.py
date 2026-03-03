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
        activity_spec=activity.activity_spec,
        latest_score=activity.latest_score,
        latest_feedback=activity.latest_feedback,
        mastery_decision=activity.mastery_decision,
        attempt_count=activity.attempt_count,
        submissions=activity.submissions or [],
        reviewing=is_running(key),
    )


@router.post("/{activity_id}/submit", response_model=ActivitySubmitResponse)
async def submit_activity(
    activity_id: str,
    req: ActivitySubmitRequest,
    user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db_session),
):
    key = review_key(activity_id)

    # Load activity with its lesson and course
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

    # Save submission before spawning background task
    submissions = list(activity.submissions or [])
    submissions.append({
        "text": req.text,
        "submitted_at": datetime.now(timezone.utc).isoformat(),
    })
    activity.submissions = submissions
    flag_modified(activity, "submissions")
    await db.flush()
    await db.commit()

    is_capstone = lesson.lesson_role in ("capstone", None)  # null = legacy capstone

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
            is_capstone=is_capstone,
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

    # Verify activity exists and belongs to user
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

    # If no review is running, re-query for fresh state to avoid serving
    # stale feedback from a previous attempt (race with background task commit)
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
