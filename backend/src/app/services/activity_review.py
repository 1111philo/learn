"""Background task for reviewing activity submissions via LLM."""

import logging

from sqlalchemy import select
from sqlalchemy.orm import selectinload

from app.agents.activity_reviewer import run_activity_reviewer
from app.agents.logging import AgentContext
from app.db.models import Activity, CourseInstance, Lesson
from app.db.session import get_background_session
from app.services.generation import generate_objective_on_demand
from app.services.generation_tracker import broadcast, is_running, start_generation
from app.services.progression import (
    check_all_lessons_completed,
    transition_course,
    unlock_next_sub_lesson,
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
    is_capstone: bool = True,
) -> None:
    """Background task that reviews an activity submission via LLM.

    Args:
        is_capstone: If True, mastery gate applies (≥70 required to advance).
                     If False (focused sub-lesson), any attempt marks lesson complete.
    """
    key = review_key(activity_id)

    # Capture generation data before entering the DB session
    next_objective_to_generate: tuple[int, list[str], str, dict | None] | None = None

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

            # Determine gate: focused = attempt-gated, capstone = mastery-gated
            lesson_role = lesson.lesson_role or "capstone"  # null = legacy capstone
            advance = False

            if lesson_role == "focused":
                # Any reviewed attempt marks the focused lesson as complete
                if lesson.status != "completed":
                    advance = True
            else:
                # Capstone: require meets or exceeds
                if lesson.status != "completed" and review.mastery_decision in ("meets", "exceeds"):
                    advance = True

            if advance:
                lesson.status = "completed"
                next_lesson = await unlock_next_sub_lesson(db, course_id, lesson)

                # For capstone completions only: check if the next objective needs generation
                if lesson_role != "focused" and next_lesson and next_lesson.lesson_content is None:
                    next_objective_to_generate = (
                        next_lesson.objective_index,
                        list(course.input_objectives),
                        course.generated_description or course.input_description or "",
                        course.diagnostic_analysis,
                    )

                # Check if ALL lessons across the whole course are now completed
                if lesson_role != "focused" and await check_all_lessons_completed(db, course.id):
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

        # Kick off on-demand generation for next objective after the session has committed
        if next_objective_to_generate:
            next_index, objectives, description, diagnostic_analysis = next_objective_to_generate
            gen_key = f"objective-gen-{course_id}-{next_index}"
            if not is_running(gen_key):
                logger.info(
                    "Scheduling on-demand generation for course [%s] obj[%d]",
                    course_id[:8], next_index,
                )
                start_generation(gen_key, generate_objective_on_demand(
                    course_id=course_id,
                    user_id=user_id,
                    objective_index=next_index,
                    objectives=objectives,
                    description=description,
                    diagnostic_analysis=diagnostic_analysis,
                ))

        # Broadcast review result AFTER commit
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
