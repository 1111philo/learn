from pydantic import BaseModel, Field


class ActivitySpecOutput(BaseModel):
    """Output from the activity_creator agent."""

    activity_type: str
    instructions: str = Field(min_length=50)
    prompt: str = Field(min_length=20)
    scoring_rubric: list[str] = Field(min_length=3, max_length=6)
    hints: list[str] = Field(min_length=2, max_length=5)
    artifact_type: str | None = None
    employer_skill_signals: list[str] | None = None
    portfolio_eligible: bool | None = None
    revision_required: bool | None = None
    professional_quality_checklist: list[str] | None = None


class ActivitySubmitRequest(BaseModel):
    text: str = Field(min_length=1)


class ActivityReviewOutput(BaseModel):
    """Output from the activity_reviewer agent."""

    score: float = Field(ge=0, le=100)
    rationale: str = Field(min_length=50)
    strengths: list[str] = Field(min_length=2, max_length=5)
    improvements: list[str] = Field(min_length=2, max_length=5)
    tips: list[str] = Field(min_length=2, max_length=6)
    mastery_decision: str  # not_yet, meets, exceeds
    portfolio_readiness: str | None = None  # practice_only, emerging_portfolio_piece, portfolio_ready
    employer_relevance_notes: str | None = None
    revision_priority: str | None = None
    resume_bullet_seed: str | None = None


class ActivitySubmitResponse(BaseModel):
    id: str
    status: str  # "reviewing"


class ActivityResponse(BaseModel):
    id: str
    activity_spec: dict | None = None
    latest_score: float | None = None
    latest_feedback: dict | None = None
    mastery_decision: str | None = None
    attempt_count: int = 0
    submissions: list[dict] = []
    reviewing: bool = False
    portfolio_readiness: str | None = None
    revision_count: int = 0
    portfolio_artifact_id: str | None = None
