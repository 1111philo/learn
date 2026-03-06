from pydantic_ai import Agent

from app.agents.logging import AgentContext, run_agent
from app.config import settings
from app.schemas.assessment import AssessmentSpecOutput, AssessmentReviewOutput

assessment_creator = Agent(
    output_type=AssessmentSpecOutput,
    retries=2,
    system_prompt=(
        "You are an expert assessment designer creating a capstone performance task. "
        "Instead of a quiz, design a synthesis task where the learner produces a final "
        "deliverable that integrates skills from across the course.\n\n"
        "Requirements:\n"
        "- assessment_title: A clear title for this capstone task\n"
        "- items: Design 1-3 items (not one per objective) that require the learner to "
        "synthesize multiple objectives into a cohesive professional deliverable. Each item has:\n"
        "  - objective: The learning objective(s) being assessed (can combine multiple)\n"
        "  - prompt: A clear, specific prompt requiring the learner to produce a concrete "
        "professional artifact. Frame it as a workplace task with a specific audience and "
        "purpose. Require synthesis across objectives, not isolated recall.\n"
        "  - rubric: 3-6 specific, gradeable criteria including both mastery and professional "
        "quality standards\n\n"
        "If a final_portfolio_outcome is specified, the capstone should produce exactly that "
        "deliverable or a key component of it.\n\n"
        "If activity score data is provided, target weak areas more heavily.\n\n"
        "If prior artifact summaries are provided, the capstone should build on or synthesize "
        "the learner's previous work, not start from scratch.\n\n"
        "The output should be something the learner can show to an employer, use at work, "
        "or include in a professional portfolio."
    ),
)

assessment_reviewer = Agent(
    output_type=AssessmentReviewOutput,
    retries=2,
    system_prompt=(
        "You are an expert assessment reviewer evaluating a learner's capstone submission "
        "for both learning mastery and professional quality.\n\n"
        "Requirements:\n"
        "- overall_score: 0-100, aggregated from per-objective scores\n"
        "- objective_scores: One entry per objective with score (0-100) and specific feedback\n"
        "- pass_decision: 'pass' if overall_score >= 70, 'fail' otherwise\n"
        "- next_steps: Actionable next steps. For any objective with score < 70, include at "
        "least one specific action targeting that weakness.\n\n"
        "Portfolio package fields:\n"
        "- portfolio_title: A professional title for this capstone artifact suitable for a "
        "portfolio (e.g., 'Market Entry Analysis for SaaS Product Launch')\n"
        "- portfolio_description: 2-3 sentences describing what this deliverable demonstrates "
        "to an employer, written in third person (e.g., 'This analysis demonstrates...')\n"
        "- portfolio_package_recommendation: 2-4 suggestions for how the learner should "
        "present this work alongside their lesson artifacts in a portfolio\n\n"
        "Each objective feedback should:\n"
        "- Reference the rubric criteria for that item\n"
        "- Be 1-4 sentences covering what met the rubric, what didn't, and what to change\n"
        "- Be constructive and specific"
    ),
)


async def run_assessment_creator(
    ctx: AgentContext,
    objectives: list[str],
    course_description: str,
    activity_scores: list[dict] | None = None,
    learner_profile: dict | None = None,
    final_portfolio_outcome: str | None = None,
    artifact_summaries: list[dict] | None = None,
) -> AssessmentSpecOutput:
    prompt = (
        f"Course description: {course_description}\n\n"
        f"Learning objectives:\n"
        + "\n".join(f"- {o}" for o in objectives)
    )
    if final_portfolio_outcome:
        prompt += f"\n\nFinal portfolio outcome the capstone should produce: {final_portfolio_outcome}\n"
    if artifact_summaries:
        prompt += f"\n\nPrior artifacts the learner has produced:\n{artifact_summaries}\n"
    if activity_scores:
        prompt += f"\n\nActivity performance data:\n{activity_scores}\n"
    if learner_profile:
        prompt += f"\nLearner profile: {learner_profile}\n"

    return await run_agent(ctx, assessment_creator, "assessment_creator", prompt, model=settings.fast_model)


async def run_assessment_reviewer(
    ctx: AgentContext,
    assessment_spec: dict,
    submissions: list[dict],
) -> AssessmentReviewOutput:
    prompt = (
        f"Assessment specification:\n{assessment_spec}\n\n"
        f"Learner's submissions:\n{submissions}\n"
    )

    return await run_agent(ctx, assessment_reviewer, "assessment_reviewer", prompt, model=settings.fast_model)
