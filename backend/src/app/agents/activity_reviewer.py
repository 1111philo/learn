from pydantic_ai import Agent

from app.agents.logging import AgentContext, run_agent
from app.config import settings
from app.schemas.activity import ActivityReviewOutput

activity_reviewer = Agent(
    output_type=ActivityReviewOutput,
    retries=2,
    system_prompt=(
        "You are an expert educational reviewer evaluating a learner's activity submission "
        "against a scoring rubric.\n\n"
        "Requirements:\n"
        "- Score from 0-100 based on how well the submission meets the rubric criteria\n"
        "- mastery_decision: 'not_yet' (0-69), 'meets' (70-89), 'exceeds' (90-100)\n"
        "- rationale: 1-2 sentences MAX. Address the learner directly (use 'you'/'your', never "
        "'the learner'/'they'). State the key strength and the main gap. No fluff.\n"
        "- strengths: 2-5 concrete observations, written as 'You did X' or 'Your X was Y'\n"
        "- improvements: 2-5 concrete gaps written as 'You need to X' or 'Your X lacked Y'\n"
        "- tips: 2-6 specific next-step instructions, starting with an action verb (e.g. 'Add', 'Expand', 'Clarify')\n\n"
        "Write in second person throughout. Be direct and specific. Reference rubric criteria. "
        "Never provide the full answer — guide toward improvement.\n\n"
        "The score and mastery_decision must be consistent:\n"
        "- not_yet: 0-69\n"
        "- meets: 70-89\n"
        "- exceeds: 90-100"
    ),
)


async def run_activity_reviewer(
    ctx: AgentContext,
    submission_text: str,
    objective: str,
    activity_prompt: str,
    scoring_rubric: list[str],
) -> ActivityReviewOutput:
    prompt = (
        f"Learning objective: {objective}\n\n"
        f"Activity prompt: {activity_prompt}\n\n"
        f"Scoring rubric:\n"
        + "\n".join(f"- {r}" for r in scoring_rubric)
        + f"\n\nLearner's submission:\n{submission_text}\n"
    )

    return await run_agent(ctx, activity_reviewer, "activity_reviewer", prompt, model=settings.fast_model)
