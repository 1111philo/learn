"""Background task for reviewing activity submissions via LLM."""

import logging

from sqlalchemy import select
from sqlalchemy.orm import selectinload

from app.agents.activity_reviewer import run_activity_reviewer
from app.agents.logging import AgentContext
from app.db.models import Activity, CourseInstance, Lesson
from app.db.session import get_background_session
from app.services.generation_tracker import broadcast
from app.services.progression import (
    check_all_lessons_completed,
    transition_course,
    unlock_next_lesson,
)

logger = logging.getLogger(__name__)


def review_key(activity_id: str) -> str:
    return f"activity-review-{activity_id}"


async def review_activity_background(
    activity_id: str,
    user_id: str,
    submission_text: str,
    objective: str,
    activity_prompt: str,
    scoring_rubric: list[str],
    course_id: str,
) -> None:
    """Background task that reviews an activity submission via LLM."""
    key = review_key(activity_id)

    try:
        async with get_background_session() as db:
            ctx = AgentContext(db=db, user_id=user_id, course_instance_id=course_id)

            review = await run_activity_reviewer(
                ctx,
                submission_text=submission_text,
                objective=objective,
                activity_prompt=activity_prompt,
                scoring_rubric=scoring_rubric,
            )

            # Load activity with lesson and course for updates
            result = await db.execute(
                select(Activity)
                .where(Activity.id == activity_id)
                .options(
                    selectinload(Activity.lesson).selectinload(Lesson.course_instance)
                )
            )
            activity = result.scalar_one()
            lesson = activity.lesson
            course = lesson.course_instance

            # Update activity record
            activity.latest_score = review.score
            activity.latest_feedback = {
                "rationale": review.rationale,
                "strengths": review.strengths,
                "improvements": review.improvements,
                "tips": review.tips,
            }
            activity.mastery_decision = review.mastery_decision
            activity.attempt_count += 1

            # Mark lesson as completed and unlock next (only if mastery met)
            if lesson.status != "completed" and review.mastery_decision in ("meets", "exceeds"):
                lesson.status = "completed"
                await unlock_next_lesson(db, course.id)

                if await check_all_lessons_completed(db, course.id):
                    result = await db.execute(
                        select(CourseInstance)
                        .where(CourseInstance.id == course.id)
                        .options(
                            selectinload(CourseInstance.lessons),
                            selectinload(CourseInstance.assessments),
                        )
                    )
                    course = result.scalar_one()
                    try:
                        await transition_course(db, course, "awaiting_assessment")
                    except Exception:
                        pass

            await db.flush()
            await db.commit()

        # Broadcast AFTER commit
        await broadcast(key, "review_complete", {
            "score": review.score,
            "mastery_decision": review.mastery_decision,
            "rationale": review.rationale,
            "strengths": review.strengths,
            "improvements": review.improvements,
            "tips": review.tips,
        })

    except Exception:
        logger.exception("Error reviewing activity %s", activity_id)
        await broadcast(key, "review_error", {"error": "Failed to review submission"})
