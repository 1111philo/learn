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
                    "Skipping objective %d for course %s (already generated)",
                    objective_index, course_id,
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

            ctx = AgentContext(
                db=db,
                user_id=user_id,
                course_instance_id=course_id,
            )

            # 1. Plan the lesson
            async with semaphore:
                plan = await run_lesson_planner(
                    ctx, objective, description, all_objectives, learner_profile,
                )

            # Create the lesson row so REST fetches see the planned state
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
            else:
                lesson = existing

            await broadcast(course_id, "lesson_planned", {
                "objective_index": objective_index,
                "lesson_title": plan.lesson_title,
            })

            # 2. Write the lesson content
            if lesson.lesson_content:
                logger.info(
                    "Re-using existing lesson content for objective %d",
                    objective_index,
                )
            else:
                async with semaphore:
                    content = await run_lesson_writer(
                        ctx, plan, description, learner_profile,
                    )
                lesson.lesson_content = content.lesson_body
                await db.flush()
                await db.commit()

            await broadcast(course_id, "lesson_written", {
                "objective_index": objective_index,
            })

            # 3. Create the activity (only if lesson doesn't already have one)
            if not existing or not existing.activities:
                async with semaphore:
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
            else:
                activity = existing.activities[0]

            await broadcast(course_id, "activity_created", {
                "objective_index": objective_index,
                "activity_id": activity.id,
            })

            return True

    except Exception:
        logger.exception(
            "Error generating lesson %d for course %s", objective_index, course_id,
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
    """Background wrapper that runs objective generation concurrently.

    This is intended to be spawned as an asyncio.Task via the generation tracker.
    All arguments are plain data (no ORM objects) so the task is decoupled from
    the request session.
    """
    lessons_created = 0

    try:
        # Run all objectives concurrently, gated by semaphore
        semaphore = asyncio.Semaphore(3)
        results = await asyncio.gather(*(
            _generate_single_objective(
                course_id, user_id, i, obj, description,
                objectives, learner_profile, semaphore,
            )
            for i, obj in enumerate(objectives)
        ))
        lessons_created = sum(1 for r in results if r)

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

        # Broadcast AFTER the session commits (async-with exit) so that
        # any SSE subscriber re-querying the DB sees committed data.
        await broadcast(course_id, "generation_complete", {
            "course_id": course_id,
            "lesson_count": lessons_created,
        })

    except Exception:
        logger.exception("Fatal error in background generation for course %s", course_id)
        # Try to mark the course as failed
        try:
            async with get_background_session() as db:
                result = await db.execute(
                    select(CourseInstance).where(CourseInstance.id == course_id)
                )
                course = result.scalar_one_or_none()
                if course and course.status == "generating":
                    await transition_course(db, course, "generation_failed")
        except Exception:
            logger.exception("Could not mark course %s as generation_failed", course_id)

        await broadcast(course_id, "generation_error", {
            "objective_index": -1,
            "error": "Fatal generation error",
        })
        await broadcast(course_id, "generation_complete", {
            "course_id": course_id,
            "lesson_count": lessons_created,
        })
