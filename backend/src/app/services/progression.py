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
    ("draft", "generating"): "has_objectives",
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
    ("generation_failed", "generating"): "always",
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


async def unlock_next_lesson(
    db: AsyncSession, course_id: str, completed_index: int
) -> Lesson | None:
    """Unlock or create the next lesson after completed_index.

    With on-demand generation, lesson rows are created here rather than upfront.
    Returns the unlocked/created lesson, or None if completed_index is the last objective.
    """
    next_index = completed_index + 1

    # Bounds check against total objectives
    result = await db.execute(
        select(CourseInstance).where(CourseInstance.id == course_id)
    )
    course = result.scalar_one()
    if next_index >= len(course.input_objectives):
        logger.info(
            "course [%s] obj[%d] is the last lesson — no next lesson to unlock",
            course_id[:8], completed_index,
        )
        return None

    # Try to find an existing row for the next index
    result = await db.execute(
        select(Lesson).where(
            Lesson.course_instance_id == course_id,
            Lesson.objective_index == next_index,
        )
    )
    lesson = result.scalar_one_or_none()

    if lesson:
        if lesson.status == "locked":
            lesson.status = "unlocked"
            await db.flush()
            logger.info("course [%s] unlocked existing lesson obj[%d]", course_id[:8], next_index)
    else:
        # Create the row on demand
        lesson = Lesson(
            course_instance_id=course_id,
            objective_index=next_index,
            lesson_content=None,
            status="unlocked",
        )
        db.add(lesson)
        await db.flush()
        logger.info("course [%s] created on-demand lesson row obj[%d]", course_id[:8], next_index)

    return lesson


async def check_all_lessons_completed(db: AsyncSession, course_id: str) -> bool:
    result = await db.execute(
        select(Lesson).where(Lesson.course_instance_id == course_id)
    )
    lessons = result.scalars().all()
    return len(lessons) > 0 and all(l.status == "completed" for l in lessons)
