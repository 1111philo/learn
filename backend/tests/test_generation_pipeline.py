"""Integration tests for the generation pipeline (generation.py).


All LLM agents and DB sessions are mocked — no real API calls or DB connections.

When modifying generation.py:
- New agent call added: add a patch and a test asserting the data is stored in DB
- Commit timing changes: update mock_db.commit.call_count assertions
- Skip logic changes: update test_skips_if_already_complete
- New SSE events: update test_broadcasts_correct_events_in_order
- generate_course_background generates more than lesson 0: add more side_effect entries
"""

import asyncio
from unittest.mock import AsyncMock, MagicMock, patch

import pytest

from app.services.generation import _generate_single_objective, generate_course_background
from tests.conftest import _auto_id_add


# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------


def _no_lesson_result():
    """Mock execute() result that returns None for scalar_one_or_none()."""
    r = MagicMock()
    r.scalar_one_or_none.return_value = None
    return r


def _course_result(course):
    """Mock execute() result that returns `course` for scalar_one()."""
    r = MagicMock()
    r.scalar_one.return_value = course
    return r


def _agent_patches(sample_plan, sample_content, sample_activity_spec):
    """Patch the three lesson-generation agents (for _generate_single_objective tests)."""
    return (
        patch("app.services.generation.run_lesson_planner", AsyncMock(return_value=sample_plan)),
        patch("app.services.generation.run_lesson_writer", AsyncMock(return_value=sample_content)),
        patch("app.services.generation.run_activity_creator", AsyncMock(return_value=sample_activity_spec)),
    )


def _background_patches(sample_plan, sample_content, sample_activity_spec, sample_course_description):
    """Patch all four agents for generate_course_background tests (includes course_describer)."""
    return (
        patch("app.services.generation.run_course_describer", AsyncMock(return_value=sample_course_description)),
        patch("app.services.generation.run_lesson_planner", AsyncMock(return_value=sample_plan)),
        patch("app.services.generation.run_lesson_writer", AsyncMock(return_value=sample_content)),
        patch("app.services.generation.run_activity_creator", AsyncMock(return_value=sample_activity_spec)),
    )


COURSE_ID = "aaaaaaaa-0000-0000-0000-000000000000"
USER_ID = "user-0000"
OBJECTIVES = ["Understand variables", "Understand loops"]
DESCRIPTION = "Intro to Python"


# ---------------------------------------------------------------------------
# _generate_single_objective — happy path
# ---------------------------------------------------------------------------


async def test_happy_path_returns_true(
    patch_background_session, patch_broadcast, sample_plan, sample_content, sample_activity_spec
):
    """Full pipeline succeeds and returns True."""
    mock_db = patch_background_session
    mock_db.execute = AsyncMock(return_value=_no_lesson_result())

    p1, p2, p3 = _agent_patches(sample_plan, sample_content, sample_activity_spec)
    with p1, p2, p3:
        result = await _generate_single_objective(
            COURSE_ID, USER_ID, 0, OBJECTIVES[0], DESCRIPTION,
            OBJECTIVES, None, asyncio.Semaphore(1),
        )

    assert result is True


async def test_lesson_and_activity_rows_added(
    patch_background_session, patch_broadcast, sample_plan, sample_content, sample_activity_spec
):
    """DB.add called at least twice: once for Lesson, once for Activity."""
    mock_db = patch_background_session
    mock_db.execute = AsyncMock(return_value=_no_lesson_result())

    p1, p2, p3 = _agent_patches(sample_plan, sample_content, sample_activity_spec)
    with p1, p2, p3:
        await _generate_single_objective(
            COURSE_ID, USER_ID, 0, OBJECTIVES[0], DESCRIPTION,
            OBJECTIVES, None, asyncio.Semaphore(1),
        )

    assert mock_db.add.call_count >= 2


async def test_lesson_content_stored(
    patch_background_session, patch_broadcast, sample_plan, sample_content, sample_activity_spec
):
    """lesson.lesson_content is set to sample_content.lesson_body."""
    from app.db.models import Lesson

    mock_db = patch_background_session
    mock_db.execute = AsyncMock(return_value=_no_lesson_result())

    added_objects = []

    def _collect(obj):
        _auto_id_add(obj)
        added_objects.append(obj)

    mock_db.add.side_effect = _collect

    p1, p2, p3 = _agent_patches(sample_plan, sample_content, sample_activity_spec)
    with p1, p2, p3:
        await _generate_single_objective(
            COURSE_ID, USER_ID, 0, OBJECTIVES[0], DESCRIPTION,
            OBJECTIVES, None, asyncio.Semaphore(1),
        )

    lessons = [o for o in added_objects if isinstance(o, Lesson)]
    assert len(lessons) == 1
    assert lessons[0].lesson_content == sample_content.lesson_body


async def test_activity_spec_stored_as_dict(
    patch_background_session, patch_broadcast, sample_plan, sample_content, sample_activity_spec
):
    """activity.activity_spec equals sample_activity_spec.model_dump()."""
    from app.db.models import Activity

    mock_db = patch_background_session
    mock_db.execute = AsyncMock(return_value=_no_lesson_result())

    added_objects = []

    def _collect(obj):
        _auto_id_add(obj)
        added_objects.append(obj)

    mock_db.add.side_effect = _collect

    p1, p2, p3 = _agent_patches(sample_plan, sample_content, sample_activity_spec)
    with p1, p2, p3:
        await _generate_single_objective(
            COURSE_ID, USER_ID, 0, OBJECTIVES[0], DESCRIPTION,
            OBJECTIVES, None, asyncio.Semaphore(1),
        )

    activities = [o for o in added_objects if isinstance(o, Activity)]
    assert len(activities) == 1
    assert activities[0].activity_spec == sample_activity_spec.model_dump()


# ---------------------------------------------------------------------------
# _generate_single_objective — lesson status
# ---------------------------------------------------------------------------


async def test_objective_0_status_is_unlocked(
    patch_background_session, patch_broadcast, sample_plan, sample_content, sample_activity_spec
):
    """First lesson (objective_index=0) gets status='unlocked'."""
    from app.db.models import Lesson

    mock_db = patch_background_session
    mock_db.execute = AsyncMock(return_value=_no_lesson_result())

    added_objects = []

    def _collect(obj):
        _auto_id_add(obj)
        added_objects.append(obj)

    mock_db.add.side_effect = _collect

    p1, p2, p3 = _agent_patches(sample_plan, sample_content, sample_activity_spec)
    with p1, p2, p3:
        await _generate_single_objective(
            COURSE_ID, USER_ID, 0, OBJECTIVES[0], DESCRIPTION,
            OBJECTIVES, None, asyncio.Semaphore(1),
        )

    lessons = [o for o in added_objects if isinstance(o, Lesson)]
    assert lessons[0].status == "unlocked"


async def test_objective_1_status_is_locked(
    patch_background_session, patch_broadcast, sample_plan, sample_content, sample_activity_spec
):
    """Subsequent lessons (objective_index > 0) get status='locked'."""
    from app.db.models import Lesson

    mock_db = patch_background_session
    mock_db.execute = AsyncMock(return_value=_no_lesson_result())

    added_objects = []

    def _collect(obj):
        _auto_id_add(obj)
        added_objects.append(obj)

    mock_db.add.side_effect = _collect

    p1, p2, p3 = _agent_patches(sample_plan, sample_content, sample_activity_spec)
    with p1, p2, p3:
        await _generate_single_objective(
            COURSE_ID, USER_ID, 1, OBJECTIVES[1], DESCRIPTION,
            OBJECTIVES, None, asyncio.Semaphore(1),
        )

    lessons = [o for o in added_objects if isinstance(o, Lesson)]
    assert lessons[0].status == "locked"


# ---------------------------------------------------------------------------
# _generate_single_objective — skip logic
# ---------------------------------------------------------------------------


async def test_skips_if_already_complete(patch_background_session, patch_broadcast, sample_lesson):
    """When an existing lesson has content and activities, all agents are skipped."""
    from app.db.models import Activity

    mock_db = patch_background_session
    sample_lesson.lesson_content = "existing content"
    existing_activity = Activity()
    existing_activity.id = "cccccccc-0000-0000-0000-000000000000"
    sample_lesson.activities = [existing_activity]

    existing_result = MagicMock()
    existing_result.scalar_one_or_none.return_value = sample_lesson
    mock_db.execute = AsyncMock(return_value=existing_result)

    planner_mock = AsyncMock()
    with patch("app.services.generation.run_lesson_planner", planner_mock):
        result = await _generate_single_objective(
            COURSE_ID, USER_ID, 0, OBJECTIVES[0], DESCRIPTION,
            OBJECTIVES, None, asyncio.Semaphore(1),
        )

    assert result is True
    planner_mock.assert_not_called()


# ---------------------------------------------------------------------------
# _generate_single_objective — error handling
# ---------------------------------------------------------------------------


async def test_returns_false_on_agent_error(patch_background_session, patch_broadcast):
    """When an agent raises, _generate_single_objective returns False (no re-raise)."""
    mock_db = patch_background_session
    mock_db.execute = AsyncMock(return_value=_no_lesson_result())

    with patch("app.services.generation.run_lesson_planner", AsyncMock(side_effect=RuntimeError("LLM failed"))):
        result = await _generate_single_objective(
            COURSE_ID, USER_ID, 0, OBJECTIVES[0], DESCRIPTION,
            OBJECTIVES, None, asyncio.Semaphore(1),
        )

    assert result is False


# ---------------------------------------------------------------------------
# _generate_single_objective — SSE events
# ---------------------------------------------------------------------------


async def test_broadcasts_correct_events_in_order(
    patch_background_session, patch_broadcast, sample_plan, sample_content, sample_activity_spec
):
    """lesson_planned, lesson_written, activity_created are broadcast in that order."""
    mock_db = patch_background_session
    mock_db.execute = AsyncMock(return_value=_no_lesson_result())

    p1, p2, p3 = _agent_patches(sample_plan, sample_content, sample_activity_spec)
    with p1, p2, p3:
        await _generate_single_objective(
            COURSE_ID, USER_ID, 0, OBJECTIVES[0], DESCRIPTION,
            OBJECTIVES, None, asyncio.Semaphore(1),
        )

    events = [call.args[1] for call in patch_broadcast.call_args_list]
    assert "lesson_planned" in events
    assert "lesson_written" in events
    assert "activity_created" in events
    assert events.index("lesson_planned") < events.index("lesson_written")
    assert events.index("lesson_written") < events.index("activity_created")


# ---------------------------------------------------------------------------
# generate_course_background
#
# This function calls get_background_session() THREE times (all yield the same mock_db):
#   1. Phase 0: fetch CourseInstance, run course_describer, store narrative + lesson_titles
#   2. Inside _generate_single_objective: lesson/activity creation
#   3. Finalization: fetch CourseInstance again, transition state
# So mock_db.execute needs side_effect=[course_result, no_lesson_result, course_result].
# ---------------------------------------------------------------------------


async def test_generate_course_background_transitions_to_active_on_success(
    patch_background_session, patch_broadcast,
    sample_plan, sample_content, sample_activity_spec, sample_course_description, sample_course
):
    """On success, course transitions to 'active' then 'in_progress'."""
    mock_db = patch_background_session
    mock_db.execute = AsyncMock(side_effect=[
        _course_result(sample_course),   # Phase 0 fetch
        _no_lesson_result(),             # lesson existence check
        _course_result(sample_course),   # finalization fetch
    ])

    transition_mock = AsyncMock(
        side_effect=lambda db, course, status: setattr(course, "status", status) or course
    )

    p1, p2, p3, p4 = _background_patches(sample_plan, sample_content, sample_activity_spec, sample_course_description)
    with p1, p2, p3, p4, patch("app.services.generation.transition_course", transition_mock):
        await generate_course_background(
            COURSE_ID, USER_ID, OBJECTIVES, DESCRIPTION,
        )

    transition_calls = [c.args[2] for c in transition_mock.call_args_list]
    assert "active" in transition_calls
    assert "in_progress" in transition_calls


async def test_generate_course_background_transitions_to_generation_failed_on_error(
    patch_background_session, patch_broadcast, sample_course_description, sample_course
):
    """When lesson 0 generation fails, course transitions to 'generation_failed'."""
    mock_db = patch_background_session
    mock_db.execute = AsyncMock(side_effect=[
        _course_result(sample_course),   # Phase 0 fetch
        _no_lesson_result(),             # lesson existence check
        _course_result(sample_course),   # finalization fetch
    ])

    transition_mock = AsyncMock(
        side_effect=lambda db, course, status: setattr(course, "status", status) or course
    )

    with patch("app.services.generation.run_course_describer", AsyncMock(return_value=sample_course_description)), \
         patch("app.services.generation.run_lesson_planner", AsyncMock(side_effect=RuntimeError("boom"))), \
         patch("app.services.generation.transition_course", transition_mock):
        await generate_course_background(
            COURSE_ID, USER_ID, OBJECTIVES, DESCRIPTION,
        )

    transition_calls = [c.args[2] for c in transition_mock.call_args_list]
    assert "generation_failed" in transition_calls


async def test_generate_course_background_broadcasts_generation_complete(
    patch_background_session, patch_broadcast,
    sample_plan, sample_content, sample_activity_spec, sample_course_description, sample_course
):
    """generation_complete is always broadcast on success."""
    mock_db = patch_background_session
    mock_db.execute = AsyncMock(side_effect=[
        _course_result(sample_course),
        _no_lesson_result(),
        _course_result(sample_course),
    ])

    p1, p2, p3, p4 = _background_patches(sample_plan, sample_content, sample_activity_spec, sample_course_description)
    with p1, p2, p3, p4, patch("app.services.generation.transition_course", AsyncMock()):
        await generate_course_background(
            COURSE_ID, USER_ID, OBJECTIVES, DESCRIPTION,
        )

    events = [c.args[1] for c in patch_broadcast.call_args_list]
    assert "generation_complete" in events


async def test_generate_course_background_broadcasts_generation_complete_on_failure(
    patch_background_session, patch_broadcast, sample_course_description, sample_course
):
    """generation_complete is broadcast even when lesson generation fails."""
    mock_db = patch_background_session
    mock_db.execute = AsyncMock(side_effect=[
        _course_result(sample_course),
        _no_lesson_result(),
        _course_result(sample_course),
    ])

    with patch("app.services.generation.run_course_describer", AsyncMock(return_value=sample_course_description)), \
         patch("app.services.generation.run_lesson_planner", AsyncMock(side_effect=RuntimeError("boom"))), \
         patch("app.services.generation.transition_course", AsyncMock()):
        await generate_course_background(
            COURSE_ID, USER_ID, OBJECTIVES, DESCRIPTION,
        )

    events = [c.args[1] for c in patch_broadcast.call_args_list]
    assert "generation_complete" in events


async def test_generate_course_background_sets_generated_description(
    patch_background_session, patch_broadcast,
    sample_plan, sample_content, sample_activity_spec, sample_course_description, sample_course
):
    """course.generated_description is set to the narrative from course_describer (not raw input)."""
    mock_db = patch_background_session
    mock_db.execute = AsyncMock(side_effect=[
        _course_result(sample_course),
        _no_lesson_result(),
        _course_result(sample_course),
    ])

    p1, p2, p3, p4 = _background_patches(sample_plan, sample_content, sample_activity_spec, sample_course_description)
    with p1, p2, p3, p4, patch("app.services.generation.transition_course", AsyncMock()):
        await generate_course_background(
            COURSE_ID, USER_ID, OBJECTIVES, DESCRIPTION,
        )

    assert sample_course.generated_description == sample_course_description.narrative_description
    assert sample_course.generated_description != DESCRIPTION


async def test_generate_course_background_broadcasts_course_described(
    patch_background_session, patch_broadcast,
    sample_plan, sample_content, sample_activity_spec, sample_course_description, sample_course
):
    """course_described is broadcast before lesson_planned."""
    mock_db = patch_background_session
    mock_db.execute = AsyncMock(side_effect=[
        _course_result(sample_course),
        _no_lesson_result(),
        _course_result(sample_course),
    ])

    p1, p2, p3, p4 = _background_patches(sample_plan, sample_content, sample_activity_spec, sample_course_description)
    with p1, p2, p3, p4, patch("app.services.generation.transition_course", AsyncMock()):
        await generate_course_background(
            COURSE_ID, USER_ID, OBJECTIVES, DESCRIPTION,
        )

    events = [c.args[1] for c in patch_broadcast.call_args_list]
    assert "course_described" in events
    assert "lesson_planned" in events
    assert events.index("course_described") < events.index("lesson_planned")


async def test_generate_course_background_stores_lesson_titles(
    patch_background_session, patch_broadcast,
    sample_plan, sample_content, sample_activity_spec, sample_course_description, sample_course
):
    """course.lesson_titles is set from the course_describer output."""
    mock_db = patch_background_session
    mock_db.execute = AsyncMock(side_effect=[
        _course_result(sample_course),
        _no_lesson_result(),
        _course_result(sample_course),
    ])

    p1, p2, p3, p4 = _background_patches(sample_plan, sample_content, sample_activity_spec, sample_course_description)
    with p1, p2, p3, p4, patch("app.services.generation.transition_course", AsyncMock()):
        await generate_course_background(
            COURSE_ID, USER_ID, OBJECTIVES, DESCRIPTION,
        )

    assert sample_course.lesson_titles is not None
    assert len(sample_course.lesson_titles) == len(sample_course_description.lessons)
    assert sample_course.lesson_titles[0]["lesson_title"] == sample_course_description.lessons[0].lesson_title
