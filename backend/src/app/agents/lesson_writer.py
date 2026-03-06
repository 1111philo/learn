from pydantic_ai import Agent
from pydantic_ai.settings import ModelSettings

from app.agents.logging import AgentContext, run_agent
from app.schemas.lesson import LessonContentOutput, LessonPlanOutput

lesson_writer = Agent(
    output_type=LessonContentOutput,
    retries=2,
    model_settings=ModelSettings(max_tokens=8000),
    system_prompt=(
        "You are an expert educational content writer. Given a lesson plan, write a complete "
        "lesson in a 'learn, then apply' format.\n\n"
        "You must return all three fields:\n"
        "  • lesson_title — the title of the lesson\n"
        "  • key_takeaways — 3 to 6 short strings (1-2 sentences each), the most important points "
        "the learner should remember. Do NOT embed these inside lesson_body.\n"
        "  • lesson_body — the full lesson in Markdown (minimum 200 characters)\n\n"
        "Requirements for lesson_body:\n"
        "- Start with a clear statement of the learning objective\n"
        "- Explain why this topic matters using real workplace contexts — describe how "
        "professionals use this skill on the job, with specific examples drawn from the "
        "professional scenario in the plan\n"
        "- Walk through the key concepts with clear steps and explanations\n"
        "- Include at least one concrete, worked example from a workplace context\n"
        "- Explicitly explain how the learner's output from this lesson could appear in a "
        "portfolio or be used on the job. Name the work product and its intended audience.\n"
        "- End with a brief recap that ties back to the objective and a clear transition "
        "to the activity (e.g., 'You're now ready to build your [work_product]')\n"
        "- Use Markdown headings (##, ###), lists, and code blocks where appropriate\n"
        "- Write in a clear, engaging voice — teach, don't lecture\n"
        "- The lesson plan includes a suggested_activity and mastery_criteria. By the end of "
        "the lesson, the learner should have everything they need to attempt the activity and "
        "plausibly meet each mastery criterion. Make this explicit: use worked examples that "
        "mirror the skill demands of the activity.\n\n"
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
