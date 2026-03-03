from pydantic import BaseModel, Field


class ActivitySeed(BaseModel):
    """Seed for one activity, used as input to the activity_creator agent."""

    activity_type: str
    prompt: str
    expected_evidence: list[str] = Field(min_length=2, max_length=5)


class SubLessonSeed(BaseModel):
    """Seed for one focused sub-lesson within an objective."""

    sub_lesson_index: int  # 0-based within objective
    title: str  # shown in sidebar
    concept_focus: str  # the single concept this sub-lesson teaches
    activity_seed: ActivitySeed
    difficulty_level: int  # 1=intro, 2=application, 3=pre-mastery


class ObjectivePlanOutput(BaseModel):
    """Output from the lesson_planner agent.

    Plans ALL sub-lessons (focused + capstone) for one objective at once.
    """

    objective_title: str  # used as group label in sidebar
    key_concepts: list[str] = Field(min_length=2, max_length=4)
    mastery_criteria: list[str] = Field(min_length=2, max_length=6)
    sub_lesson_seeds: list[SubLessonSeed] = Field(min_length=2, max_length=3)
    capstone_seed: ActivitySeed  # integrative, hardest


class LessonContentOutput(BaseModel):
    """Output from the lesson_writer agent."""

    lesson_title: str
    lesson_body: str = Field(min_length=100)  # short for focused; longer for capstone
    key_takeaways: list[str] = Field(min_length=2, max_length=4)
