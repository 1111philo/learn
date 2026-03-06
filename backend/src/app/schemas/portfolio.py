from datetime import datetime

from pydantic import BaseModel


class PortfolioArtifactResponse(BaseModel):
    id: str
    course_instance_id: str
    lesson_id: str | None
    artifact_type: str
    title: str
    content_pointer: str | None
    status: str
    skills: list[str]
    audience: str | None
    employer_use_case: str | None
    resume_bullet_seed: str | None
    created_at: datetime
    updated_at: datetime

    model_config = {"from_attributes": True}


class PortfolioArtifactListItem(BaseModel):
    id: str
    title: str
    artifact_type: str
    status: str
    skills: list[str]
    course_instance_id: str

    model_config = {"from_attributes": True}


class PortfolioArtifactUpdateRequest(BaseModel):
    title: str | None = None
    status: str | None = None


class PortfolioSummary(BaseModel):
    artifacts: list[PortfolioArtifactResponse]
    total: int
    by_status: dict[str, int]
