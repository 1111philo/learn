"""Background task for reviewing activity submissions via LLM."""

import logging

from sqlalchemy import select
from sqlalchemy.orm import selectinload

from app.agents.activity_reviewer import run_activity_reviewer
from app.agents.logging import AgentContext
from app.db.models import Activity, CourseInstance, Lesson, PortfolioArtifact, User
from app.db.session import get_background_session
from app.services.generation import generate_lesson_on_demand
from app.services.generation_tracker import broadcast, is_running, start_generation
from app.services.portfolio import update_course_artifact
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
    professional_quality_checklist: list[str] | None = None,
) -> None:
    """Background task that reviews an activity submission via LLM."""
    key = review_key(activity_id)

    # Capture generation data before entering the DB session
    next_lesson_to_generate: tuple | None = None

    try:
        async with get_background_session() as db:
            ctx = AgentContext(db=db, user_id=user_id, course_instance_id=course_id)

            # Fetch current portfolio content for context
            portfolio_content_before: str | None = None
            course_result = await db.execute(
                select(CourseInstance).where(CourseInstance.id == course_id)
            )
            course_row = course_result.scalar_one()
            if course_row.portfolio_artifact_id:
                art_result = await db.execute(
                    select(PortfolioArtifact)
                    .where(PortfolioArtifact.id == course_row.portfolio_artifact_id)
                )
                art = art_result.scalar_one_or_none()
                if art:
                    portfolio_content_before = art.content_pointer

            review = await run_activity_reviewer(
                ctx,
                submission_text=submission_text,
                objective=objective,
                activity_prompt=activity_prompt,
                scoring_rubric=scoring_rubric,
                professional_quality_checklist=professional_quality_checklist,
                portfolio_content_before=portfolio_content_before,
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

            # Update portfolio readiness fields
            activity.portfolio_readiness = review.portfolio_readiness
            activity.revision_count += 1

            # Update the course's single evolving portfolio artifact
            await update_course_artifact(db, course, submission_text, review)

            # Mark lesson as completed and unlock next (only if mastery met)
            if lesson.status != "completed" and review.mastery_decision in ("meets", "exceeds"):
                completed_index = lesson.objective_index
                lesson.status = "completed"
                next_lesson = await unlock_next_lesson(db, course.id, completed_index)

                # If the unlocked lesson has no content yet, schedule on-demand generation
                if next_lesson and next_lesson.lesson_content is None:
                    # Load learner profile for personalized generation
                    profile_result = await db.execute(
                        select(User)
                        .where(User.id == user_id)
                        .options(selectinload(User.learner_profile))
                    )
                    user_obj = profile_result.scalar_one_or_none()
                    learner_profile = (
                        user_obj.learner_profile.to_agent_dict()
                        if user_obj and user_obj.learner_profile
                        else None
                    )
                    lt_list = course.lesson_titles or []
                    next_idx = next_lesson.objective_index
                    preset_title = (
                        lt_list[next_idx]["lesson_title"]
                        if next_idx < len(lt_list)
                        else None
                    )
                    lesson_summary = (
                        lt_list[next_idx]["lesson_summary"]
                        if next_idx < len(lt_list)
                        else None
                    )
                    next_lesson_to_generate = (
                        next_lesson.objective_index,
                        list(course.input_objectives),
                        course.generated_description or course.input_description or "",
                        learner_profile,
                        preset_title,
                        lesson_summary,
                        course.professional_role,
                        course.career_context,
                        submission_text,  # latest portfolio content
                    )

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

        # Kick off on-demand generation after the session has committed
        if next_lesson_to_generate:
            (next_index, objectives, description, learner_profile,
             preset_title, lesson_summary, prof_role, career_ctx,
             portfolio_cont) = next_lesson_to_generate
            gen_key = f"lesson-gen-{course_id}-{next_index}"
            if not is_running(gen_key):
                logger.info(
                    "Scheduling on-demand generation for course [%s] obj[%d]",
                    course_id[:8], next_index,
                )
                start_generation(gen_key, generate_lesson_on_demand(
                    course_id=course_id,
                    user_id=user_id,
                    objective_index=next_index,
                    objectives=objectives,
                    description=description,
                    learner_profile=learner_profile,
                    preset_title=preset_title,
                    lesson_summary=lesson_summary,
                    professional_role=prof_role,
                    career_context=career_ctx,
                    portfolio_content=portfolio_cont,
                ))

        # Determine if revision should be encouraged
        revision_encouraged = (
            review.mastery_decision in ("meets", "exceeds")
            and review.portfolio_readiness is not None
            and review.portfolio_readiness != "portfolio_ready"
        )

        # Broadcast review result AFTER commit
        await broadcast(key, "review_complete", {
            "score": review.score,
            "mastery_decision": review.mastery_decision,
            "rationale": review.rationale,
            "strengths": review.strengths,
            "improvements": review.improvements,
            "tips": review.tips,
            "portfolio_readiness": review.portfolio_readiness,
            "employer_relevance_notes": review.employer_relevance_notes,
            "revision_priority": review.revision_priority,
            "resume_bullet_seed": review.resume_bullet_seed,
            "revision_encouraged": revision_encouraged,
        })

    except Exception:
        logger.exception("Error reviewing activity %s", activity_id)
        await broadcast(key, "review_error", {"error": "Failed to review submission"})
