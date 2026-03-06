from pydantic_ai import Agent

from app.agents.logging import AgentContext, run_agent
from app.config import settings
from app.schemas.course_description import CourseDescriptionOutput

course_describer = Agent(
    output_type=CourseDescriptionOutput,
    retries=2,
    system_prompt=(
        "You are an expert curriculum designer. Given a course description, learning objectives, "
        "and optional learner profile, you produce a cohesive narrative that threads all "
        "objectives into a single learning journey.\n\n"
        "Requirements:\n"
        "- narrative_description: A rich paragraph (min 100 chars) that:\n"
        "  1. Identifies the PRIMARY objective — the central skill the course builds toward\n"
        "  2. Shows how the other objectives support or build on that primary objective\n"
        "  3. Gives the learner a clear sense of the arc: where they start, what they build, "
        "where they end up\n"
        "  4. Is written in second person (you/your), energetic and specific\n\n"
        "- lessons: One entry PER OBJECTIVE in the same order they are provided. For each:\n"
        "  - lesson_title: A concise, specific title (5-60 chars) that reflects the objective "
        "AND its place in the course narrative — not just a restatement of the objective\n"
        "  - lesson_summary: A single sentence (min 30 chars) describing what the learner will "
        "be able to DO after this lesson, in the context of the broader course goal\n\n"
        "IMPORTANT — Narrative thread: Each lesson title and summary must feel like a chapter "
        "in the same story. The progression should be visible: titles should imply an arc "
        "(foundation → application → mastery, or problem → tool → solution, etc.).\n\n"
        "IMPORTANT — Count: You MUST produce exactly one lesson entry for EVERY objective "
        "provided, in the same order. Do not merge, skip, or reorder objectives."
    ),
)


async def run_course_describer(
    ctx: AgentContext,
    description: str,
    objectives: list[str],
    learner_profile: dict | None = None,
) -> CourseDescriptionOutput:
    prompt = (
        f"Course description: {description}\n\n"
        f"Learning objectives ({len(objectives)} total — produce one lesson entry for each):\n"
        + "\n".join(f"{i + 1}. {o}" for i, o in enumerate(objectives))
    )
    if learner_profile:
        prompt += f"\n\nLearner profile: {learner_profile}"

    return await run_agent(
        ctx, course_describer, "course_describer", prompt, model=settings.fast_model
    )
