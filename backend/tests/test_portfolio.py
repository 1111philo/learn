"""Tests for /api/portfolio endpoints."""

from httpx import AsyncClient
from sqlalchemy.ext.asyncio import AsyncSession

from app.db.models import CourseInstance, Lesson, PortfolioArtifact


async def _get_user_id(client: AsyncClient, headers: dict) -> str:
    resp = await client.get("/api/auth/me", headers=headers)
    return resp.json()["id"]


async def _create_artifact(db_session: AsyncSession, user_id: str, **overrides) -> str:
    """Create a course and portfolio artifact directly in DB. Returns artifact_id."""
    course = CourseInstance(
        user_id=user_id,
        source_type="custom",
        input_description="Test",
        input_objectives=["Obj"],
        status="in_progress",
    )
    db_session.add(course)
    await db_session.flush()

    lesson = Lesson(
        course_instance_id=course.id,
        objective_index=0,
        status="unlocked",
    )
    db_session.add(lesson)
    await db_session.flush()

    artifact = PortfolioArtifact(
        user_id=user_id,
        course_instance_id=course.id,
        lesson_id=lesson.id,
        artifact_type="document",
        title="Test Artifact",
        status="draft",
        skills=["python"],
        **overrides,
    )
    db_session.add(artifact)
    await db_session.commit()
    return artifact.id


async def test_list_portfolio_empty(client: AsyncClient, auth_headers: dict):
    resp = await client.get("/api/portfolio", headers=auth_headers)
    assert resp.status_code == 200
    assert resp.json() == []


async def test_list_portfolio_with_artifact(client: AsyncClient, auth_headers: dict, db_session: AsyncSession):
    user_id = await _get_user_id(client, auth_headers)
    artifact_id = await _create_artifact(db_session, user_id)

    resp = await client.get("/api/portfolio", headers=auth_headers)
    assert resp.status_code == 200
    data = resp.json()
    assert len(data) == 1
    assert data[0]["id"] == artifact_id
    assert data[0]["title"] == "Test Artifact"


async def test_get_artifact(client: AsyncClient, auth_headers: dict, db_session: AsyncSession):
    user_id = await _get_user_id(client, auth_headers)
    artifact_id = await _create_artifact(db_session, user_id)

    resp = await client.get(f"/api/portfolio/{artifact_id}", headers=auth_headers)
    assert resp.status_code == 200
    assert resp.json()["id"] == artifact_id


async def test_get_artifact_other_user(client: AsyncClient, auth_headers: dict, second_user_headers: dict, db_session: AsyncSession):
    user_id = await _get_user_id(client, auth_headers)
    artifact_id = await _create_artifact(db_session, user_id)

    resp = await client.get(f"/api/portfolio/{artifact_id}", headers=second_user_headers)
    assert resp.status_code == 404


async def test_update_artifact_title(client: AsyncClient, auth_headers: dict, db_session: AsyncSession):
    user_id = await _get_user_id(client, auth_headers)
    artifact_id = await _create_artifact(db_session, user_id)

    resp = await client.patch(f"/api/portfolio/{artifact_id}", headers=auth_headers, json={
        "title": "Updated Title",
    })
    assert resp.status_code == 200
    assert resp.json()["title"] == "Updated Title"


async def test_update_artifact_status(client: AsyncClient, auth_headers: dict, db_session: AsyncSession):
    user_id = await _get_user_id(client, auth_headers)
    artifact_id = await _create_artifact(db_session, user_id)

    resp = await client.patch(f"/api/portfolio/{artifact_id}", headers=auth_headers, json={
        "status": "portfolio_ready",
    })
    assert resp.status_code == 200
    assert resp.json()["status"] == "portfolio_ready"


async def test_update_artifact_invalid_status(client: AsyncClient, auth_headers: dict, db_session: AsyncSession):
    user_id = await _get_user_id(client, auth_headers)
    artifact_id = await _create_artifact(db_session, user_id)

    resp = await client.patch(f"/api/portfolio/{artifact_id}", headers=auth_headers, json={
        "status": "invalid_status",
    })
    assert resp.status_code == 400


async def test_portfolio_summary(client: AsyncClient, auth_headers: dict, db_session: AsyncSession):
    user_id = await _get_user_id(client, auth_headers)
    await _create_artifact(db_session, user_id)

    resp = await client.get("/api/portfolio/summary", headers=auth_headers)
    assert resp.status_code == 200
    data = resp.json()
    assert data["total"] == 1
    assert data["by_status"]["draft"] == 1
