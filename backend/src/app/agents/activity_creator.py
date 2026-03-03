from pydantic_ai import Agent

from app.agents.logging import AgentContext, run_agent
from app.config import settings
from app.schemas.activity import ActivitySpecOutput
from app.schemas.lesson import ActivitySeed

activity_creator = Agent(
    output_type=ActivitySpecOutput,
    retries=2,
    system_prompt=(
        "You are an expert activity designer for educational courses. Given an activity seed "
        "(type, prompt, expected evidence), mastery criteria, and context about the activity's "
        "role and difficulty, create a complete practice activity.\n\n"
        "You will be given a ROLE (focused or capstone) and a DIFFICULTY LEVEL (1-3).\n\n"
        "FOCUSED activities (difficulty 1-3):\n"
        "  Level 1 — Introductory: Basic recognition or definition. "
        "1-2 sentence prompt. Rubric: 1-2 criteria. Hints: 2 generous hints. "
        "Activity type: short-answer or definition.\n"
        "  Level 2 — Applied: Demonstrate understanding in context. "
        "Rubric: 2-3 criteria. Hints: 1-2. Activity type: example or brief explanation.\n"
        "  Level 3 — Pre-mastery: Synthesis and analysis. "
        "Rubric: 3-4 criteria. Hints: 1-2. Requires more complete response.\n\n"
        "CAPSTONE activities (always the hardest):\n"
        "  Integrative — apply ALL mastery criteria in a realistic scenario. "
        "Rubric: 3-6 criteria mapping to mastery criteria. Hints: 2-4. "
        "Prompt must require concrete, multi-part evidence.\n\n"
        "General requirements:\n"
        "- instructions: Clear, actionable instructions telling the learner exactly what to do\n"
        "- prompt: The specific question or task\n"
        "- scoring_rubric: Specific, gradeable criteria (e.g., 'Includes 2+ concrete examples')\n"
        "- hints: Scaffolding hints that guide without giving the answer\n\n"
        "IMPORTANT — Domain transfer: Set the activity in a DIFFERENT real-world scenario than "
        "the lesson's worked example. This forces knowledge transfer, not copying."
    ),
)


async def run_activity_creator(
    ctx: AgentContext,
    activity_seed: ActivitySeed,
    objective: str,
    mastery_criteria: list[str],
    learner_profile: dict | None = None,
    difficulty_level: int = 3,
    lesson_role: str = "capstone",
    concept_focus: str | None = None,
) -> ActivitySpecOutput:
    prompt = (
        f"Learning objective: {objective}\n\n"
        f"Activity role: {lesson_role.upper()}\n"
        f"Difficulty level: {difficulty_level} (1=intro, 2=applied, 3=pre-mastery / capstone)\n"
    )
    if concept_focus:
        prompt += f"Concept this activity focuses on: {concept_focus}\n"

    prompt += (
        f"\nMastery criteria:\n"
        + "\n".join(f"- {c}" for c in mastery_criteria)
        + f"\n\nActivity seed:\n{activity_seed.model_dump_json(indent=2)}\n"
    )
    if learner_profile:
        prompt += f"\nLearner profile: {learner_profile}\n"

    return await run_agent(
        ctx, activity_creator, "activity_creator", prompt, model=settings.fast_model
    )
