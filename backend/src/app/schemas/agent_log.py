from datetime import datetime

from pydantic import BaseModel


class AgentLogResponse(BaseModel):
    id: str
    course_instance_id: str
    agent_name: str
    prompt: str
    output: str | None
    status: str
    duration_ms: int | None
    input_tokens: int | None
    output_tokens: int | None
    model_name: str | None
    created_at: datetime

    model_config = {"from_attributes": True}
