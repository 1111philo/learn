from pydantic_ai import Agent

from app.agents.logging import AgentContext, run_agent
from app.config import settings
from app.schemas.lesson import LessonPlanOutput

lesson_planner = Agent(
    output_type=LessonPlanOutput,
    retries=2,
    system_prompt=(
        "You are an expert instructional designer creating a lesson plan using backward design. "
        "Each lesson must result in a concrete, portfolio-worthy work product built through "
        "multiple bite-sized activities.\n\n"
        "Follow this three-step reasoning order when filling out the plan:\n\n"
        "STEP 1 — Define the finish line (mastery_criteria):\n"
        "  What does mastery of this objective look like? Write 2-6 rubric-style checks "
        "that a reviewer could use to determine whether the learner truly got it. "
        "Be specific and measurable.\n\n"
        "STEP 2 — Design 2-5 bite-sized activities (activity_seeds):\n"
        "  Break the work product into 2-5 sequential activities, each taking 5-15 minutes. "
        "Each activity contributes a distinct section or improvement to the artifact. "
        "Activity 0 starts or extends the artifact; subsequent activities refine, expand, "
        "or add sections. Together they cover all mastery criteria.\n"
        "  For EACH activity seed, provide:\n"
        "  - activity_index: 0-based position in the sequence\n"
        "  - activity_type: the kind of task (e.g., 'draft', 'analyze', 'revise')\n"
        "  - prompt: a clear 1-2 sentence directive for this specific step\n"
        "  - contribution_description: what this activity adds to the artifact\n"
        "  - expected_evidence: 2-5 pieces of evidence a successful submission contains\n"
        "  - artifact_type: the type of work product section\n"
        "  - employer_skill_signals: 2-4 workplace skills this demonstrates\n"
        "  - portfolio_eligible: true (always — every submission updates the portfolio)\n"
        "  - revision_required: true if this section benefits from refinement\n"
        "  - professional_quality_checklist: 2-4 criteria for employer-grade quality\n\n"
        "STEP 3 — Plan the path to get there (lesson_outline):\n"
        "  Now that you know exactly what the learner must be able to do, design a 3-10 "
        "step lesson outline that closes the gap. Each step should build the knowledge or "
        "skill the learner will need to succeed at the activities. Ask yourself: after "
        "completing this outline, could a learner attempt the activities and plausibly meet "
        "every mastery criterion? If not, revise.\n\n"
        "Other fields:\n"
        "- lesson_title: A clear, specific title for this lesson (not the course title)\n"
        "- learning_objective: Restate the objective as a clear, measurable outcome\n"
        "- key_concepts: 2-8 core concepts the lesson must cover\n"
        "- work_product: What tangible artifact the learner will produce in this lesson\n"
        "- intended_audience: Who would read/use this work product in a workplace\n"
        "- professional_scenario: A realistic workplace situation where this task happens\n"
        "- challenge_level: 'foundational', 'intermediate', or 'advanced'\n"
        "- scaffold_plan: How much support to provide (more scaffolding early, less later)\n"
        "- portfolio_contribution: How this lesson's output feeds into the final deliverable\n\n"
        "The plan must be specific enough that downstream agents can produce aligned content "
        "without guessing. Tailor the plan to the learner's profile if provided.\n\n"
        "IMPORTANT — Scope control: You will receive the full list of course objectives. "
        "Your lesson must cover ONLY the assigned objective. Do NOT teach concepts that "
        "belong to a different objective."
    ),
)


async def run_lesson_planner(
    ctx: AgentContext,
    objective: str,
    course_description: str,
    all_objectives: list[str] | None = None,
    learner_profile: dict | None = None,
    preset_title: str | None = None,
    lesson_summary: str | None = None,
    objective_index: int | None = None,
    professional_role: str | None = None,
    career_context: str | None = None,
    artifact_type_hint: str | None = None,
) -> LessonPlanOutput:
    total = len(all_objectives) if all_objectives else None
    position = (
        f"This is lesson {objective_index + 1} of {total} in the course sequence.\n"
        if objective_index is not None and total is not None
        else ""
    )
    prompt = (
        f"Course narrative arc: {course_description}\n\n"
        f"{position}"
        f"Learning objective for THIS lesson: {objective}\n"
    )
    if lesson_summary:
        prompt += (
            f"\nThis lesson's role in the narrative: {lesson_summary}\n"
            "The plan must position this lesson within that narrative — "
            "connecting to what came before (if not lesson 1) and "
            "signposting where the learner is headed next.\n"
        )
    if preset_title:
        prompt += f"\nThis lesson must be titled exactly: {preset_title}\n"
    if all_objectives:
        other = [o for o in all_objectives if o != objective]
        if other:
            prompt += (
                "\nOther objectives in this course (DO NOT teach these, "
                "they have their own lessons):\n"
                + "\n".join(f"- {o}" for o in other)
                + "\n"
            )
    if professional_role:
        prompt += f"\nProfessional role frame: {professional_role}\n"
    if career_context:
        prompt += f"Career context: {career_context}\n"
    if artifact_type_hint:
        prompt += f"Suggested artifact type for this lesson: {artifact_type_hint}\n"
    if learner_profile:
        prompt += f"\nLearner profile: {learner_profile}\n"

    return await run_agent(ctx, lesson_planner, "lesson_planner", prompt, model=settings.fast_model)
