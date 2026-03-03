import logging

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.orm import selectinload

from app.db.models import CourseInstance, Lesson

logger = logging.getLogger(__name__)


class InvalidTransitionError(Exception):
    pass


# Valid transitions and their guard conditions
TRANSITIONS: dict[tuple[str, str], str] = {
    ("draft", "awaiting_diagnostic"): "has_objectives",
    ("awaiting_diagnostic", "generating"): "always",
    ("generating", "active"): "all_content_generated",
    ("active", "in_progress"): "always",
    ("in_progress", "awaiting_assessment"): "all_lessons_completed",
    ("awaiting_assessment", "generating_assessment"): "always",
    ("generating_assessment", "assessment_ready"): "assessment_generated",
    ("generating_assessment", "awaiting_assessment"): "always",  # failure/zombie rollback
    ("awaiting_assessment", "assessment_ready"): "assessment_generated",
    ("assessment_ready", "generating_assessment"): "always",  # retry
    ("assessment_ready", "completed"): "assessment_passed",
    ("generating", "generation_failed"): "always",
    ("generation_failed", "awaiting_diagnostic"): "always",  # retry goes back to diagnostic
}


async def check_guard(db: AsyncSession, course: CourseInstance, guard: str) -> bool:
    if guard == "always":
        return True
    if guard == "has_objectives":
        return bool(course.input_objectives)
    if guard == "all_content_generated":
        return len(course.lessons) > 0 and all(
            lesson.lesson_content is not None for lesson in course.lessons
        )
    if guard == "all_lessons_completed":
        return len(course.lessons) > 0 and all(
            lesson.status == "completed" for lesson in course.lessons
        )
    if guard == "assessment_generated":
        return any(a.status == "pending" for a in course.assessments)
    if guard == "assessment_passed":
        return any(a.passed for a in course.assessments)
    return False


async def transition_course(
    db: AsyncSession, course: CourseInstance, target_status: str
) -> CourseInstance:
    key = (course.status, target_status)
    guard_name = TRANSITIONS.get(key)
    if guard_name is None:
        raise InvalidTransitionError(
            f"Cannot transition from '{course.status}' to '{target_status}'"
        )

    if not await check_guard(db, course, guard_name):
        raise InvalidTransitionError(
            f"Guard '{guard_name}' failed for transition "
            f"'{course.status}' → '{target_status}'"
        )

    prev = course.status
    course.status = target_status
    await db.flush()
    logger.info("course [%s] %s → %s", course.id[:8], prev, target_status)
    return course


async def unlock_next_sub_lesson(
    db: AsyncSession,
    course_id: str,
    completed_lesson: Lesson,
) -> Lesson | None:
    """Unlock the next sub-lesson based on the completed lesson's role.

    - If lesson_role == "focused": unlock the next sub-lesson in the same objective
      (sub_lesson_index + 1).
    - If lesson_role == "capstone": unlock sub_lesson_index=0 of the next objective.

    Returns the unlocked lesson, or None if there is no next lesson.
    """
    lesson_role = completed_lesson.lesson_role or "capstone"  # null = legacy capstone

    if lesson_role == "focused":
        # Unlock next sub-lesson within the same objective
        next_sub_idx = completed_lesson.sub_lesson_index + 1
        result = await db.execute(
            select(Lesson).where(
                Lesson.course_instance_id == course_id,
                Lesson.objective_index == completed_lesson.objective_index,
                Lesson.sub_lesson_index == next_sub_idx,
            )
        )
        next_lesson = result.scalar_one_or_none()
        if next_lesson:
            if next_lesson.status == "locked":
                next_lesson.status = "unlocked"
                await db.flush()
                logger.info(
                    "course [%s] unlocked obj[%d]/sub[%d]",
                    course_id[:8], completed_lesson.objective_index, next_sub_idx,
                )
            return next_lesson
        # No next sub-lesson found (shouldn't happen for focused lessons)
        logger.warning(
            "course [%s] focused lesson completed but no next sub-lesson found at obj[%d]/sub[%d]",
            course_id[:8], completed_lesson.objective_index, next_sub_idx,
        )
        return None

    else:
        # Capstone completed — unlock first sub-lesson of next objective
        next_obj_idx = completed_lesson.objective_index + 1

        # Bounds check
        result = await db.execute(
            select(CourseInstance).where(CourseInstance.id == course_id)
        )
        course = result.scalar_one()
        if next_obj_idx >= len(course.input_objectives):
            logger.info(
                "course [%s] capstone obj[%d] is last objective — course complete",
                course_id[:8], completed_lesson.objective_index,
            )
            return None

        # Try to find existing first sub-lesson of next objective
        result = await db.execute(
            select(Lesson).where(
                Lesson.course_instance_id == course_id,
                Lesson.objective_index == next_obj_idx,
                Lesson.sub_lesson_index == 0,
            )
        )
        next_lesson = result.scalar_one_or_none()

        if next_lesson:
            if next_lesson.status == "locked":
                next_lesson.status = "unlocked"
                await db.flush()
                logger.info(
                    "course [%s] unlocked obj[%d]/sub[0] (next objective)",
                    course_id[:8], next_obj_idx,
                )
        else:
            # Lesson rows for next objective not yet created — create placeholder
            next_lesson = Lesson(
                course_instance_id=course_id,
                objective_index=next_obj_idx,
                sub_lesson_index=0,
                lesson_role="focused",
                lesson_content=None,
                status="unlocked",
            )
            db.add(next_lesson)
            await db.flush()
            logger.info(
                "course [%s] created placeholder lesson row for obj[%d]/sub[0]",
                course_id[:8], next_obj_idx,
            )

        return next_lesson


async def check_all_lessons_completed(db: AsyncSession, course_id: str) -> bool:
    result = await db.execute(
        select(Lesson).where(Lesson.course_instance_id == course_id)
    )
    lessons = result.scalars().all()
    return len(lessons) > 0 and all(l.status == "completed" for l in lessons)
