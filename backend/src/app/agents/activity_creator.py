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
        "that the learner builds across every lesson. Your job is to design the next iteration "
        "of that document.\n\n"
        "CRITICAL CONSTRAINTS:\n"
        "- The ONLY input method is a plain text area. No file uploads, no code editors, "
        "no multiple choice, no drag-and-drop. The learner types or edits text and submits it.\n"
        "- If a 'Current portfolio document' is provided below, the activity MUST ask the "
        "learner to EDIT and EXTEND that existing text — not start from scratch. Tell them "
        "to copy their current document into the text area, then add/revise the new section.\n"
        "- If no portfolio document exists yet (first lesson), the activity starts the document.\n\n"
        "Requirements:\n"
        "- prompt: The core task directive (1-2 sentences, min 20 chars). For lessons after "
        "the first, start with something like 'Open your portfolio document and...' or "
        "'Building on your document, add a section that...'\n"
        "- instructions: Format/constraint guidance ONLY (1-2 short sentences, min 50 chars). "
        "Tell the learner what to add or revise in their document. Do NOT restate the prompt.\n"
        "- scoring_rubric: 3-6 specific, checkable criteria that map to the mastery criteria. "
        "These are shown to the learner so they know what to aim for.\n"
        "- hints: 2-5 scaffolding hints that guide without giving the answer\n\n"
        "Portfolio and career fields:\n"
        "- artifact_type: The type of work product (e.g., 'project brief', 'audit report')\n"
        "- employer_skill_signals: 2-4 workplace skills this activity demonstrates\n"
        "- portfolio_eligible: always true (every submission updates the portfolio)\n"
        "- revision_required: true if this section benefits from refinement\n"
        "- professional_quality_checklist: 2-4 criteria that distinguish professional-grade "
        "work from student-grade work\n\n"
        "The activity should directly test the learning objective. Make it challenging but "
        "achievable. Tailor to the learner's profile if provided.\n\n"
        "IMPORTANT — The output is always a written document section. Frame the task as "
        "writing, drafting, analyzing, or planning — never as coding, drawing, or uploading.\n\n"
        "IMPORTANT — Personal application: Anchor the activity in the learner's real work, "
        "projects, or career goals. If no profile is available, use the course goals."
    ),
)


async def run_activity_creator(
    ctx: AgentContext,
    activity_seed: ActivitySeed,
    objective: str,
    mastery_criteria: list[str],
    learner_profile: dict | None = None,
    portfolio_content: str | None = None,
) -> ActivitySpecOutput:
    prompt = (
        f"Learning objective: {objective}\n\n"
        f"Mastery criteria:\n"
        + "\n".join(f"- {c}" for c in mastery_criteria)
        + f"\n\nActivity seed:\n{activity_seed.model_dump_json(indent=2)}\n"
    )
    if learner_profile:
        prompt += f"\nLearner profile: {learner_profile}\n"
    if portfolio_content:
        prompt += (
            f"\nCurrent portfolio document (the learner has been building this across lessons — "
            f"the activity should ask them to extend or refine it):\n"
            f"---\n{portfolio_content}\n---\n"
        )

    return await run_agent(ctx, activity_creator, "activity_creator", prompt, model=settings.fast_model)
