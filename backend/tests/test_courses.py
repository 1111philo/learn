"""Tests for /api/courses endpoints."""

from httpx import AsyncClient


async def _create_course(client: AsyncClient, headers: dict, **overrides) -> dict:
    payload = {
        "description": "Test course",
        "objectives": ["Objective 1", "Objective 2"],
        **overrides,
    }
    resp = await client.post("/api/courses", headers=headers, json=payload)
    assert resp.status_code == 200
    return resp.json()


async def test_create_course(client: AsyncClient, auth_headers: dict):
    data = await _create_course(client, auth_headers)
    assert "id" in data
    assert data["status"] == "draft"


async def test_create_course_empty_objectives(client: AsyncClient, auth_headers: dict):
    resp = await client.post("/api/courses", headers=auth_headers, json={
        "description": "Test",
        "objectives": [],
    })
    assert resp.status_code == 422


async def test_list_courses(client: AsyncClient, auth_headers: dict):
    await _create_course(client, auth_headers, description="Course 1")
    await _create_course(client, auth_headers, description="Course 2")

    resp = await client.get("/api/courses", headers=auth_headers)
    assert resp.status_code == 200
    assert len(resp.json()) == 2


async def test_list_courses_filter_by_status(client: AsyncClient, auth_headers: dict):
    await _create_course(client, auth_headers)
    resp = await client.get("/api/courses?status=draft", headers=auth_headers)
    assert resp.status_code == 200
    assert len(resp.json()) == 1

    resp = await client.get("/api/courses?status=active", headers=auth_headers)
    assert resp.status_code == 200
    assert len(resp.json()) == 0


async def test_get_course(client: AsyncClient, auth_headers: dict):
    created = await _create_course(client, auth_headers)
    resp = await client.get(f"/api/courses/{created['id']}", headers=auth_headers)
    assert resp.status_code == 200
    data = resp.json()
    assert data["id"] == created["id"]
    assert data["status"] == "draft"
    assert data["input_objectives"] == ["Objective 1", "Objective 2"]


async def test_get_course_not_found(client: AsyncClient, auth_headers: dict):
    resp = await client.get("/api/courses/nonexistent-id", headers=auth_headers)
    assert resp.status_code == 404


async def test_get_course_other_user(client: AsyncClient, auth_headers: dict, second_user_headers: dict):
    created = await _create_course(client, auth_headers)
    resp = await client.get(f"/api/courses/{created['id']}", headers=second_user_headers)
    assert resp.status_code == 404


async def test_delete_course(client: AsyncClient, auth_headers: dict):
    created = await _create_course(client, auth_headers)
    resp = await client.delete(f"/api/courses/{created['id']}", headers=auth_headers)
    assert resp.status_code == 200
    assert resp.json()["deleted"] is True

    resp = await client.get(f"/api/courses/{created['id']}", headers=auth_headers)
    assert resp.status_code == 404


async def test_delete_course_other_user(client: AsyncClient, auth_headers: dict, second_user_headers: dict):
    created = await _create_course(client, auth_headers)
    resp = await client.delete(f"/api/courses/{created['id']}", headers=second_user_headers)
    assert resp.status_code == 404


async def test_trigger_generation_wrong_state(client: AsyncClient, auth_headers: dict):
    """Can only trigger generation from draft or generation_failed state."""
    created = await _create_course(client, auth_headers)
    # First trigger should work (draft → generating)
    resp = await client.post(f"/api/courses/{created['id']}/generate", headers=auth_headers)
    assert resp.status_code == 200
    assert resp.json()["status"] == "generating"

    # Second trigger should fail (already generating)
    resp = await client.post(f"/api/courses/{created['id']}/generate", headers=auth_headers)
    assert resp.status_code == 400


async def test_update_course_state_invalid_transition(client: AsyncClient, auth_headers: dict):
    created = await _create_course(client, auth_headers)
    # draft → completed is not a valid transition
    resp = await client.patch(
        f"/api/courses/{created['id']}/state?target_state=completed",
        headers=auth_headers,
    )
    assert resp.status_code == 400


async def test_unauthenticated_access(client: AsyncClient):
    resp = await client.get("/api/courses")
    assert resp.status_code == 401

    resp = await client.post("/api/courses", json={
        "description": "Test",
        "objectives": ["Obj1"],
    })
    assert resp.status_code == 401
