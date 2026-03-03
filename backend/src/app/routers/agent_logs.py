from fastapi import APIRouter, Depends, Query
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.auth.dependencies import get_current_user
from app.db.models import AgentLog, User
from app.db.session import get_db_session
from app.schemas.agent_log import AgentLogResponse

router = APIRouter(prefix="/api/agent-logs", tags=["agent-logs"])


@router.get("", response_model=list[AgentLogResponse])
async def list_agent_logs(
    course_id: str | None = Query(default=None),
    user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db_session),
):
    q = select(AgentLog).where(AgentLog.user_id == user.id)
    if course_id:
        q = q.where(AgentLog.course_instance_id == course_id)
    q = q.order_by(AgentLog.created_at.desc())
    result = await db.execute(q)
    return result.scalars().all()
