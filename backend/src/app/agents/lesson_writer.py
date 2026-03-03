from pydantic_ai import Agent

from app.agents.logging import AgentContext, run_agent
from app.config import settings
from app.schemas.lesson import LessonContentOutput, SubLessonSeed

lesson_writer = Agent(
    output_type=LessonContentOutput,
    retries=2,
    system_prompt=(
        "You are an expert educational content writer. You write focused, bite-sized lessons.\n\n"
        "You will be told whether you are writing a FOCUSED sub-lesson or a CAPSTONE lesson. "
        "The requirements differ significantly:\n\n"
        "FOCUSED sub-lesson:\n"
        "- Cover ONE concept only — the concept_focus provided. Stay tightly scoped.\n"
        "- Length: 2-4 paragraphs. Short and dense, not padded.\n"
        "- Include ONE concrete worked example that directly mirrors the activity the learner "
        "will attempt immediately after reading.\n"
        "- Close with a sentence signalling readiness: 'You're now ready to practice [concept].'\n"
        "- Key takeaways: 2-3 short bullet points.\n"
        "- Minimum 100 characters for the lesson body.\n\n"
        "CAPSTONE lesson:\n"
        "- Synthesize ALL key concepts covered in the previous sub-lessons.\n"
        "- Length: 4-8 paragraphs.\n"
        "- Show how the concepts connect and reinforce each other.\n"
        "- Include a worked example that integrates multiple concepts.\n"
        "- Close with: 'You're now ready for the capstone challenge.'\n"
        "- Key takeaways: 3-4 bullet points.\n"
        "- Minimum 100 characters for the lesson body.\n\n"
        "Use Markdown (##, ###, lists, code blocks) as appropriate. "
        "Write in a clear, engaging voice. "
        "Tailor tone, examples, and difficulty to the learner's profile if provided."
    ),
)


async def run_lesson_writer(
    ctx: AgentContext,
    seed: SubLessonSeed | None,
    objective: str,
    course_description: str,
    learner_profile: dict | None = None,
    lesson_role: str = "focused",
    key_concepts: list[str] | None = None,
    mastery_criteria: list[str] | None = None,
) -> LessonContentOutput:
    """Write lesson content for one sub-lesson or the capstone.

    Args:
        seed: SubLessonSeed for focused lessons; None for capstone.
        lesson_role: "focused" or "capstone"
        key_concepts: All concepts (passed for capstone context)
        mastery_criteria: All mastery criteria (passed for capstone context)
    """
    prompt = (
        f"Course description: {course_description}\n\n"
        f"Learning objective: {objective}\n\n"
        f"Lesson role: {lesson_role.upper()}\n\n"
    )

    if lesson_role == "focused" and seed is not None:
        prompt += (
            f"Concept to cover: {seed.concept_focus}\n"
            f"Lesson title: {seed.title}\n"
            f"Difficulty level: {seed.difficulty_level} (1=intro, 2=applied, 3=pre-mastery)\n"
            f"Activity the learner will attempt after this lesson:\n"
            f"  Type: {seed.activity_seed.activity_type}\n"
            f"  Prompt: {seed.activity_seed.prompt}\n"
        )
    else:
        prompt += "This is the CAPSTONE lesson — synthesize all concepts.\n"
        if key_concepts:
            prompt += "Key concepts covered in sub-lessons:\n" + "\n".join(f"- {c}" for c in key_concepts) + "\n"
        if mastery_criteria:
            prompt += "Mastery criteria the learner must demonstrate:\n" + "\n".join(f"- {c}" for c in mastery_criteria) + "\n"

    if learner_profile:
        prompt += f"\nLearner profile: {learner_profile}\n"

    return await run_agent(ctx, lesson_writer, "lesson_writer", prompt, model=settings.default_model)
