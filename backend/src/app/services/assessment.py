"""Background tasks for assessment generation and review via LLM."""

import logging

from sqlalchemy import select
from sqlalchemy.orm import selectinload

from app.agents.assessment import run_assessment_creator, run_assessment_reviewer
from app.agents.logging import AgentContext
from app.db.models import Assessment, CourseInstance, Lesson
from app.db.session import get_background_session
from app.services.generation_tracker import broadcast
from app.services.progression import InvalidTransitionError, transition_course

logger = logging.getLogger(__name__)


def assessment_key(course_id: str) -> str:
    return f"assessment-{course_id}"


def assessment_review_key(assessment_id: str) -> str:
    return f"assessment-review-{assessment_id}"


async def generate_assessment_background(
    course_id: str,
    user_id: str,
    objectives: list[str],
    description: str,
    activity_scores: list[dict] | None,
    learner_profile: dict | None,
) -> None:
    """Background task that generates an assessment spec via LLM."""
    key = assessment_key(course_id)

    try:
        async with get_background_session() as db:
            result = await db.execute(
                select(CourseInstance)
                .where(CourseInstance.id == course_id)
                .options(
                    selectinload(CourseInstance.lessons).selectinload(Lesson.activities),
                    selectinload(CourseInstance.assessments),
                )
            )
            course = result.scalar_one()

            ctx = AgentContext(db=db, user_id=user_id, course_instance_id=course_id)

            await broadcast(key, "generating_assessment", {})

            spec = await run_assessment_creator(
                ctx,
                objectives=objectives,
                course_description=description,
                activity_scores=activity_scores,
                learner_profile=learner_profile,
            )

            assessment = Assessment(
                course_instance_id=course_id,
                assessment_spec=spec.model_dump(),
                status="pending",
            )
            db.add(assessment)
            await db.flush()
            await db.commit()

            # Refresh so transition guard sees the new assessment
            await db.refresh(course, ["assessments"])

            try:
                await transition_course(db, course, "assessment_ready")
                await db.commit()
            except InvalidTransitionError:
                pass

        await broadcast(key, "assessment_complete", {
            "assessment_id": assessment.id,
        })

    except Exception:
        logger.exception("Error generating assessment for course %s", course_id)
        try:
            async with get_background_session() as db:
                result = await db.execute(
                    select(CourseInstance)
                    .where(CourseInstance.id == course_id)
                    .options(selectinload(CourseInstance.assessments))
                )
                course = result.scalar_one_or_none()
                if course and course.status == "generating_assessment":
                    await transition_course(db, course, "awaiting_assessment")
        except Exception:
            logger.exception("Could not roll back course %s status", course_id)

        await broadcast(key, "assessment_error", {
            "error": "Failed to generate assessment",
        })


async def review_assessment_background(
    assessment_id: str,
    user_id: str,
    course_id: str,
    assessment_spec: dict,
    submissions: list[dict],
) -> None:
    """Background task that reviews assessment submissions via LLM."""
    key = assessment_review_key(assessment_id)

    try:
        async with get_background_session() as db:
            ctx = AgentContext(db=db, user_id=user_id, course_instance_id=course_id)

            review = await run_assessment_reviewer(
                ctx,
                assessment_spec=assessment_spec,
                submissions=submissions,
            )

            result = await db.execute(
                select(Assessment)
                .where(Assessment.id == assessment_id)
                .options(selectinload(Assessment.course_instance))
            )
            assessment = result.scalar_one()

            assessment.score = review.overall_score
            assessment.passed = review.pass_decision == "pass"
            assessment.feedback = {
                "overall_score": review.overall_score,
                "objective_scores": [s.model_dump() for s in review.objective_scores],
                "pass_decision": review.pass_decision,
                "next_steps": review.next_steps,
            }
            assessment.status = "reviewed"
            await db.flush()

            if assessment.passed:
                result = await db.execute(
                    select(CourseInstance)
                    .where(CourseInstance.id == course_id)
                    .options(
                        selectinload(CourseInstance.lessons),
                        selectinload(CourseInstance.assessments),
                    )
                )
                course = result.scalar_one()
                try:
                    await transition_course(db, course, "completed")
                except InvalidTransitionError:
                    pass

            await db.commit()

        await broadcast(key, "review_complete", {
            "assessment_id": assessment_id,
        })

    except Exception:
        logger.exception("Error reviewing assessment %s", assessment_id)
        try:
            async with get_background_session() as db:
                result = await db.execute(
                    select(Assessment).where(Assessment.id == assessment_id)
                )
                assessment = result.scalar_one_or_none()
                if assessment and assessment.status == "submitted":
                    assessment.status = "pending"
                    await db.flush()
                    await db.commit()
        except Exception:
            logger.exception("Could not roll back assessment %s status", assessment_id)

        await broadcast(key, "review_error", {
            "error": "Failed to review assessment",
        })
