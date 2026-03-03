import os

from pydantic_settings import BaseSettings


class Settings(BaseSettings):
    database_url: str = "postgresql+asyncpg://learn:learn@localhost:5432/learn"
    default_model: str = "anthropic:claude-sonnet-4-6"
    fast_model: str = "anthropic:claude-haiku-4-5-20251001"
    anthropic_api_key: str = ""
    cors_origins: list[str] = ["http://localhost:5173", "http://localhost:3000"]
    jwt_secret: str = "change-me-in-production"
    jwt_expiry_hours: int = 168  # 7 days

    model_config = {"env_file": ".env", "extra": "ignore"}


settings = Settings()

if settings.jwt_secret == "change-me-in-production":
    import sys
    print(
        "\n"
        "  ⚠️  JWT_SECRET is using the default value.\n"
        "  This is fine for local development but MUST be changed in production.\n"
        "\n"
        "  Set JWT_SECRET in backend/.env or as an environment variable.\n",
        file=sys.stderr,
    )

if not settings.anthropic_api_key:
    import sys
    print(
        "\n"
        "  ⚠️  ANTHROPIC_API_KEY is not set.\n"
        "  The app will start, but course generation will fail.\n"
        "\n"
        "  Set it in backend/.env or as an environment variable.\n"
        "  Get a key at https://console.anthropic.com\n",
        file=sys.stderr,
    )
else:
    # Expose API key to environment so PydanticAI's provider picks it up
    os.environ.setdefault("ANTHROPIC_API_KEY", settings.anthropic_api_key)
