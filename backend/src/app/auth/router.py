from datetime import datetime, timezone

from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.auth.dependencies import get_current_user
from app.auth.utils import create_access_token, hash_password, verify_password
from app.db.models import User
from app.db.session import get_db_session
from app.schemas.auth import AuthResponse, LoginRequest, RegisterRequest, UserInfo

router = APIRouter(prefix="/api/auth", tags=["auth"])


@router.post("/register", response_model=AuthResponse)
async def register(req: RegisterRequest, db: AsyncSession = Depends(get_db_session)):
    result = await db.execute(select(User).where(User.email == req.email))
    if result.scalar_one_or_none() is not None:
        raise HTTPException(status_code=409, detail="Email already registered")

    user = User(email=req.email, password_hash=hash_password(req.password))
    db.add(user)
    await db.flush()

    token = create_access_token(user.id)
    return AuthResponse(token=token, user=UserInfo(id=user.id, email=user.email))


@router.post("/login", response_model=AuthResponse)
async def login(req: LoginRequest, db: AsyncSession = Depends(get_db_session)):
    result = await db.execute(select(User).where(User.email == req.email))
    user = result.scalar_one_or_none()

    if user is None or not user.password_hash or not verify_password(req.password, user.password_hash):
        raise HTTPException(status_code=401, detail="Invalid email or password")

    user.last_login_at = datetime.now(timezone.utc)
    await db.flush()

    token = create_access_token(user.id)
    return AuthResponse(token=token, user=UserInfo(id=user.id, email=user.email))


@router.get("/me", response_model=UserInfo)
async def me(user: User = Depends(get_current_user)):
    return UserInfo(id=user.id, email=user.email)
