"""Tests for /api/activities endpoints."""

from httpx import AsyncClient
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.db.models import Activity, CourseInstance, Lesson


async def _create_course_with_activity(db_session: AsyncSession, user_id: str) -> tuple[str, str, str]:
    """Create a course → lesson → activity directly in DB. Returns (course_id, lesson_id, activity_id)."""
    course = CourseInstance(
        user_id=user_id,
        source_type="custom",
        input_description="Test course",
        input_objectives=["Obj 1"],
        status="in_progress",
    )
    db_session.add(course)
    await db_session.flush()

    lesson = Lesson(
        course_instance_id=course.id,
        objective_index=0,
        lesson_content="Test lesson content",
        status="unlocked",
    )
    db_session.add(lesson)
    await db_session.flush()

    activity = Activity(
        lesson_id=lesson.id,
        activity_index=0,
        activity_status="active",
        activity_spec={
            "prompt": "Write a test document",
            "scoring_rubric": ["clarity", "completeness", "accuracy"],
            "hints": ["Be specific", "Use examples"],
        },
    )
    db_session.add(activity)
    await db_session.commit()

    return course.id, lesson.id, activity.id


async def _get_user_id(client: AsyncClient, headers: dict) -> str:
    resp = await client.get("/api/auth/me", headers=headers)
    return resp.json()["id"]


async def test_list_activities_for_lesson(client: AsyncClient, auth_headers: dict, db_session: AsyncSession):
    user_id = await _get_user_id(client, auth_headers)
    _, lesson_id, activity_id = await _create_course_with_activity(db_session, user_id)

    resp = await client.get(f"/api/activities/by-lesson/{lesson_id}", headers=auth_headers)
    assert resp.status_code == 200
    data = resp.json()
    assert len(data) == 1
    assert data[0]["id"] == activity_id
    assert data[0]["activity_status"] == "active"


async def test_get_activity(client: AsyncClient, auth_headers: dict, db_session: AsyncSession):
    user_id = await _get_user_id(client, auth_headers)
    _, _, activity_id = await _create_course_with_activity(db_session, user_id)

    resp = await client.get(f"/api/activities/{activity_id}", headers=auth_headers)
    assert resp.status_code == 200
    data = resp.json()
    assert data["id"] == activity_id
    assert data["activity_spec"]["prompt"] == "Write a test document"


async def test_get_activity_not_found(client: AsyncClient, auth_headers: dict):
    resp = await client.get("/api/activities/nonexistent", headers=auth_headers)
    assert resp.status_code == 404


async def test_get_activity_other_user(client: AsyncClient, auth_headers: dict, second_user_headers: dict, db_session: AsyncSession):
    user_id = await _get_user_id(client, auth_headers)
    _, _, activity_id = await _create_course_with_activity(db_session, user_id)

    resp = await client.get(f"/api/activities/{activity_id}", headers=second_user_headers)
    assert resp.status_code == 404


async def test_list_activities_other_user(client: AsyncClient, auth_headers: dict, second_user_headers: dict, db_session: AsyncSession):
    user_id = await _get_user_id(client, auth_headers)
    _, lesson_id, _ = await _create_course_with_activity(db_session, user_id)

    resp = await client.get(f"/api/activities/by-lesson/{lesson_id}", headers=second_user_headers)
    assert resp.status_code == 404
