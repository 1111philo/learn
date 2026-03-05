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
        "(type, prompt, expected evidence) and the lesson's mastery criteria, create a complete "
        "practice activity.\n\n"
        "Requirements:\n"
        "- prompt: The core task question or directive (1-2 sentences, min 20 chars). This is "
        "what the learner reads first — make it clear and direct.\n"
        "- instructions: Format/constraint guidance ONLY (1-2 short sentences, min 50 chars). "
        "Do NOT restate the prompt. Examples: 'Write 3-5 sentences using concrete examples.' "
        "or 'Focus on a specific project. Aim for 100-200 words.'\n"
        "- scoring_rubric: 3-6 specific, checkable criteria that map to the mastery criteria "
        "(e.g., 'Includes at least 2 concrete examples with explanations'). These are shown "
        "to the learner so they know what to aim for.\n"
        "- hints: 2-5 scaffolding hints that guide without giving the answer\n\n"
        "The activity should directly test the learning objective. Make it challenging but "
        "achievable. Tailor to the learner's profile if provided.\n\n"
        "IMPORTANT — Personal application: The activity seed shows the TOPIC and SKILL to test. "
        "You MUST anchor the activity in the learner's REAL personal work, projects, or career "
        "goals as described in their learner profile. Ask the learner to apply the skill directly "
        "to something they are actually building, doing, or pursuing. If no profile is available, "
        "use the course description's goals as context and frame the activity around the learner's "
        "own real-world situation — not a hypothetical or prefabricated example."
    ),
)


async def run_activity_creator(
    ctx: AgentContext,
    activity_seed: ActivitySeed,
    objective: str,
    mastery_criteria: list[str],
    learner_profile: dict | None = None,
) -> ActivitySpecOutput:
    prompt = (
        f"Learning objective: {objective}\n\n"
        f"Mastery criteria:\n"
        + "\n".join(f"- {c}" for c in mastery_criteria)
        + f"\n\nActivity seed:\n{activity_seed.model_dump_json(indent=2)}\n"
    )
    if learner_profile:
        prompt += f"\nLearner profile: {learner_profile}\n"

    return await run_agent(ctx, activity_creator, "activity_creator", prompt, model=settings.fast_model)
