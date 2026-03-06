"""Tests for /api/auth endpoints."""

from httpx import AsyncClient


async def test_register_success(client: AsyncClient):
    resp = await client.post("/api/auth/register", json={
        "email": "new@example.com",
        "password": "password123",
    })
    assert resp.status_code == 200
    data = resp.json()
    assert "token" in data
    assert data["user"]["email"] == "new@example.com"
    assert "id" in data["user"]


async def test_register_duplicate_email(client: AsyncClient):
    payload = {"email": "dup@example.com", "password": "password123"}
    resp1 = await client.post("/api/auth/register", json=payload)
    assert resp1.status_code == 200

    resp2 = await client.post("/api/auth/register", json=payload)
    assert resp2.status_code == 409
    assert "already registered" in resp2.json()["detail"]


async def test_register_short_password(client: AsyncClient):
    resp = await client.post("/api/auth/register", json={
        "email": "short@example.com",
        "password": "abc",
    })
    assert resp.status_code == 422


async def test_register_invalid_email(client: AsyncClient):
    resp = await client.post("/api/auth/register", json={
        "email": "not-an-email",
        "password": "password123",
    })
    assert resp.status_code == 422


async def test_login_success(client: AsyncClient):
    await client.post("/api/auth/register", json={
        "email": "login@example.com",
        "password": "password123",
    })
    resp = await client.post("/api/auth/login", json={
        "email": "login@example.com",
        "password": "password123",
    })
    assert resp.status_code == 200
    data = resp.json()
    assert "token" in data
    assert data["user"]["email"] == "login@example.com"


async def test_login_wrong_password(client: AsyncClient):
    await client.post("/api/auth/register", json={
        "email": "wrong@example.com",
        "password": "password123",
    })
    resp = await client.post("/api/auth/login", json={
        "email": "wrong@example.com",
        "password": "wrongpassword",
    })
    assert resp.status_code == 401


async def test_login_nonexistent_user(client: AsyncClient):
    resp = await client.post("/api/auth/login", json={
        "email": "noone@example.com",
        "password": "password123",
    })
    assert resp.status_code == 401


async def test_me_authenticated(client: AsyncClient, auth_headers: dict):
    resp = await client.get("/api/auth/me", headers=auth_headers)
    assert resp.status_code == 200
    assert resp.json()["email"] == "test@example.com"


async def test_me_no_token(client: AsyncClient):
    resp = await client.get("/api/auth/me")
    assert resp.status_code == 401


async def test_me_invalid_token(client: AsyncClient):
    resp = await client.get("/api/auth/me", headers={"Authorization": "Bearer invalid.token.here"})
    assert resp.status_code == 401
