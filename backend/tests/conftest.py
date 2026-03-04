"""Shared fixtures for the generation test suite."""

import uuid as _uuid
from contextlib import asynccontextmanager
from unittest.mock import AsyncMock, MagicMock, patch

import pytest


def _auto_id_add(obj):
    """Assign a UUID to obj.id if it's None, mimicking SQLAlchemy's flush behavior."""
    if hasattr(obj, "id") and obj.id is None:
        obj.id = str(_uuid.uuid4())


@pytest.fixture
def mock_db():
    """Minimal AsyncSession mock.

    db.add() auto-assigns UUIDs to simulate what SQLAlchemy does during flush.
    Tests can override add.side_effect but should include _auto_id_add when
    they also need to collect the added objects.
    """
    session = AsyncMock()
    session.add = MagicMock(side_effect=_auto_id_add)
    return session


@pytest.fixture
def patch_background_session(mock_db):
    """Patch get_background_session in generation.py to yield mock_db."""

    @asynccontextmanager
    async def _fake():
        yield mock_db

    with patch("app.services.generation.get_background_session", _fake):
        yield mock_db


@pytest.fixture
def patch_broadcast():
    """Suppress SSE broadcast calls in generation.py."""
    with patch("app.services.generation.broadcast", new=AsyncMock()) as m:
        yield m


@pytest.fixture
def sample_plan():
    from app.schemas.lesson import ActivitySeed, LessonPlanOutput

    return LessonPlanOutput(
        lesson_title="Introduction to Variables",
        learning_objective="Declare and use variables in Python",
        key_concepts=["variable", "assignment", "type"],
        mastery_criteria=[
            "Can declare int/str/float variables",
            "Can explain reassignment",
        ],
        suggested_activity=ActivitySeed(
            activity_type="short-answer",
            prompt="Explain what happens when you reassign a variable.",
            expected_evidence=["mentions memory", "uses an example"],
        ),
        lesson_outline=[
            "Define variable",
            "Show assignment",
            "Demonstrate types",
            "Work through example",
        ],
    )


@pytest.fixture
def sample_content():
    from app.schemas.lesson import LessonContentOutput

    return LessonContentOutput(
        lesson_title="Introduction to Variables",
        lesson_body="A" * 200,
        key_takeaways=[
            "Variables store values",
            "Types matter",
            "Reassignment replaces the value",
        ],
    )


@pytest.fixture
def sample_activity_spec():
    from app.schemas.activity import ActivitySpecOutput

    return ActivitySpecOutput(
        activity_type="short-answer",
        instructions="B" * 50,
        prompt="C" * 20,
        scoring_rubric=["criterion 1", "criterion 2", "criterion 3"],
        hints=["hint 1", "hint 2"],
    )


@pytest.fixture
def sample_course():
    from app.db.models import CourseInstance

    c = CourseInstance()
    c.id = "aaaaaaaa-0000-0000-0000-000000000000"
    c.user_id = "user-0000"
    c.status = "draft"
    c.input_objectives = ["Understand variables", "Understand loops"]
    c.input_description = "Intro to Python"
    c.generated_description = None
    c.lessons = []
    c.assessments = []
    return c


@pytest.fixture
def sample_lesson():
    from app.db.models import Lesson

    l = Lesson()
    l.id = "bbbbbbbb-0000-0000-0000-000000000000"
    l.course_instance_id = "aaaaaaaa-0000-0000-0000-000000000000"
    l.objective_index = 0
    l.lesson_content = None
    l.status = "unlocked"
    l.activities = []
    return l
