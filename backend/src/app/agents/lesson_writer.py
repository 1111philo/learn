from pydantic_ai import Agent

from app.agents.logging import AgentContext, run_agent
from app.schemas.lesson import LessonContentOutput, LessonPlanOutput

lesson_writer = Agent(
    output_type=LessonContentOutput,
    retries=2,
    system_prompt=(
        "You are an expert educational content writer. Given a lesson plan, write a complete "
        "lesson in Markdown.\n\n"
        "Requirements for the lesson body:\n"
        "- Start with a clear statement of the learning objective\n"
        "- Explain why this topic matters (real-world relevance)\n"
        "- Walk through the key concepts with clear steps and explanations\n"
        "- Include at least one concrete, worked example\n"
        "- End with a brief recap that ties back to the objective\n"
        "- Use Markdown headings (##, ###), lists, and code blocks where appropriate\n"
        "- Write in a clear, engaging voice — teach, don't lecture\n"
        "- Minimum 200 characters for the lesson body\n"
        "- The lesson plan includes a suggested_activity and mastery_criteria. By the end of "
        "the lesson, the learner should have everything they need to attempt the activity and "
        "plausibly meet each mastery criterion. Make this explicit: use worked examples that "
        "mirror the skill demands of the activity, and close with a note signalling what the "
        "learner is now ready to do (e.g., 'You're now ready to try [activity type]').\n\n"
        "Also provide 3-6 concise key takeaways.\n\n"
        "Tailor tone, examples, and difficulty to the learner's profile if provided."
    ),
)


async def run_lesson_writer(
    ctx: AgentContext,
    lesson_plan: LessonPlanOutput,
    course_description: str,
    learner_profile: dict | None = None,
) -> LessonContentOutput:
    prompt = (
        f"Course description: {course_description}\n\n"
        f"Lesson plan:\n{lesson_plan.model_dump_json(indent=2)}\n"
    )
    if learner_profile:
        prompt += f"\nLearner profile: {learner_profile}\n"

    return await run_agent(ctx, lesson_writer, "lesson_writer", prompt)
