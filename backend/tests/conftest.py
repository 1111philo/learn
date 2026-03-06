"""Shared test fixtures: async SQLite DB, FastAPI test client, auth helpers."""

import os

# Override settings BEFORE any app imports
os.environ["DATABASE_URL"] = "sqlite+aiosqlite:///:memory:"
os.environ["ANTHROPIC_API_KEY"] = "test-key"
os.environ["JWT_SECRET"] = "test-secret"

import pytest
from httpx import ASGITransport, AsyncClient
from sqlalchemy import JSON, event, text
from sqlalchemy.ext.asyncio import AsyncSession, async_sessionmaker, create_async_engine
from sqlalchemy.pool import StaticPool

from app.db.models import Base

# Patch JSONB → JSON so SQLite can handle it
from sqlalchemy.dialects.postgresql import JSONB

for table in Base.metadata.tables.values():
    for column in table.columns:
        if isinstance(column.type, JSONB):
            column.type = JSON()

# Single shared in-memory SQLite DB across all connections
engine = create_async_engine(
    "sqlite+aiosqlite://",
    connect_args={"check_same_thread": False},
    poolclass=StaticPool,
)
TestSessionLocal = async_sessionmaker(engine, expire_on_commit=False)


@event.listens_for(engine.sync_engine, "connect")
def _set_sqlite_pragma(dbapi_conn, _):
    cursor = dbapi_conn.cursor()
    cursor.execute("PRAGMA foreign_keys=ON")
    cursor.close()


@pytest.fixture(autouse=True)
async def setup_db():
    """Create all tables before each test, drop after."""
    async with engine.begin() as conn:
        await conn.run_sync(Base.metadata.create_all)
    yield
    async with engine.begin() as conn:
        # Disable FK checks for clean teardown (circular FK refs)
        await conn.execute(text("PRAGMA foreign_keys=OFF"))
        await conn.run_sync(Base.metadata.drop_all)
        await conn.execute(text("PRAGMA foreign_keys=ON"))


@pytest.fixture
async def db_session():
    """Provide a clean DB session for direct model manipulation in tests."""
    async with TestSessionLocal() as session:
        yield session


@pytest.fixture
async def client():
    """Async HTTP client wired to the FastAPI app with test DB."""
    from app.db.session import get_db_session
    from app.main import app

    async def _override_db():
        async with TestSessionLocal() as session:
            try:
                yield session
                await session.commit()
            except Exception:
                await session.rollback()
                raise

    app.dependency_overrides[get_db_session] = _override_db
    transport = ASGITransport(app=app)
    async with AsyncClient(transport=transport, base_url="http://test") as ac:
        yield ac
    app.dependency_overrides.clear()


@pytest.fixture
async def auth_headers(client: AsyncClient) -> dict[str, str]:
    """Register a test user and return Authorization headers."""
    resp = await client.post("/api/auth/register", json={
        "email": "test@example.com",
        "password": "testpass123",
    })
    assert resp.status_code == 200
    token = resp.json()["token"]
    return {"Authorization": f"Bearer {token}"}


@pytest.fixture
async def second_user_headers(client: AsyncClient) -> dict[str, str]:
    """Register a second test user for ownership/isolation tests."""
    resp = await client.post("/api/auth/register", json={
        "email": "other@example.com",
        "password": "testpass123",
    })
    assert resp.status_code == 200
    token = resp.json()["token"]
    return {"Authorization": f"Bearer {token}"}
