"""Track in-flight background tasks and broadcast SSE events to subscribers."""

import asyncio
import logging
from typing import Any

logger = logging.getLogger(__name__)

# {key: asyncio.Task}
_active_tasks: dict[str, asyncio.Task] = {}

# {key: list[asyncio.Queue]}
_subscribers: dict[str, list[asyncio.Queue]] = {}


def start_generation(key: str, coro) -> asyncio.Task:
    """Spawn a background task and track it."""
    if key in _active_tasks and not _active_tasks[key].done():
        raise RuntimeError(f"Task already running for key {key}")

    task = asyncio.create_task(coro)
    _active_tasks[key] = task

    # Auto-cleanup when the task finishes
    task.add_done_callback(lambda _t: cleanup(key))
    return task


def subscribe(key: str) -> asyncio.Queue:
    """Create a new SSE subscriber queue."""
    queue: asyncio.Queue = asyncio.Queue()
    _subscribers.setdefault(key, []).append(queue)
    return queue


def unsubscribe(key: str, queue: asyncio.Queue) -> None:
    """Remove a subscriber queue."""
    queues = _subscribers.get(key, [])
    if queue in queues:
        queues.remove(queue)
    if not queues:
        _subscribers.pop(key, None)


async def broadcast(key: str, event: str, data: dict[str, Any] | None = None) -> None:
    """Send an SSE event to all subscribers."""
    message = {"event": event, "data": data or {}}
    for queue in _subscribers.get(key, []):
        try:
            queue.put_nowait(message)
        except asyncio.QueueFull:
            logger.warning("SSE queue full for key %s, dropping event %s", key, event)


def is_running(key: str) -> bool:
    """Check if a background task is currently in-flight."""
    task = _active_tasks.get(key)
    return task is not None and not task.done()


def cleanup(key: str) -> None:
    """Remove tracking state for a completed task."""
    _active_tasks.pop(key, None)
    # Don't remove subscribers here -- they may still be draining events.
    # They'll be removed when they unsubscribe.
