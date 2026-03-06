import logging
from collections import Counter

from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.auth.dependencies import get_current_user
from app.db.models import PortfolioArtifact, User
from app.db.session import get_db_session
from app.schemas.portfolio import (
    PortfolioArtifactResponse,
    PortfolioArtifactUpdateRequest,
    PortfolioSummary,
)

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/api/portfolio", tags=["portfolio"])


@router.get("", response_model=list[PortfolioArtifactResponse])
async def list_portfolio(
    user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db_session),
):
    result = await db.execute(
        select(PortfolioArtifact)
        .where(PortfolioArtifact.user_id == user.id)
        .order_by(PortfolioArtifact.updated_at.desc())
    )
    artifacts = result.scalars().all()
    return [PortfolioArtifactResponse.model_validate(a) for a in artifacts]


@router.get("/summary", response_model=PortfolioSummary)
async def portfolio_summary(
    user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db_session),
):
    result = await db.execute(
        select(PortfolioArtifact)
        .where(PortfolioArtifact.user_id == user.id)
        .order_by(PortfolioArtifact.updated_at.desc())
    )
    artifacts = result.scalars().all()
    items = [PortfolioArtifactResponse.model_validate(a) for a in artifacts]
    status_counts = Counter(a.status for a in artifacts)
    return PortfolioSummary(
        artifacts=items,
        total=len(items),
        by_status=dict(status_counts),
    )


@router.get("/{artifact_id}", response_model=PortfolioArtifactResponse)
async def get_artifact(
    artifact_id: str,
    user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db_session),
):
    result = await db.execute(
        select(PortfolioArtifact)
        .where(PortfolioArtifact.id == artifact_id)
    )
    artifact = result.scalar_one_or_none()
    if not artifact or artifact.user_id != user.id:
        raise HTTPException(status_code=404, detail="Artifact not found")
    return PortfolioArtifactResponse.model_validate(artifact)


@router.patch("/{artifact_id}", response_model=PortfolioArtifactResponse)
async def update_artifact(
    artifact_id: str,
    req: PortfolioArtifactUpdateRequest,
    user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db_session),
):
    result = await db.execute(
        select(PortfolioArtifact)
        .where(PortfolioArtifact.id == artifact_id)
    )
    artifact = result.scalar_one_or_none()
    if not artifact or artifact.user_id != user.id:
        raise HTTPException(status_code=404, detail="Artifact not found")

    valid_statuses = {"draft", "revised", "portfolio_ready", "tool_ready"}
    if req.title is not None:
        artifact.title = req.title
    if req.status is not None:
        if req.status not in valid_statuses:
            raise HTTPException(status_code=400, detail=f"Invalid status. Must be one of: {valid_statuses}")
        artifact.status = req.status

    await db.flush()
    await db.commit()
    return PortfolioArtifactResponse.model_validate(artifact)
