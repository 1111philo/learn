from pydantic import BaseModel, Field


class LessonPreview(BaseModel):
    """A preview of a lesson as defined by the course_describer agent."""

    lesson_title: str = Field(min_length=5)
    lesson_summary: str = Field(min_length=30)


class CourseDescriptionOutput(BaseModel):
    """Output from the course_describer agent."""

    narrative_description: str = Field(min_length=100)
    lessons: list[LessonPreview] = Field(min_length=1)
