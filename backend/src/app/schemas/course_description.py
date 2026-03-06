from pydantic import BaseModel, Field


class LessonPreview(BaseModel):
    """A preview of a lesson as defined by the course_describer agent."""

    lesson_title: str = Field(min_length=5)
    lesson_summary: str = Field(min_length=30)


class ObjectiveArtifactMapping(BaseModel):
    """Maps a course objective to the artifact the learner will produce."""

    objective_index: int
    artifact_type: str
    artifact_description: str


class CourseDescriptionOutput(BaseModel):
    """Output from the course_describer agent."""

    narrative_description: str = Field(min_length=100)
    lessons: list[LessonPreview] = Field(min_length=1)
    professional_role: str | None = None
    career_context: str | None = None
    final_portfolio_outcome: str | None = None
    objective_artifact_map: list[ObjectiveArtifactMapping] | None = None
