"""Tests for /api/catalog endpoints."""

import json
import tempfile
from pathlib import Path
from unittest.mock import patch

from httpx import AsyncClient

from app.services.catalog import load_catalog


def _setup_test_catalog(tmp: Path):
    """Create test course JSON files in a temp directory."""
    course_a = tmp / "course-a"
    course_a.mkdir()
    (course_a / "course.json").write_text(json.dumps({
        "courseId": "course-a",
        "name": "Course A",
        "description": "First course",
        "learningObjectives": ["Obj A1", "Obj A2"],
        "tags": ["basics"],
        "estimatedHours": 2,
    }))

    course_b = tmp / "course-b"
    course_b.mkdir()
    (course_b / "course.json").write_text(json.dumps({
        "courseId": "course-b",
        "name": "Course B",
        "description": "Second course",
        "dependsOn": "course-a",
        "learningObjectives": ["Obj B1"],
        "tags": ["advanced"],
        "estimatedHours": 3,
    }))

    load_catalog(tmp)


async def test_list_catalog(client: AsyncClient, auth_headers: dict, tmp_path: Path):
    _setup_test_catalog(tmp_path)

    resp = await client.get("/api/catalog", headers=auth_headers)
    assert resp.status_code == 200
    data = resp.json()
    assert len(data["courses"]) == 2
    assert data["all_completed"] is False

    course_a = next(c for c in data["courses"] if c["course_id"] == "course-a")
    assert course_a["locked"] is False
    assert course_a["completed"] is False

    course_b = next(c for c in data["courses"] if c["course_id"] == "course-b")
    assert course_b["locked"] is True  # depends on course-a


async def test_start_predefined_course(client: AsyncClient, auth_headers: dict, tmp_path: Path):
    _setup_test_catalog(tmp_path)

    resp = await client.post("/api/catalog/course-a/start", headers=auth_headers)
    assert resp.status_code == 200
    data = resp.json()
    assert data["status"] == "draft"
    assert "id" in data


async def test_start_predefined_course_idempotent(client: AsyncClient, auth_headers: dict, tmp_path: Path):
    _setup_test_catalog(tmp_path)

    resp1 = await client.post("/api/catalog/course-a/start", headers=auth_headers)
    resp2 = await client.post("/api/catalog/course-a/start", headers=auth_headers)
    assert resp1.json()["id"] == resp2.json()["id"]  # same instance returned


async def test_start_locked_course_blocked(client: AsyncClient, auth_headers: dict, tmp_path: Path):
    _setup_test_catalog(tmp_path)

    resp = await client.post("/api/catalog/course-b/start", headers=auth_headers)
    assert resp.status_code == 400
    assert "Course A" in resp.json()["detail"]


async def test_start_nonexistent_course(client: AsyncClient, auth_headers: dict, tmp_path: Path):
    _setup_test_catalog(tmp_path)

    resp = await client.post("/api/catalog/no-such-course/start", headers=auth_headers)
    assert resp.status_code == 404
