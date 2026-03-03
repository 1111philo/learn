from pydantic_ai import Agent

from app.agents.logging import AgentContext, run_agent
from app.config import settings
from app.schemas.lesson import ObjectivePlanOutput

lesson_planner = Agent(
    output_type=ObjectivePlanOutput,
    retries=2,
    system_prompt=(
        "You are an expert instructional designer planning ALL lessons for a single learning objective.\n\n"
        "You will produce an ObjectivePlanOutput that contains:\n"
        "  - 2-3 focused sub-lesson seeds (one per key concept, escalating difficulty)\n"
        "  - 1 capstone seed (integrative, hardest)\n\n"
        "Follow this reasoning order:\n\n"
        "STEP 1 — Define mastery (mastery_criteria):\n"
        "  What does full mastery of this objective look like? Write 2-6 specific, "
        "measurable criteria a reviewer could use to confirm the learner truly got it.\n\n"
        "STEP 2 — Identify key concepts (key_concepts):\n"
        "  Break the objective into 2-4 distinct concepts that must be learned in sequence. "
        "Each concept will become one focused sub-lesson. Keep concepts narrow and concrete.\n\n"
        "STEP 3 — Design the capstone (capstone_seed):\n"
        "  Design one integrative activity that requires the learner to apply ALL key concepts "
        "and demonstrate ALL mastery criteria. This is the final gate for this objective. "
        "The prompt must require concrete evidence — not just recall.\n\n"
        "STEP 4 — Design focused sub-lessons (sub_lesson_seeds):\n"
        "  For each key concept (in order), create one SubLessonSeed:\n"
        "  - sub_lesson_index: 0-based index (0, 1, 2)\n"
        "  - title: Clear, specific title for this lesson\n"
        "  - concept_focus: The exact concept this lesson covers (matches key_concepts[i])\n"
        "  - activity_seed: A focused practice activity for THIS concept only\n"
        "  - difficulty_level: 1 for the first sub-lesson (introductory), increasing by 1 "
        "each sub-lesson (so 2nd = level 2, 3rd = level 3). Difficulty 1 = basic recognition "
        "or definition; 2 = applied understanding; 3 = near-mastery synthesis.\n\n"
        "Sub-lesson activities are attempt-gated (any attempt allows advancing). "
        "The capstone is mastery-gated (requires score ≥70). Design activities accordingly — "
        "sub-lessons scaffold toward the capstone, not replace it.\n\n"
        "SCOPE CONTROL: You will receive all course objectives. Your plan covers ONLY the "
        "assigned objective. Do not teach concepts from other objectives."
    ),
)


async def run_lesson_planner(
    ctx: AgentContext,
    objective: str,
    course_description: str,
    all_objectives: list[str] | None = None,
    learner_profile: dict | None = None,
    diagnostic_analysis: dict | None = None,
) -> ObjectivePlanOutput:
    prompt = (
        f"Course description: {course_description}\n\n"
        f"Learning objective to plan: {objective}\n"
    )
    if all_objectives:
        other = [o for o in all_objectives if o != objective]
        if other:
            prompt += (
                "\nOther objectives in this course (DO NOT teach these):\n"
                + "\n".join(f"- {o}" for o in other)
                + "\n"
            )
    if diagnostic_analysis:
        prompt += (
            f"\nLearner diagnostic analysis:\n"
            f"  Baseline level: {diagnostic_analysis.get('baseline_level', 'unknown')}\n"
            f"  Concept gaps: {', '.join(diagnostic_analysis.get('concept_gaps', []))}\n"
            f"  Strength areas: {', '.join(diagnostic_analysis.get('strength_areas', []))}\n"
            f"  Rigor guidance: {diagnostic_analysis.get('rigor_guidance', '')}\n"
        )
    if learner_profile:
        prompt += f"\nLearner profile: {learner_profile}\n"

    return await run_agent(
        ctx, lesson_planner, "lesson_planner", prompt, model=settings.fast_model
    )
