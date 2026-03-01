from datetime import datetime, timedelta, timezone

import bcrypt
import jwt

from app.config import settings


def hash_password(plain: str) -> str:
    return bcrypt.hashpw(plain.encode(), bcrypt.gensalt()).decode()


def verify_password(plain: str, hashed: str) -> bool:
    return bcrypt.checkpw(plain.encode(), hashed.encode())


def create_access_token(user_id: str) -> str:
    exp = datetime.now(timezone.utc) + timedelta(hours=settings.jwt_expiry_hours)
    return jwt.encode({"sub": user_id, "exp": exp}, settings.jwt_secret, algorithm="HS256")


def decode_access_token(token: str) -> str:
    """Decode a JWT and return the user_id. Raises jwt.PyJWTError on failure."""
    payload = jwt.decode(token, settings.jwt_secret, algorithms=["HS256"])
    user_id: str | None = payload.get("sub")
    if user_id is None:
        raise jwt.InvalidTokenError("Missing sub claim")
    return user_id
