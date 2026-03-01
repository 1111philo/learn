from fastapi import Depends, HTTPException, Query, Request
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.orm import selectinload

from app.auth.utils import decode_access_token
from app.db.models import User
from app.db.session import get_db_session


async def get_current_user(
    request: Request,
    token: str | None = Query(None, include_in_schema=False),
    db: AsyncSession = Depends(get_db_session),
) -> User:
    """Extract JWT from Authorization header or token query param, load user."""
    jwt_token: str | None = None

    # Prefer Authorization header
    auth_header = request.headers.get("Authorization")
    if auth_header and auth_header.startswith("Bearer "):
        jwt_token = auth_header[7:]

    # Fall back to query param (for SSE endpoints)
    if jwt_token is None:
        jwt_token = token

    if jwt_token is None:
        raise HTTPException(status_code=401, detail="Not authenticated")

    try:
        user_id = decode_access_token(jwt_token)
    except Exception:
        raise HTTPException(status_code=401, detail="Invalid or expired token")

    result = await db.execute(
        select(User)
        .where(User.id == user_id)
        .options(selectinload(User.learner_profile))
    )
    user = result.scalar_one_or_none()
    if user is None:
        raise HTTPException(status_code=401, detail="User not found")
    return user
