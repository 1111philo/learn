from pydantic import BaseModel, Field


class LessonPlanOutput(BaseModel):
    """Output from the lesson_planner agent."""

    lesson_title: str
    learning_objective: str
    key_concepts: list[str] = Field(min_length=2, max_length=8)
    mastery_criteria: list[str] = Field(min_length=2, max_length=6)
    suggested_activity: "ActivitySeed"
    lesson_outline: list[str] = Field(min_length=3, max_length=10)
    work_product: str | None = None
    intended_audience: str | None = None
    professional_scenario: str | None = None
    challenge_level: str | None = None
    scaffold_plan: str | None = None
    portfolio_contribution: str | None = None


class ActivitySeed(BaseModel):
    """Seed for the activity_creator agent, produced by lesson_planner."""

    activity_type: str
    prompt: str
    expected_evidence: list[str] = Field(min_length=2, max_length=5)
    artifact_type: str | None = None
    employer_skill_signals: list[str] | None = None
    portfolio_eligible: bool | None = None
    revision_required: bool | None = None
    professional_quality_checklist: list[str] | None = None


class LessonContentOutput(BaseModel):
    """Output from the lesson_writer agent."""

    lesson_title: str
    key_takeaways: list[str] = Field(min_length=3, max_length=6)
    lesson_body: str = Field(min_length=200)
