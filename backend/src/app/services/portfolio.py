"""Portfolio artifact management.

Each course has a single evolving portfolio artifact. Activity submissions
update its content — each lesson builds on the previous version.
"""

import logging

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.db.models import Assessment, CourseInstance, PortfolioArtifact
from app.schemas.activity import ActivityReviewOutput
from app.schemas.assessment import AssessmentReviewOutput

logger = logging.getLogger(__name__)


async def update_course_artifact(
    db: AsyncSession,
    course: CourseInstance,
    submission_text: str,
    review: ActivityReviewOutput,
) -> PortfolioArtifact | None:
    """Update the course's portfolio artifact with the latest submission content.

    Called after every activity review. The submission text IS the latest
    version of the evolving portfolio document.
    """
    if not course.portfolio_artifact_id:
        return None

    result = await db.execute(
        select(PortfolioArtifact)
        .where(PortfolioArtifact.id == course.portfolio_artifact_id)
    )
    artifact = result.scalar_one_or_none()
    if not artifact:
        return None

    # Update content with the latest submission
    artifact.content_pointer = submission_text

    # Update status based on portfolio readiness
    status_map = {
        "portfolio_ready": "portfolio_ready",
        "emerging_portfolio_piece": "revised",
        "practice_only": "draft",
    }
    artifact.status = status_map.get(review.portfolio_readiness or "", "draft")

    # Update metadata from review
    if review.employer_relevance_notes:
        artifact.employer_use_case = review.employer_relevance_notes
    if review.resume_bullet_seed:
        artifact.resume_bullet_seed = review.resume_bullet_seed

    # Accumulate skills from activity specs
    spec_skills = review.employer_relevance_notes  # handled above
    await db.flush()

    logger.info(
        "Updated portfolio artifact %s (status=%s) with new content (%d chars)",
        artifact.id[:8], artifact.status, len(submission_text),
    )
    return artifact


async def create_capstone_artifact(
    db: AsyncSession,
    user_id: str,
    assessment: Assessment,
    review: AssessmentReviewOutput,
    course: CourseInstance,
) -> PortfolioArtifact | None:
    """Update the course's portfolio artifact with capstone assessment results."""
    if not course.portfolio_artifact_id:
        return None

    result = await db.execute(
        select(PortfolioArtifact)
        .where(PortfolioArtifact.id == course.portfolio_artifact_id)
    )
    artifact = result.scalar_one_or_none()
    if not artifact:
        return None

    # Get submission text from assessment
    submissions = assessment.submissions or []
    content_parts = []
    if isinstance(submissions, list):
        for sub in submissions:
            if isinstance(sub, dict):
                content_parts.append(sub.get("text", ""))
    if content_parts:
        # Append capstone content to existing artifact
        existing = artifact.content_pointer or ""
        capstone_section = "\n\n---\n\n## Capstone\n\n" + "\n\n".join(content_parts)
        artifact.content_pointer = existing + capstone_section

    if review.portfolio_title:
        artifact.title = review.portfolio_title
    artifact.status = "portfolio_ready"
    if review.portfolio_description:
        artifact.employer_use_case = review.portfolio_description

    # Link to assessment
    assessment.capstone_artifact_id = artifact.id
    await db.flush()

    logger.info(
        "Updated portfolio artifact %s with capstone results",
        artifact.id[:8],
    )
    return artifact
