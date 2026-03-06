"""Tests for /api/profile endpoints."""

from httpx import AsyncClient


async def test_get_profile_auto_creates(client: AsyncClient, auth_headers: dict):
    resp = await client.get("/api/profile", headers=auth_headers)
    assert resp.status_code == 200
    data = resp.json()
    assert data["version"] == 1
    assert data["learning_goals"] == []
    assert data["interests"] == []


async def test_update_profile(client: AsyncClient, auth_headers: dict):
    # Ensure profile exists
    await client.get("/api/profile", headers=auth_headers)

    resp = await client.put("/api/profile", headers=auth_headers, json={
        "display_name": "Test User",
        "experience_level": "beginner",
        "learning_goals": ["python", "fastapi"],
    })
    assert resp.status_code == 200
    data = resp.json()
    assert data["display_name"] == "Test User"
    assert data["experience_level"] == "beginner"
    assert data["learning_goals"] == ["python", "fastapi"]
    assert data["version"] == 2


async def test_update_profile_partial(client: AsyncClient, auth_headers: dict):
    await client.get("/api/profile", headers=auth_headers)

    # First update
    await client.put("/api/profile", headers=auth_headers, json={
        "display_name": "First",
        "experience_level": "beginner",
    })

    # Partial update - only change display_name
    resp = await client.put("/api/profile", headers=auth_headers, json={
        "display_name": "Second",
    })
    assert resp.status_code == 200
    data = resp.json()
    assert data["display_name"] == "Second"
    assert data["experience_level"] == "beginner"  # unchanged


async def test_profile_isolated_per_user(client: AsyncClient, auth_headers: dict, second_user_headers: dict):
    await client.put("/api/profile", headers=auth_headers, json={
        "display_name": "User One",
    })

    resp = await client.get("/api/profile", headers=second_user_headers)
    assert resp.status_code == 200
    assert resp.json()["display_name"] is None  # fresh profile
