"""Schema contract tests for agent inputs/outputs.

No DB, no LLM, no async needed. These tests verify that:
1. The conftest fixtures produce schema-valid data
2. Pydantic enforces the min/max constraints documented in each schema
3. AgentContext holds the expected fields

When schema fields change (schemas/lesson.py, schemas/activity.py):
→ Update the conftest.py fixtures to match the new schema
→ Update the constraint tests below if limits change
These tests will fail at fixture construction if schemas break — intentional.
"""

import pytest
from pydantic import ValidationError

from app.agents.logging import AgentContext
from app.schemas.activity import ActivityReviewOutput, ActivitySpecOutput
from app.schemas.lesson import ActivitySeed, LessonContentOutput, LessonPlanOutput


# ---------------------------------------------------------------------------
# Fixtures round-trip through Pydantic
# ---------------------------------------------------------------------------


def test_lesson_plan_output_validates(sample_plan):
    """conftest sample_plan is schema-valid and round-trips correctly."""
    dumped = sample_plan.model_dump()
    reparsed = LessonPlanOutput(**dumped)
    assert reparsed.lesson_title == sample_plan.lesson_title
    assert reparsed.learning_objective == sample_plan.learning_objective


def test_lesson_content_output_validates(sample_content):
    """conftest sample_content is schema-valid with lesson_body >= 200 chars."""
    dumped = sample_content.model_dump()
    reparsed = LessonContentOutput(**dumped)
    assert len(reparsed.lesson_body) >= 200
    assert len(reparsed.key_takeaways) >= 3


def test_activity_spec_output_validates(sample_activity_spec):
    """conftest sample_activity_spec is schema-valid with correct min lengths."""
    dumped = sample_activity_spec.model_dump()
    reparsed = ActivitySpecOutput(**dumped)
    assert len(reparsed.instructions) >= 50
    assert len(reparsed.prompt) >= 20
    assert len(reparsed.scoring_rubric) >= 3
    assert len(reparsed.hints) >= 2


# ---------------------------------------------------------------------------
# LessonPlanOutput constraints
# ---------------------------------------------------------------------------


def test_lesson_plan_rejects_too_few_key_concepts():
    """key_concepts requires min 2 items."""
    with pytest.raises(ValidationError):
        LessonPlanOutput(
            lesson_title="T",
            learning_objective="O",
            key_concepts=["only one"],  # min_length=2
            mastery_criteria=["a", "b"],
            suggested_activity=ActivitySeed(
                activity_type="t",
                prompt="p",
                expected_evidence=["e1", "e2"],
            ),
            lesson_outline=["s1", "s2", "s3"],
        )


def test_lesson_plan_rejects_too_many_key_concepts():
    """key_concepts is capped at 8 items."""
    with pytest.raises(ValidationError):
        LessonPlanOutput(
            lesson_title="T",
            learning_objective="O",
            key_concepts=["c1", "c2", "c3", "c4", "c5", "c6", "c7", "c8", "c9"],  # max=8
            mastery_criteria=["a", "b"],
            suggested_activity=ActivitySeed(
                activity_type="t", prompt="p", expected_evidence=["e1", "e2"]
            ),
            lesson_outline=["s1", "s2", "s3"],
        )


def test_lesson_plan_rejects_too_few_mastery_criteria():
    """mastery_criteria requires min 2 items."""
    with pytest.raises(ValidationError):
        LessonPlanOutput(
            lesson_title="T",
            learning_objective="O",
            key_concepts=["c1", "c2"],
            mastery_criteria=["only one"],  # min_length=2
            suggested_activity=ActivitySeed(
                activity_type="t", prompt="p", expected_evidence=["e1", "e2"]
            ),
            lesson_outline=["s1", "s2", "s3"],
        )


def test_lesson_plan_rejects_too_few_outline_steps():
    """lesson_outline requires min 3 steps."""
    with pytest.raises(ValidationError):
        LessonPlanOutput(
            lesson_title="T",
            learning_objective="O",
            key_concepts=["c1", "c2"],
            mastery_criteria=["a", "b"],
            suggested_activity=ActivitySeed(
                activity_type="t", prompt="p", expected_evidence=["e1", "e2"]
            ),
            lesson_outline=["s1", "s2"],  # min_length=3
        )


# ---------------------------------------------------------------------------
# LessonContentOutput constraints
# ---------------------------------------------------------------------------


def test_lesson_content_rejects_short_body():
    """lesson_body must be at least 200 characters."""
    with pytest.raises(ValidationError):
        LessonContentOutput(
            lesson_title="T",
            lesson_body="too short",  # min_length=200
            key_takeaways=["t1", "t2", "t3"],
        )


def test_lesson_content_rejects_too_few_takeaways():
    """key_takeaways requires min 3 items."""
    with pytest.raises(ValidationError):
        LessonContentOutput(
            lesson_title="T",
            lesson_body="A" * 200,
            key_takeaways=["t1", "t2"],  # min_length=3
        )


# ---------------------------------------------------------------------------
# ActivitySpecOutput constraints
# ---------------------------------------------------------------------------


def test_activity_spec_rejects_short_instructions():
    """instructions must be at least 50 characters."""
    with pytest.raises(ValidationError):
        ActivitySpecOutput(
            activity_type="short-answer",
            instructions="too short",  # min_length=50
            prompt="C" * 20,
            scoring_rubric=["r1", "r2", "r3"],
            hints=["h1", "h2"],
        )


def test_activity_spec_rejects_short_prompt():
    """prompt must be at least 20 characters."""
    with pytest.raises(ValidationError):
        ActivitySpecOutput(
            activity_type="short-answer",
            instructions="B" * 50,
            prompt="short",  # min_length=20
            scoring_rubric=["r1", "r2", "r3"],
            hints=["h1", "h2"],
        )


def test_activity_spec_rejects_too_few_rubric_items():
    """scoring_rubric requires min 3 items."""
    with pytest.raises(ValidationError):
        ActivitySpecOutput(
            activity_type="short-answer",
            instructions="B" * 50,
            prompt="C" * 20,
            scoring_rubric=["r1", "r2"],  # min_length=3
            hints=["h1", "h2"],
        )


def test_activity_spec_rejects_too_few_hints():
    """hints requires min 2 items."""
    with pytest.raises(ValidationError):
        ActivitySpecOutput(
            activity_type="short-answer",
            instructions="B" * 50,
            prompt="C" * 20,
            scoring_rubric=["r1", "r2", "r3"],
            hints=["only one"],  # min_length=2
        )


# ---------------------------------------------------------------------------
# ActivityReviewOutput constraints
# ---------------------------------------------------------------------------


def test_activity_review_score_must_be_0_to_100():
    """score is bounded 0–100."""
    with pytest.raises(ValidationError):
        ActivityReviewOutput(
            score=101.0,  # le=100
            rationale="R" * 50,
            strengths=["s1", "s2"],
            improvements=["i1", "i2"],
            tips=["t1", "t2"],
            mastery_decision="meets",
        )


def test_activity_review_valid():
    """Valid ActivityReviewOutput passes validation."""
    review = ActivityReviewOutput(
        score=85.0,
        rationale="R" * 50,
        strengths=["s1", "s2"],
        improvements=["i1", "i2"],
        tips=["t1", "t2"],
        mastery_decision="meets",
    )
    assert review.score == 85.0
    assert review.mastery_decision == "meets"


# ---------------------------------------------------------------------------
# AgentContext
# ---------------------------------------------------------------------------


def test_agent_context_dataclass():
    """AgentContext dataclass holds db, user_id, course_instance_id."""
    from unittest.mock import MagicMock

    db = MagicMock()
    ctx = AgentContext(db=db, user_id="u-123", course_instance_id="c-456")
    assert ctx.db is db
    assert ctx.user_id == "u-123"
    assert ctx.course_instance_id == "c-456"
