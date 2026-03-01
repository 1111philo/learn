"""Shared helpers for the kickoff -> SSE -> REST-fetchable async pattern."""

import asyncio
import json
from collections.abc import AsyncGenerator, Awaitable, Callable
from typing import Any

from fastapi import HTTPException

from app.services.generation_tracker import (
    is_running,
    start_generation,
    subscribe,
    unsubscribe,
)


async def sse_event_generator(
    key: str,
    *,
    catchup: list[dict[str, Any]] | None = None,
    is_done: bool = False,
    done_event: dict[str, Any] | None = None,
    not_started_event: dict[str, Any] | None = None,
    terminal_events: set[str],
    on_timeout_fallback: Callable[[], Awaitable[dict[str, Any] | None]] | None = None,
    poll_interval: float = 5.0,
) -> AsyncGenerator[dict, None]:
    """Generic SSE event generator for the kickoff -> stream -> complete pattern.

    Args:
        key: The generation_tracker key to subscribe to.
        catchup: Pre-built catchup events to yield first.
            Each dict has "event" and "data" keys (data is a dict, not JSON string).
        is_done: If True, the process already completed before we connected.
        done_event: Event to yield when is_done is True. Dict with "event" and "data".
        not_started_event: Event to yield when nothing is running and is_done is False.
        terminal_events: Set of event names that signal end of stream.
        on_timeout_fallback: Async callback invoked when the task is no longer running
            but we timed out waiting for a message. Should re-query DB and return
            a dict {"event": ..., "data": ...} to yield, or None to fall through
            to not_started_event.
        poll_interval: Seconds between keepalive checks (default 5.0).
    """
    # Phase 1: Catchup
    if catchup:
        for evt in catchup:
            yield {"event": evt["event"], "data": json.dumps(evt["data"])}

    # Phase 2: Already done
    if is_done:
        if done_event:
            yield {"event": done_event["event"], "data": json.dumps(done_event["data"])}
        return

    # Phase 3: Not started (and not done)
    if not is_running(key):
        if not_started_event:
            yield {
                "event": not_started_event["event"],
                "data": json.dumps(not_started_event["data"]),
            }
        return

    # Phase 4: Live subscription
    queue = subscribe(key)
    try:
        while True:
            try:
                message = await asyncio.wait_for(queue.get(), timeout=poll_interval)
            except asyncio.TimeoutError:
                if not is_running(key):
                    # Task ended — try fallback DB check
                    if on_timeout_fallback:
                        fallback = await on_timeout_fallback()
                        if fallback:
                            yield {
                                "event": fallback["event"],
                                "data": json.dumps(fallback["data"]),
                            }
                            return
                    # No fallback or fallback returned None
                    if not_started_event:
                        yield {
                            "event": not_started_event["event"],
                            "data": json.dumps(not_started_event["data"]),
                        }
                    return
                yield {"comment": "keepalive"}
                continue

            yield {
                "event": message["event"],
                "data": json.dumps(message["data"]),
            }

            if message["event"] in terminal_events:
                return
    finally:
        unsubscribe(key, queue)


def kickoff_background_task(
    key: str,
    coro,
    *,
    conflict_detail: str = "Already in progress",
) -> None:
    """Guard + spawn for background LLM tasks.

    Checks is_running, then calls start_generation. Raises HTTP 409 if already running.
    The caller MUST commit any DB state changes BEFORE calling this.
    """
    if is_running(key):
        raise HTTPException(status_code=409, detail=conflict_detail)
    try:
        start_generation(key, coro)
    except RuntimeError:
        raise HTTPException(status_code=409, detail=conflict_detail)
