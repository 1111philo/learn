from pydantic_ai import Agent

from app.agents.logging import AgentContext, run_agent
from app.config import settings
from app.schemas.activity import ActivitySpecOutput
from app.schemas.lesson import ActivitySeed

activity_creator = Agent(
    output_type=ActivitySpecOutput,
    retries=2,
    system_prompt=(
        "You are an expert activity designer. Each course has ONE evolving portfolio document "
        "that the learner builds across every lesson. Each lesson has multiple bite-sized "
        "activities that progressively build the artifact.\n\n"
        "CRITICAL CONSTRAINTS:\n"
        "- The ONLY input method is a plain text area. No file uploads, no code editors, "
        "no multiple choice, no drag-and-drop.\n"
        "- If 'Prior activity content' or 'Current portfolio document' is provided, the "
        "activity MUST ask the learner to EDIT and EXTEND that existing text.\n"
        "- If no prior content exists (first activity of first lesson), start the document.\n\n"
        "Requirements:\n"
        "- prompt: The core task directive (1-2 sentences, min 20 chars). Reference the "
        "specific contribution this activity makes to the artifact.\n"
        "- instructions: Format/constraint guidance ONLY (1-2 short sentences, min 50 chars). "
        "Tell the learner what to add or revise. Do NOT restate the prompt.\n"
        "- scoring_rubric: 3-6 specific, checkable criteria.\n"
        "- hints: 2-5 scaffolding hints that guide without giving the answer\n\n"
        "Portfolio and career fields:\n"
        "- artifact_type: The type of work product section\n"
        "- employer_skill_signals: 2-4 workplace skills this activity demonstrates\n"
        "- portfolio_eligible: always true\n"
        "- revision_required: true if this section benefits from refinement\n"
        "- professional_quality_checklist: 2-4 criteria for professional-grade work\n\n"
        "Make the activity challenging but achievable. Frame the task as writing, drafting, "
        "analyzing, or planning. Anchor in the learner's real work or career goals."
    ),
)


async def run_activity_creator(
    ctx: AgentContext,
    activity_seed: ActivitySeed,
    objective: str,
    mastery_criteria: list[str],
    learner_profile: dict | None = None,
    portfolio_content: str | None = None,
    activity_index: int = 0,
    total_activities: int = 1,
    prior_activity_content: str | None = None,
) -> ActivitySpecOutput:
    prompt = (
        f"Learning objective: {objective}\n\n"
        f"Activity {activity_index + 1} of {total_activities}\n"
        f"This activity's contribution: {activity_seed.contribution_description}\n\n"
        f"Mastery criteria:\n"
        + "\n".join(f"- {c}" for c in mastery_criteria)
        + f"\n\nActivity seed:\n{activity_seed.model_dump_json(indent=2)}\n"
    )
    if learner_profile:
        prompt += f"\nLearner profile: {learner_profile}\n"
    if prior_activity_content:
        prompt += (
            f"\nPrior activity content from this lesson (the learner should build on this):\n"
            f"---\n{prior_activity_content}\n---\n"
        )
    elif portfolio_content:
        prompt += (
            f"\nCurrent portfolio document from previous lessons (extend or refine it):\n"
            f"---\n{portfolio_content}\n---\n"
        )

    return await run_agent(ctx, activity_creator, "activity_creator", prompt, model=settings.fast_model)
