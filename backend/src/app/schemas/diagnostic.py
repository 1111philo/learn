from pydantic import BaseModel, Field


class DiagnosticQuestion(BaseModel):
    """One diagnostic question probing the learner's baseline knowledge."""

    question: str
    rationale: str  # why this reveals relevant baseline knowledge


class DiagnosticSpec(BaseModel):
    """Output from the diagnostic_creator agent."""

    questions: list[DiagnosticQuestion] = Field(min_length=3, max_length=5)


class DiagnosticSubmitRequest(BaseModel):
    """Learner's answers to the diagnostic questions."""

    responses: list[dict]  # [{question: str, answer: str}]


class DiagnosticAnalysis(BaseModel):
    """Output from the diagnostic_analyzer agent."""

    baseline_level: str  # "novice" | "intermediate" | "advanced"
    concept_gaps: list[str]  # topics the learner clearly lacks
    strength_areas: list[str]  # topics the learner already knows well
    rigor_guidance: str  # overall instruction for downstream generation agents
    focus_recommendations: list[str]  # which objectives need more depth/time
