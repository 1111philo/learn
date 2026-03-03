import asyncio
import logging

from sqlalchemy import select
from sqlalchemy.orm import selectinload

from app.agents.diagnostic import run_diagnostic_creator
from app.agents.logging import AgentContext
from app.agents.lesson_planner import run_lesson_planner
from app.agents.lesson_writer import run_lesson_writer
from app.agents.activity_creator import run_activity_creator
from app.db.models import CourseInstance, Lesson, Activity
from app.db.session import get_background_session
from app.services.generation_tracker import broadcast
from app.services.progression import transition_course

logger = logging.getLogger(__name__)


async def generate_diagnostic(course_id: str, user_id: str) -> dict:
    """Generate diagnostic questions for a course synchronously.

    Returns the diagnostic spec dict, or an empty dict on failure.
    """
    course_id_short = course_id[:8]
    try:
        async with get_background_session() as db:
            result = await db.execute(
                select(CourseInstance).where(CourseInstance.id == course_id)
            )
            course = result.scalar_one()
            ctx = AgentContext(db=db, user_id=user_id, course_instance_id=course_id)
            spec = await run_diagnostic_creator(
                ctx,
                objectives=list(course.input_objectives),
                course_description=course.input_description or "",
            )
            course.diagnostic_spec = spec.model_dump()
            await db.commit()
            logger.info("[%s] diagnostic questions generated (%d questions)", course_id_short, len(spec.questions))
            return spec.model_dump()
    except Exception:
        logger.exception("[%s] Failed to generate diagnostic", course_id_short)
        return {}


async def _generate_single_objective(
    course_id: str,
    user_id: str,
    objective_index: int,
    objective: str,
    description: str,
    all_objectives: list[str],
    learner_profile: dict | None,
    diagnostic_analysis: dict | None,
    semaphore: asyncio.Semaphore,
) -> bool:
    """Generate all sub-lessons + capstone for one objective.

    Returns True on success, False on error.
    """
    course_id_short = course_id[:8]
    obj_label = f"obj[{objective_index}]"
    obj_preview = objective[:60] + ("…" if len(objective) > 60 else "")

    try:
        async with get_background_session() as db:
            # Check for existing lessons at this objective (retry/skip support)
            result = await db.execute(
                select(Lesson)
                .where(
                    Lesson.course_instance_id == course_id,
                    Lesson.objective_index == objective_index,
                )
                .options(selectinload(Lesson.activities))
            )
            existing_lessons = result.scalars().all()

            # Skip path: all sub-lessons + capstone already exist with content
            capstone = next(
                (l for l in existing_lessons if l.lesson_role == "capstone"),
                None
            )
            if capstone and capstone.lesson_content and capstone.activities:
                logger.info(
                    "[%s] %s SKIP (already generated): %s",
                    course_id_short, obj_label, obj_preview,
                )
                await broadcast(course_id, "lesson_planned", {
                    "objective_index": objective_index,
                    "objective_title": capstone.lesson_title or "",
                    "skipped": True,
                })
                await broadcast(course_id, "lesson_written", {
                    "objective_index": objective_index,
                    "skipped": True,
                })
                await broadcast(course_id, "activity_created", {
                    "objective_index": objective_index,
                    "activity_id": capstone.activities[0].id,
                    "skipped": True,
                })
                return True

            logger.info("[%s] %s START: %s", course_id_short, obj_label, obj_preview)

            ctx = AgentContext(db=db, user_id=user_id, course_instance_id=course_id)

            # 1. Plan all sub-lessons + capstone for this objective
            logger.info("[%s] %s waiting for semaphore (lesson_planner)…", course_id_short, obj_label)
            async with semaphore:
                logger.info("[%s] %s running lesson_planner…", course_id_short, obj_label)
                plan = await run_lesson_planner(
                    ctx, objective, description, all_objectives, learner_profile, diagnostic_analysis,
                )
            logger.info(
                "[%s] %s lesson_planner done → title: %r | concepts: %d | sub-lessons: %d",
                course_id_short, obj_label, plan.objective_title,
                len(plan.key_concepts), len(plan.sub_lesson_seeds),
            )

            await broadcast(course_id, "lesson_planned", {
                "objective_index": objective_index,
                "objective_title": plan.objective_title,
                "sub_lesson_count": len(plan.sub_lesson_seeds) + 1,  # +1 for capstone
            })

            # 2. Create all Lesson rows for this objective if they don't exist
            existing_by_sub = {l.sub_lesson_index: l for l in existing_lessons}
            lesson_rows: list[Lesson] = []

            for seed in plan.sub_lesson_seeds:
                if seed.sub_lesson_index not in existing_by_sub:
                    is_first = (objective_index == 0 and seed.sub_lesson_index == 0)
                    lesson = Lesson(
                        course_instance_id=course_id,
                        objective_index=objective_index,
                        sub_lesson_index=seed.sub_lesson_index,
                        lesson_role="focused",
                        lesson_title=seed.title,
                        lesson_content=None,
                        status="unlocked" if is_first else "locked",
                    )
                    db.add(lesson)
                    lesson_rows.append(lesson)
                else:
                    lesson_rows.append(existing_by_sub[seed.sub_lesson_index])

            # Capstone row
            capstone_sub_idx = len(plan.sub_lesson_seeds)
            if capstone_sub_idx not in existing_by_sub:
                capstone_lesson = Lesson(
                    course_instance_id=course_id,
                    objective_index=objective_index,
                    sub_lesson_index=capstone_sub_idx,
                    lesson_role="capstone",
                    lesson_title=f"{plan.objective_title} — Capstone",
                    lesson_content=None,
                    status="locked",
                )
                db.add(capstone_lesson)
            else:
                capstone_lesson = existing_by_sub[capstone_sub_idx]

            await db.flush()
            await db.commit()
            logger.debug(
                "[%s] %s lesson rows created/found: %d focused + 1 capstone",
                course_id_short, obj_label, len(plan.sub_lesson_seeds),
            )

            # 3. Write and create activities for each focused sub-lesson
            for i, seed in enumerate(plan.sub_lesson_seeds):
                lesson = lesson_rows[i]
                sl_label = f"{obj_label}/sub[{seed.sub_lesson_index}]"

                if not lesson.lesson_content:
                    logger.info("[%s] %s waiting for semaphore (lesson_writer)…", course_id_short, sl_label)
                    async with semaphore:
                        logger.info("[%s] %s running lesson_writer…", course_id_short, sl_label)
                        content = await run_lesson_writer(
                            ctx, seed, objective, description, learner_profile,
                            lesson_role="focused",
                        )
                    lesson.lesson_content = content.lesson_body
                    lesson.lesson_title = content.lesson_title
                    await db.flush()
                    await db.commit()
                    logger.info(
                        "[%s] %s lesson_writer done → %d chars",
                        course_id_short, sl_label, len(content.lesson_body),
                    )

                await broadcast(course_id, "lesson_written", {
                    "objective_index": objective_index,
                    "sub_lesson_index": seed.sub_lesson_index,
                })

                if not lesson.activities:
                    logger.info("[%s] %s waiting for semaphore (activity_creator)…", course_id_short, sl_label)
                    async with semaphore:
                        logger.info("[%s] %s running activity_creator (focused, level %d)…", course_id_short, sl_label, seed.difficulty_level)
                        activity_spec = await run_activity_creator(
                            ctx, seed.activity_seed, objective,
                            plan.mastery_criteria, learner_profile,
                            difficulty_level=seed.difficulty_level,
                            lesson_role="focused",
                            concept_focus=seed.concept_focus,
                        )
                    activity = Activity(
                        lesson_id=lesson.id,
                        activity_spec=activity_spec.model_dump(),
                    )
                    db.add(activity)
                    await db.flush()
                    await db.commit()
                    logger.info(
                        "[%s] %s activity_creator done → rubric: %d items",
                        course_id_short, sl_label, len(activity_spec.scoring_rubric),
                    )
                else:
                    activity = lesson.activities[0]

                await broadcast(course_id, "activity_created", {
                    "objective_index": objective_index,
                    "sub_lesson_index": seed.sub_lesson_index,
                    "activity_id": activity.id,
                    "lesson_role": "focused",
                })

            # 4. Write and create activity for capstone
            cap_label = f"{obj_label}/capstone"

            if not capstone_lesson.lesson_content:
                logger.info("[%s] %s waiting for semaphore (lesson_writer)…", course_id_short, cap_label)
                async with semaphore:
                    logger.info("[%s] %s running lesson_writer (capstone)…", course_id_short, cap_label)
                    cap_content = await run_lesson_writer(
                        ctx, None, objective, description, learner_profile,
                        lesson_role="capstone",
                        key_concepts=plan.key_concepts,
                        mastery_criteria=plan.mastery_criteria,
                    )
                capstone_lesson.lesson_content = cap_content.lesson_body
                capstone_lesson.lesson_title = cap_content.lesson_title
                await db.flush()
                await db.commit()
                logger.info(
                    "[%s] %s lesson_writer done → %d chars",
                    course_id_short, cap_label, len(cap_content.lesson_body),
                )

            await broadcast(course_id, "lesson_written", {
                "objective_index": objective_index,
                "sub_lesson_index": capstone_sub_idx,
            })

            if not capstone_lesson.activities:
                logger.info("[%s] %s waiting for semaphore (activity_creator)…", course_id_short, cap_label)
                async with semaphore:
                    logger.info("[%s] %s running activity_creator (capstone)…", course_id_short, cap_label)
                    cap_spec = await run_activity_creator(
                        ctx, plan.capstone_seed, objective,
                        plan.mastery_criteria, learner_profile,
                        difficulty_level=3,
                        lesson_role="capstone",
                    )
                cap_activity = Activity(
                    lesson_id=capstone_lesson.id,
                    activity_spec=cap_spec.model_dump(),
                )
                db.add(cap_activity)
                await db.flush()
                await db.commit()
                logger.info(
                    "[%s] %s activity_creator done → rubric: %d items",
                    course_id_short, cap_label, len(cap_spec.scoring_rubric),
                )
            else:
                cap_activity = capstone_lesson.activities[0]

            await broadcast(course_id, "activity_created", {
                "objective_index": objective_index,
                "sub_lesson_index": capstone_sub_idx,
                "activity_id": cap_activity.id,
                "lesson_role": "capstone",
            })

            logger.info("[%s] %s COMPLETE ✓", course_id_short, obj_label)
            return True

    except Exception:
        logger.exception("[%s] %s FAILED: %s", course_id_short, obj_label, obj_preview)
        await broadcast(course_id, "generation_error", {
            "objective_index": objective_index,
            "error": f"Failed to generate lessons for objective {objective_index}",
        })
        return False


async def generate_course_background(
    course_id: str,
    user_id: str,
    objectives: list[str],
    description: str,
    learner_profile: dict | None = None,
    diagnostic_analysis: dict | None = None,
) -> None:
    """Background task that generates all sub-lessons for objective 0.

    Subsequent objectives are generated on demand as the learner progresses.
    """
    course_id_short = course_id[:8]

    logger.info(
        "[%s] GENERATION START | generating objective 0 of %d | model: %s",
        course_id_short, len(objectives),
        __import__("app.config", fromlist=["settings"]).settings.default_model,
    )
    logger.info("[%s]   obj[0]: %s", course_id_short, objectives[0][:80])

    lessons_created = 0

    try:
        success = await _generate_single_objective(
            course_id, user_id, 0, objectives[0], description,
            objectives, learner_profile, diagnostic_analysis, asyncio.Semaphore(1),
        )
        lessons_created = 1 if success else 0

        logger.info(
            "[%s] Initial generation %s",
            course_id_short, "succeeded — objective 0 ready" if success else "failed",
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

        await broadcast(course_id, "generation_complete", {
            "course_id": course_id,
            "lesson_count": lessons_created,
        })
        logger.info("[%s] GENERATION COMPLETE | objective 0 ready", course_id_short)

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


async def generate_objective_on_demand(
    course_id: str,
    user_id: str,
    objective_index: int,
    objectives: list[str],
    description: str,
    learner_profile: dict | None = None,
    diagnostic_analysis: dict | None = None,
) -> None:
    """Generate all sub-lessons for an objective on demand when the learner unlocks it.

    Called when a learner completes the capstone of the previous objective.
    """
    course_id_short = course_id[:8]
    logger.info(
        "[%s] ON-DEMAND generation starting for obj[%d]",
        course_id_short, objective_index,
    )
    await _generate_single_objective(
        course_id, user_id, objective_index, objectives[objective_index],
        description, objectives, learner_profile, diagnostic_analysis, asyncio.Semaphore(1),
    )
