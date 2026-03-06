import logging
import logging.config
from contextlib import asynccontextmanager
from pathlib import Path

from fastapi import FastAPI

logging.config.dictConfig({
    "version": 1,
    "disable_existing_loggers": False,
    "formatters": {
        "default": {
            "format": "%(asctime)s [%(levelname)s] %(name)s: %(message)s",
            "datefmt": "%H:%M:%S",
        },
    },
    "handlers": {
        "console": {
            "class": "logging.StreamHandler",
            "formatter": "default",
            "stream": "ext://sys.stdout",
        },
    },
    "loggers": {
        "app": {"level": "DEBUG", "handlers": ["console"], "propagate": False},
    },
    "root": {"level": "INFO", "handlers": ["console"]},
})
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import FileResponse
from fastapi.staticfiles import StaticFiles

from app.config import settings
from app.services.catalog import load_catalog
from app.auth.router import router as auth_router
from app.routers import health, courses, activities, assessments, catalog, profile, agent_logs, portfolio


@asynccontextmanager
async def lifespan(app: FastAPI):
    load_catalog()
    yield


app = FastAPI(title="1111 School", version="0.1.0", lifespan=lifespan)

if settings.cors_origins:
    app.add_middleware(
        CORSMiddleware,
        allow_origins=settings.cors_origins,
        allow_credentials=True,
        allow_methods=["*"],
        allow_headers=["*"],
    )

app.include_router(auth_router)
app.include_router(health.router)
app.include_router(courses.router)
app.include_router(activities.router)
app.include_router(assessments.router)
app.include_router(catalog.router)
app.include_router(profile.router)
app.include_router(agent_logs.router)
app.include_router(portfolio.router)

# Serve pre-built frontend in production. In dev, Vite serves the frontend
# and proxies /api to this server — so these routes are never hit.
_static_dir = Path(__file__).resolve().parent.parent.parent / "static"
if _static_dir.is_dir():
    app.mount("/assets", StaticFiles(directory=_static_dir / "assets"), name="static-assets")

    @app.get("/{path:path}")
    async def spa_fallback(path: str):
        """Serve index.html for all non-API routes (SPA client-side routing)."""
        if path.startswith("api/"):
            from fastapi.responses import JSONResponse
            return JSONResponse({"detail": "Not found"}, status_code=404)
        return FileResponse(_static_dir / "index.html")
