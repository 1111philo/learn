import asyncio
import logging

from sqlalchemy import select
from sqlalchemy.orm import selectinload

from app.agents.logging import AgentContext
from app.agents.lesson_planner import run_lesson_planner
from app.agents.lesson_writer import run_lesson_writer
from app.agents.activity_creator import run_activity_creator
from app.db.models import CourseInstance, Lesson, Activity
from app.db.session import get_background_session
from app.services.generation_tracker import broadcast
from app.services.progression import transition_course

logger = logging.getLogger(__name__)


async def _generate_single_objective(
    course_id: str,
    user_id: str,
    objective_index: int,
    objective: str,
    description: str,
    all_objectives: list[str],
    learner_profile: dict | None,
    semaphore: asyncio.Semaphore,
) -> bool:
    """Generate a single objective's lesson and activity.

    Each coroutine owns its own DB session so concurrent objectives never
    share an AsyncSession. LLM calls are gated by the semaphore to limit
    parallel API usage.

    Returns True on success, False on error.
    """
    course_id_short = course_id[:8]
    obj_label = f"obj[{objective_index}]"
    obj_preview = objective[:60] + ("…" if len(objective) > 60 else "")

    try:
        async with get_background_session() as db:
            # Check for existing lesson at this index (retry/skip support)
            result = await db.execute(
                select(Lesson)
                .where(
                    Lesson.course_instance_id == course_id,
                    Lesson.objective_index == objective_index,
                )
                .options(selectinload(Lesson.activities))
            )
            existing = result.scalar_one_or_none()

            # Skip path: already fully generated
            if existing and existing.lesson_content and existing.activities:
                logger.info(
                    "[%s] %s SKIP (already generated): %s",
                    course_id_short, obj_label, obj_preview,
                )
                await broadcast(course_id, "lesson_planned", {
                    "objective_index": objective_index,
                    "lesson_title": None,
                    "skipped": True,
                })
                await broadcast(course_id, "lesson_written", {
                    "objective_index": objective_index,
                    "skipped": True,
                })
                await broadcast(course_id, "activity_created", {
                    "objective_index": objective_index,
                    "activity_id": existing.activities[0].id,
                    "skipped": True,
                })
                return True

            logger.info(
                "[%s] %s START: %s",
                course_id_short, obj_label, obj_preview,
            )

            ctx = AgentContext(
                db=db,
                user_id=user_id,
                course_instance_id=course_id,
            )

            # 1. Plan the lesson
            logger.info("[%s] %s waiting for semaphore (lesson_planner)…", course_id_short, obj_label)
            async with semaphore:
                logger.info("[%s] %s running lesson_planner…", course_id_short, obj_label)
                plan = await run_lesson_planner(
                    ctx, objective, description, all_objectives, learner_profile,
                )
            logger.info(
                "[%s] %s lesson_planner done → title: %r | concepts: %d | outline steps: %d",
                course_id_short, obj_label, plan.lesson_title,
                len(plan.key_concepts), len(plan.lesson_outline),
            )

            # Create or reuse the lesson row
            if not existing:
                lesson = Lesson(
                    course_instance_id=course_id,
                    objective_index=objective_index,
                    lesson_content=None,
                    status="unlocked" if objective_index == 0 else "locked",
                )
                db.add(lesson)
                await db.flush()
                await db.commit()
                logger.debug("[%s] %s lesson row created (id=%s)", course_id_short, obj_label, lesson.id[:8])
            else:
                lesson = existing

            await broadcast(course_id, "lesson_planned", {
                "objective_index": objective_index,
                "lesson_title": plan.lesson_title,
            })

            # 2. Write the lesson content
            if lesson.lesson_content:
                logger.info(
                    "[%s] %s lesson_writer SKIP (content already exists)",
                    course_id_short, obj_label,
                )
            else:
                logger.info("[%s] %s waiting for semaphore (lesson_writer)…", course_id_short, obj_label)
                async with semaphore:
                    logger.info("[%s] %s running lesson_writer…", course_id_short, obj_label)
                    content = await run_lesson_writer(
                        ctx, plan, description, learner_profile,
                    )
                lesson.lesson_content = content.lesson_body
                await db.flush()
                await db.commit()
                logger.info(
                    "[%s] %s lesson_writer done → %d chars, %d takeaways",
                    course_id_short, obj_label,
                    len(content.lesson_body), len(content.key_takeaways),
                )

            await broadcast(course_id, "lesson_written", {
                "objective_index": objective_index,
            })

            # 3. Create the activity (only if lesson doesn't already have one)
            if not existing or not existing.activities:
                logger.info("[%s] %s waiting for semaphore (activity_creator)…", course_id_short, obj_label)
                async with semaphore:
                    logger.info("[%s] %s running activity_creator…", course_id_short, obj_label)
                    activity_spec = await run_activity_creator(
                        ctx, plan.suggested_activity, objective,
                        plan.mastery_criteria, learner_profile,
                    )
                activity = Activity(
                    lesson_id=lesson.id,
                    activity_spec=activity_spec.model_dump(),
                )
                db.add(activity)
                await db.flush()
                await db.commit()
                logger.info(
                    "[%s] %s activity_creator done → rubric items: %d, hints: %d",
                    course_id_short, obj_label,
                    len(activity_spec.scoring_rubric), len(activity_spec.hints),
                )
            else:
                activity = existing.activities[0]
                logger.info(
                    "[%s] %s activity_creator SKIP (activity already exists id=%s)",
                    course_id_short, obj_label, activity.id[:8],
                )

            await broadcast(course_id, "activity_created", {
                "objective_index": objective_index,
                "activity_id": activity.id,
            })

            logger.info("[%s] %s COMPLETE ✓", course_id_short, obj_label)
            return True

    except Exception:
        logger.exception(
            "[%s] %s FAILED: %s", course_id_short, obj_label, obj_preview,
        )
        await broadcast(course_id, "generation_error", {
            "objective_index": objective_index,
            "error": f"Failed to generate lesson for objective {objective_index}",
        })
        return False


async def generate_course_background(
    course_id: str,
    user_id: str,
    objectives: list[str],
    description: str,
    learner_profile: dict | None = None,
) -> None:
    """Background task that generates only the first lesson (lesson 0).

    Subsequent lessons are generated on demand via generate_lesson_on_demand
    as the learner progresses through the course.
    """
    course_id_short = course_id[:8]

    logger.info(
        "[%s] GENERATION START | generating lesson 0 of %d | model: %s",
        course_id_short, len(objectives),
        __import__("app.config", fromlist=["settings"]).settings.default_model,
    )
    logger.info("[%s]   obj[0]: %s", course_id_short, objectives[0][:80])

    lessons_created = 0

    try:
        success = await _generate_single_objective(
            course_id, user_id, 0, objectives[0], description,
            objectives, learner_profile, asyncio.Semaphore(1),
        )
        lessons_created = 1 if success else 0

        logger.info(
            "[%s] Initial generation %s",
            course_id_short, "succeeded — lesson 0 ready" if success else "failed",
        )

        # Finalize course status
        async with get_background_session() as db:
            result = await db.execute(
                select(CourseInstance)
                .where(CourseInstance.id == course_id)
                .options(selectinload(CourseInstance.lessons))
            )
            course = result.scalar_one()
            course.generated_description = description

            if lessons_created > 0:
                await transition_course(db, course, "active")
                await transition_course(db, course, "in_progress")
            else:
                await transition_course(db, course, "generation_failed")

        # Broadcast AFTER the session commits so SSE subscribers see committed data.
        await broadcast(course_id, "generation_complete", {
            "course_id": course_id,
            "lesson_count": lessons_created,
        })
        logger.info("[%s] GENERATION COMPLETE | lesson 0 ready", course_id_short)

    except Exception:
        logger.exception("[%s] FATAL error in background generation", course_id_short)
        try:
            async with get_background_session() as db:
                result = await db.execute(
                    select(CourseInstance).where(CourseInstance.id == course_id)
                )
                course = result.scalar_one_or_none()
                if course and course.status == "generating":
                    await transition_course(db, course, "generation_failed")
        except Exception:
            logger.exception("[%s] Could not mark course as generation_failed", course_id_short)

        await broadcast(course_id, "generation_error", {
            "objective_index": -1,
            "error": "Fatal generation error",
        })
        await broadcast(course_id, "generation_complete", {
            "course_id": course_id,
            "lesson_count": lessons_created,
        })


async def generate_lesson_on_demand(
    course_id: str,
    user_id: str,
    objective_index: int,
    objectives: list[str],
    description: str,
    learner_profile: dict | None = None,
) -> None:
    """Generate a single lesson on demand when the learner unlocks it.

    The lesson row already exists (created by unlock_next_lesson) with no content.
    """
    course_id_short = course_id[:8]
    logger.info(
        "[%s] ON-DEMAND generation starting for obj[%d]",
        course_id_short, objective_index,
    )
    await _generate_single_objective(
        course_id, user_id, objective_index, objectives[objective_index],
        description, objectives, learner_profile, asyncio.Semaphore(1),
    )
