"""Unit tests for the SSE generation tracker (generation_tracker.py).

No mocks needed — tests the real in-memory module.
Module-level state (_active_tasks, _subscribers) is reset between tests
via the autouse `reset_tracker` fixture.
"""

import asyncio

import pytest

from app.services import generation_tracker
from app.services.generation_tracker import (
    broadcast,
    cleanup,
    is_running,
    start_generation,
    subscribe,
    unsubscribe,
)


@pytest.fixture(autouse=True)
def reset_tracker():
    """Clear module-level state before each test to prevent cross-test pollution."""
    generation_tracker._active_tasks.clear()
    generation_tracker._subscribers.clear()
    yield
    generation_tracker._active_tasks.clear()
    generation_tracker._subscribers.clear()


# ---------------------------------------------------------------------------
# broadcast / subscribe / unsubscribe
# ---------------------------------------------------------------------------


async def test_broadcast_delivers_to_subscriber():
    """Messages sent via broadcast are received by the subscribed queue."""
    queue = subscribe("course-1")
    await broadcast("course-1", "lesson_planned", {"objective_index": 0})

    msg = queue.get_nowait()
    assert msg["event"] == "lesson_planned"
    assert msg["data"]["objective_index"] == 0

    unsubscribe("course-1", queue)


async def test_broadcast_no_subscribers_does_not_raise():
    """broadcast with no subscribers completes silently."""
    await broadcast("nonexistent-course", "some_event", {})


async def test_unsubscribe_removes_queue():
    """After unsubscribe, the queue receives no further messages."""
    queue = subscribe("course-2")
    unsubscribe("course-2", queue)
    await broadcast("course-2", "lesson_planned", {})
    assert queue.empty()


async def test_multiple_subscribers_all_receive():
    """All subscribers for a key receive the same broadcast."""
    q1 = subscribe("course-3")
    q2 = subscribe("course-3")
    await broadcast("course-3", "activity_created", {"activity_id": "abc"})

    assert not q1.empty()
    assert not q2.empty()
    assert q1.get_nowait()["event"] == "activity_created"
    assert q2.get_nowait()["event"] == "activity_created"

    unsubscribe("course-3", q1)
    unsubscribe("course-3", q2)


async def test_broadcast_includes_empty_data_when_none():
    """broadcast normalises None data to an empty dict."""
    queue = subscribe("course-4")
    await broadcast("course-4", "generation_complete", None)

    msg = queue.get_nowait()
    assert msg["data"] == {}
    unsubscribe("course-4", queue)


# ---------------------------------------------------------------------------
# is_running / start_generation / cleanup
# ---------------------------------------------------------------------------


def test_is_running_false_for_unknown_key():
    """is_running returns False for a key with no active task."""
    assert is_running("no-such-task") is False


async def test_start_generation_tracks_running_task():
    """is_running returns True while a long-running task is in flight."""
    event = asyncio.Event()

    async def long_running():
        await event.wait()

    task = start_generation("task-1", long_running())
    assert is_running("task-1") is True

    event.set()
    await task


async def test_start_generation_raises_if_already_running():
    """Calling start_generation for a running key raises RuntimeError."""
    event = asyncio.Event()

    async def long_running():
        await event.wait()

    task = start_generation("task-2", long_running())

    with pytest.raises(RuntimeError, match="already running"):
        start_generation("task-2", long_running())

    event.set()
    await task


async def test_cleanup_removes_task_tracking():
    """cleanup() removes the key from active tasks."""
    async def noop():
        pass

    task = start_generation("task-3", noop())
    await task
    # done_callback fires cleanup automatically after task completes
    assert is_running("task-3") is False


async def test_is_running_false_after_task_completes():
    """is_running returns False once a task finishes naturally."""
    async def quick():
        pass

    task = start_generation("task-4", quick())
    await task
    # Give done_callback a chance to run
    await asyncio.sleep(0)
    assert is_running("task-4") is False
