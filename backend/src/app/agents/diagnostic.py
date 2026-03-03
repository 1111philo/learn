from pydantic_ai import Agent

from app.agents.logging import AgentContext, run_agent
from app.config import settings
from app.schemas.diagnostic import DiagnosticAnalysis, DiagnosticSpec

diagnostic_creator = Agent(
    output_type=DiagnosticSpec,
    retries=2,
    system_prompt=(
        "You are an expert learning designer creating a pre-course diagnostic.\n\n"
        "Your goal is to reveal the learner's EXISTING knowledge before any content is generated. "
        "This diagnostic will be used to calibrate lesson depth, activity difficulty, and rigor.\n\n"
        "Design 3-5 open-ended questions that:\n"
        "- Probe familiarity with core concepts (not test them — ask what they already know)\n"
        "- Surface prior practical experience ('Have you ever...', 'How would you approach...')\n"
        "- Reveal mental models and misconceptions\n"
        "- Are conversational and non-intimidating (this is not an exam)\n\n"
        "For each question, provide a rationale explaining what knowledge gap or "
        "strength it is designed to surface.\n\n"
        "Questions must be directly relevant to the course objectives provided. "
        "Do not ask about unrelated topics."
    ),
)

diagnostic_analyzer = Agent(
    output_type=DiagnosticAnalysis,
    retries=2,
    system_prompt=(
        "You are an expert learning designer analyzing a learner's diagnostic responses.\n\n"
        "Based on the course objectives and the learner's answers, produce a concise analysis that:\n\n"
        "1. baseline_level: Classify overall knowledge as 'novice', 'intermediate', or 'advanced'. "
        "Use clear evidence from their answers to justify the classification.\n\n"
        "2. concept_gaps: List specific concepts from the objectives that the learner clearly lacks "
        "knowledge of. Be precise — name the concepts, not vague areas.\n\n"
        "3. strength_areas: List concepts the learner already demonstrates solid understanding of. "
        "These may be covered briefly since they are foundations already in place.\n\n"
        "4. rigor_guidance: Write 2-4 sentences of actionable guidance for the generation agents. "
        "How challenging should activities be? What level of assumed knowledge is appropriate? "
        "What examples or contexts resonate with this learner?\n\n"
        "5. focus_recommendations: List which objectives deserve more depth and time given the gaps. "
        "Be specific about why each needs extra focus.\n\n"
        "Be honest and specific. Generic analysis wastes the diagnostic data."
    ),
)


async def run_diagnostic_creator(
    ctx: AgentContext,
    objectives: list[str],
    course_description: str,
    learner_profile: dict | None = None,
) -> DiagnosticSpec:
    prompt = (
        f"Course description: {course_description}\n\n"
        f"Learning objectives:\n"
        + "\n".join(f"- {o}" for o in objectives)
    )
    if learner_profile:
        prompt += f"\n\nLearner profile: {learner_profile}"

    return await run_agent(
        ctx, diagnostic_creator, "diagnostic_creator", prompt, model=settings.fast_model
    )


async def run_diagnostic_analyzer(
    ctx: AgentContext,
    objectives: list[str],
    course_description: str,
    diagnostic_spec: dict,
    responses: list[dict],
) -> DiagnosticAnalysis:
    questions_and_answers = "\n\n".join(
        f"Q: {r.get('question', '')}\nA: {r.get('answer', '(no answer)')}"
        for r in responses
    )
    prompt = (
        f"Course description: {course_description}\n\n"
        f"Learning objectives:\n"
        + "\n".join(f"- {o}" for o in objectives)
        + f"\n\nDiagnostic Q&A:\n{questions_and_answers}"
    )

    return await run_agent(
        ctx, diagnostic_analyzer, "diagnostic_analyzer", prompt, model=settings.fast_model
    )
