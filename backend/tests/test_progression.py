"""Unit tests for the course state machine (progression service)."""

import pytest
from sqlalchemy.ext.asyncio import AsyncSession

from app.db.models import Assessment, CourseInstance, Lesson, User
from app.services.progression import (
    InvalidTransitionError,
    check_all_lessons_completed,
    check_guard,
    transition_course,
    unlock_next_lesson,
)


async def _make_user(db: AsyncSession) -> User:
    user = User(email="prog-test@example.com", password_hash="fake")
    db.add(user)
    await db.flush()
    return user


async def _make_course(
    db: AsyncSession,
    user_id: str,
    status: str = "draft",
    input_objectives: list | None = None,
    lessons: list["Lesson"] | None = None,
    assessments: list["Assessment"] | None = None,
) -> CourseInstance:
    course = CourseInstance(
        user_id=user_id,
        source_type="custom",
        input_description="Test",
        input_objectives=input_objectives if input_objectives is not None else ["Obj 1", "Obj 2"],
        status=status,
    )
    if lessons is not None:
        course.lessons = lessons
    if assessments is not None:
        course.assessments = assessments
    db.add(course)
    await db.flush()
    return course


# --- Guard checks ---

async def test_guard_always(db_session: AsyncSession):
    user = await _make_user(db_session)
    course = await _make_course(db_session, user.id)
    assert await check_guard(db_session, course, "always") is True


async def test_guard_has_objectives(db_session: AsyncSession):
    user = await _make_user(db_session)
    course = await _make_course(db_session, user.id)
    assert await check_guard(db_session, course, "has_objectives") is True

    empty = await _make_course(db_session, user.id, input_objectives=[])
    assert await check_guard(db_session, empty, "has_objectives") is False


async def test_guard_all_content_generated(db_session: AsyncSession):
    user = await _make_user(db_session)
    course = await _make_course(db_session, user.id, status="generating", lessons=[])
    assert await check_guard(db_session, course, "all_content_generated") is False

    lesson = Lesson(course_instance_id=course.id, objective_index=0, lesson_content="Content", status="unlocked")
    db_session.add(lesson)
    await db_session.flush()
    course.lessons.append(lesson)
    assert await check_guard(db_session, course, "all_content_generated") is True

    lesson2 = Lesson(course_instance_id=course.id, objective_index=1, lesson_content=None, status="locked")
    db_session.add(lesson2)
    await db_session.flush()
    course.lessons.append(lesson2)
    assert await check_guard(db_session, course, "all_content_generated") is False


async def test_guard_all_lessons_completed(db_session: AsyncSession):
    user = await _make_user(db_session)
    course = await _make_course(db_session, user.id, status="in_progress", lessons=[])
    lesson = Lesson(course_instance_id=course.id, objective_index=0, status="completed")
    db_session.add(lesson)
    await db_session.flush()
    course.lessons.append(lesson)
    assert await check_guard(db_session, course, "all_lessons_completed") is True

    lesson2 = Lesson(course_instance_id=course.id, objective_index=1, status="unlocked")
    db_session.add(lesson2)
    await db_session.flush()
    course.lessons.append(lesson2)
    assert await check_guard(db_session, course, "all_lessons_completed") is False


async def test_guard_assessment_generated(db_session: AsyncSession):
    user = await _make_user(db_session)
    course = await _make_course(db_session, user.id, status="generating_assessment", assessments=[])
    assert await check_guard(db_session, course, "assessment_generated") is False

    assessment = Assessment(course_instance_id=course.id, status="pending")
    db_session.add(assessment)
    await db_session.flush()
    course.assessments.append(assessment)
    assert await check_guard(db_session, course, "assessment_generated") is True


async def test_guard_assessment_passed(db_session: AsyncSession):
    user = await _make_user(db_session)
    assessment = Assessment(status="reviewed", passed=True)
    course = await _make_course(db_session, user.id, status="assessment_ready", assessments=[assessment])
    assert await check_guard(db_session, course, "assessment_passed") is True

    assessment.passed = False
    assert await check_guard(db_session, course, "assessment_passed") is False


# --- State transitions ---

async def test_valid_transitions(db_session: AsyncSession):
    user = await _make_user(db_session)
    course = await _make_course(db_session, user.id, status="draft")
    await transition_course(db_session, course, "generating")
    assert course.status == "generating"


async def test_invalid_transition_raises(db_session: AsyncSession):
    user = await _make_user(db_session)
    course = await _make_course(db_session, user.id, status="draft")
    with pytest.raises(InvalidTransitionError, match="Cannot transition"):
        await transition_course(db_session, course, "completed")


async def test_guard_failure_raises(db_session: AsyncSession):
    user = await _make_user(db_session)
    course = await _make_course(db_session, user.id, status="generating", input_objectives=["Obj 1"])
    course.lessons = []
    with pytest.raises(InvalidTransitionError, match="Guard"):
        await transition_course(db_session, course, "active")


# --- Lesson unlock ---

async def test_unlock_next_lesson(db_session: AsyncSession):
    user = await _make_user(db_session)
    course = await _make_course(db_session, user.id, status="in_progress")
    lesson0 = Lesson(course_instance_id=course.id, objective_index=0, status="completed")
    lesson1 = Lesson(course_instance_id=course.id, objective_index=1, status="locked")
    db_session.add_all([lesson0, lesson1])
    await db_session.commit()

    unlocked = await unlock_next_lesson(db_session, course.id, 0)
    assert unlocked is not None
    assert unlocked.status == "unlocked"
    assert unlocked.objective_index == 1


async def test_unlock_creates_lesson_on_demand(db_session: AsyncSession):
    user = await _make_user(db_session)
    course = await _make_course(db_session, user.id, status="in_progress")
    lesson0 = Lesson(course_instance_id=course.id, objective_index=0, status="completed")
    db_session.add(lesson0)
    await db_session.commit()

    unlocked = await unlock_next_lesson(db_session, course.id, 0)
    assert unlocked is not None
    assert unlocked.objective_index == 1
    assert unlocked.status == "unlocked"


async def test_unlock_returns_none_at_end(db_session: AsyncSession):
    user = await _make_user(db_session)
    course = await _make_course(db_session, user.id, status="in_progress")
    lesson = Lesson(course_instance_id=course.id, objective_index=0, status="completed")
    db_session.add(lesson)
    await db_session.commit()

    result = await unlock_next_lesson(db_session, course.id, 1)
    assert result is None


# --- check_all_lessons_completed ---

async def test_check_all_lessons_completed_true(db_session: AsyncSession):
    user = await _make_user(db_session)
    course = await _make_course(db_session, user.id)
    lesson = Lesson(course_instance_id=course.id, objective_index=0, status="completed")
    db_session.add(lesson)
    await db_session.commit()

    assert await check_all_lessons_completed(db_session, course.id) is True


async def test_check_all_lessons_completed_false(db_session: AsyncSession):
    user = await _make_user(db_session)
    course = await _make_course(db_session, user.id)
    lesson1 = Lesson(course_instance_id=course.id, objective_index=0, status="completed")
    lesson2 = Lesson(course_instance_id=course.id, objective_index=1, status="unlocked")
    db_session.add_all([lesson1, lesson2])
    await db_session.commit()

    assert await check_all_lessons_completed(db_session, course.id) is False
