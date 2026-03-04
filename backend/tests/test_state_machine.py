"""Unit tests for the course state machine (progression.py).

All tests use mock_db directly — no patching needed since these functions
accept AsyncSession as a parameter.

When modifying progression.py:
- New transition edge → add a test following the existing pattern
- New guard condition → add tests for both pass and fail cases
"""

from unittest.mock import AsyncMock, MagicMock

import pytest

from app.services.progression import (
    InvalidTransitionError,
    check_all_lessons_completed,
    transition_course,
    unlock_next_lesson,
)


# ---------------------------------------------------------------------------
# transition_course — valid transitions
# ---------------------------------------------------------------------------


async def test_draft_to_generating_succeeds(mock_db, sample_course):
    """Guard 'has_objectives' passes when input_objectives is non-empty."""
    sample_course.status = "draft"
    result = await transition_course(mock_db, sample_course, "generating")
    assert result.status == "generating"
    mock_db.flush.assert_called_once()


async def test_generating_to_active_succeeds_with_content(mock_db, sample_course, sample_lesson):
    """Guard 'all_content_generated' passes when all lessons have content."""
    sample_course.status = "generating"
    sample_lesson.lesson_content = "Some lesson text"
    sample_course.lessons = [sample_lesson]
    result = await transition_course(mock_db, sample_course, "active")
    assert result.status == "active"


async def test_active_to_in_progress_always_succeeds(mock_db, sample_course):
    """Guard 'always' — no condition required."""
    sample_course.status = "active"
    result = await transition_course(mock_db, sample_course, "in_progress")
    assert result.status == "in_progress"


async def test_generation_failed_to_generating_retry(mock_db, sample_course):
    """Retry path: generation_failed → generating uses 'always' guard."""
    sample_course.status = "generation_failed"
    result = await transition_course(mock_db, sample_course, "generating")
    assert result.status == "generating"


async def test_generating_to_generation_failed(mock_db, sample_course):
    """Failure path: generating → generation_failed uses 'always' guard."""
    sample_course.status = "generating"
    result = await transition_course(mock_db, sample_course, "generation_failed")
    assert result.status == "generation_failed"


# ---------------------------------------------------------------------------
# transition_course — guard failures
# ---------------------------------------------------------------------------


async def test_draft_to_generating_fails_without_objectives(mock_db, sample_course):
    """Guard 'has_objectives' blocks transition when input_objectives is empty."""
    sample_course.status = "draft"
    sample_course.input_objectives = []
    with pytest.raises(InvalidTransitionError, match="has_objectives"):
        await transition_course(mock_db, sample_course, "generating")


async def test_generating_to_active_fails_without_lesson_content(mock_db, sample_course, sample_lesson):
    """Guard 'all_content_generated' fails if any lesson has null content."""
    sample_course.status = "generating"
    sample_lesson.lesson_content = None
    sample_course.lessons = [sample_lesson]
    with pytest.raises(InvalidTransitionError, match="all_content_generated"):
        await transition_course(mock_db, sample_course, "active")


async def test_generating_to_active_fails_with_no_lessons(mock_db, sample_course):
    """Guard 'all_content_generated' fails when there are zero lessons."""
    sample_course.status = "generating"
    sample_course.lessons = []
    with pytest.raises(InvalidTransitionError, match="all_content_generated"):
        await transition_course(mock_db, sample_course, "active")


async def test_in_progress_to_awaiting_fails_when_lesson_not_completed(mock_db, sample_course, sample_lesson):
    """Guard 'all_lessons_completed' fails if any lesson is not completed."""
    sample_course.status = "in_progress"
    sample_lesson.status = "unlocked"
    sample_course.lessons = [sample_lesson]
    with pytest.raises(InvalidTransitionError, match="all_lessons_completed"):
        await transition_course(mock_db, sample_course, "awaiting_assessment")


async def test_in_progress_to_awaiting_succeeds_when_all_completed(mock_db, sample_course, sample_lesson):
    """Guard 'all_lessons_completed' passes when all lessons are completed."""
    sample_course.status = "in_progress"
    sample_lesson.status = "completed"
    sample_course.lessons = [sample_lesson]
    result = await transition_course(mock_db, sample_course, "awaiting_assessment")
    assert result.status == "awaiting_assessment"


# ---------------------------------------------------------------------------
# transition_course — invalid paths
# ---------------------------------------------------------------------------


async def test_invalid_transition_raises(mock_db, sample_course):
    """Non-existent transition raises InvalidTransitionError with clear message."""
    sample_course.status = "draft"
    with pytest.raises(InvalidTransitionError, match="Cannot transition from 'draft' to 'completed'"):
        await transition_course(mock_db, sample_course, "completed")


async def test_backward_transition_raises(mock_db, sample_course):
    """No backward transitions exist (e.g. active → draft)."""
    sample_course.status = "active"
    with pytest.raises(InvalidTransitionError):
        await transition_course(mock_db, sample_course, "draft")


# ---------------------------------------------------------------------------
# unlock_next_lesson
# ---------------------------------------------------------------------------


async def test_unlock_next_lesson_creates_new_row(mock_db, sample_course):
    """When no lesson row exists for next_index, a new one is created with status=unlocked."""
    course_result = MagicMock()
    course_result.scalar_one.return_value = sample_course
    lesson_result = MagicMock()
    lesson_result.scalar_one_or_none.return_value = None
    mock_db.execute = AsyncMock(side_effect=[course_result, lesson_result])

    added_objects = []
    mock_db.add.side_effect = lambda obj: added_objects.append(obj)

    lesson = await unlock_next_lesson(mock_db, sample_course.id, completed_index=0)

    assert lesson is not None
    assert lesson.objective_index == 1
    assert lesson.status == "unlocked"
    mock_db.add.assert_called_once()


async def test_unlock_next_lesson_returns_none_at_last_objective(mock_db, sample_course):
    """Returns None when completed_index is the last objective."""
    sample_course.input_objectives = ["obj 0"]  # only one objective
    course_result = MagicMock()
    course_result.scalar_one.return_value = sample_course
    mock_db.execute = AsyncMock(return_value=course_result)

    result = await unlock_next_lesson(mock_db, sample_course.id, completed_index=0)
    assert result is None


async def test_unlock_next_lesson_unlocks_existing_locked_row(mock_db, sample_course, sample_lesson):
    """When a locked row already exists for next_index, status is updated to unlocked."""
    sample_lesson.objective_index = 1
    sample_lesson.status = "locked"
    course_result = MagicMock()
    course_result.scalar_one.return_value = sample_course
    lesson_result = MagicMock()
    lesson_result.scalar_one_or_none.return_value = sample_lesson
    mock_db.execute = AsyncMock(side_effect=[course_result, lesson_result])

    result = await unlock_next_lesson(mock_db, sample_course.id, completed_index=0)
    assert result.status == "unlocked"


async def test_unlock_next_lesson_returns_already_unlocked_row(mock_db, sample_course, sample_lesson):
    """When a row already exists with status=unlocked, it is returned unchanged."""
    sample_lesson.objective_index = 1
    sample_lesson.status = "unlocked"
    course_result = MagicMock()
    course_result.scalar_one.return_value = sample_course
    lesson_result = MagicMock()
    lesson_result.scalar_one_or_none.return_value = sample_lesson
    mock_db.execute = AsyncMock(side_effect=[course_result, lesson_result])

    result = await unlock_next_lesson(mock_db, sample_course.id, completed_index=0)
    assert result.status == "unlocked"
    mock_db.add.assert_not_called()


# ---------------------------------------------------------------------------
# check_all_lessons_completed
# ---------------------------------------------------------------------------


async def test_check_all_lessons_completed_true(mock_db):
    """Returns True only when all lessons have status='completed'."""
    from app.db.models import Lesson

    l1, l2 = Lesson(), Lesson()
    l1.status = "completed"
    l2.status = "completed"
    result_mock = MagicMock()
    result_mock.scalars.return_value.all.return_value = [l1, l2]
    mock_db.execute = AsyncMock(return_value=result_mock)

    assert await check_all_lessons_completed(mock_db, "some-course-id") is True


async def test_check_all_lessons_completed_false_when_any_unlocked(mock_db):
    """Returns False when any lesson has a non-completed status."""
    from app.db.models import Lesson

    l1, l2 = Lesson(), Lesson()
    l1.status = "completed"
    l2.status = "unlocked"
    result_mock = MagicMock()
    result_mock.scalars.return_value.all.return_value = [l1, l2]
    mock_db.execute = AsyncMock(return_value=result_mock)

    assert await check_all_lessons_completed(mock_db, "some-course-id") is False


async def test_check_all_lessons_completed_false_when_empty(mock_db):
    """Returns False (not True) when there are zero lessons."""
    result_mock = MagicMock()
    result_mock.scalars.return_value.all.return_value = []
    mock_db.execute = AsyncMock(return_value=result_mock)

    assert await check_all_lessons_completed(mock_db, "some-course-id") is False
