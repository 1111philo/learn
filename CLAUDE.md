# CLAUDE.md

## Project: 1111

A gamified, artifact-centric learning platform with multi-activity lessons.

## Tech Stack

- **Backend:** Python 3.12, FastAPI, SQLAlchemy async, PostgreSQL 16, PydanticAI, Alembic, JWT auth
- **Frontend:** React 19, TypeScript, Vite, Tailwind CSS 4, shadcn/ui, Zustand, React Router v7
- **Infra:** AWS App Runner, ECR, Terraform (infra/), Docker multi-stage build

## Key Commands

- `npm run dev` — start frontend + backend dev servers
- `cd backend && PYTHONPATH=src uv run pytest tests/ -v` — run backend tests
- `cd backend && PYTHONPATH=src uv run alembic upgrade head` — run migrations
- `docker compose up --build` — run full stack locally

## PR Merge Checklist

Before merging to main, verify all of the following:

### Naming & Legacy
- [ ] No references to "1111 School" — the app name is "1111"
- [ ] No imports or references to deleted modules or files
- [ ] No comments describing removed features or old behavior

### Documentation
- [ ] README and any markdown docs reflect current behavior
- [ ] Inline comments and docstrings match the code they describe
- [ ] API endpoint docs (if any) match actual routes

### Deploy & Infra
- [ ] docker-compose.yml ports and service names are correct (app: 8001:8000, db: 5432:5432)
- [ ] Dockerfile stages reference correct paths and build steps
- [ ] infra/ terraform files match current AWS architecture
- [ ] CI workflows (ci.yml, deploy.yml, deploy-test.yml) reference correct commands and paths
- [ ] Environment variables are consistent across .env.example, infra/, and docker-compose.yml

### Tests
- [ ] Tests don't import deleted modules
- [ ] Tests don't assert removed behavior
- [ ] New features have corresponding test coverage

### Cross-file Consistency
- [ ] TypeScript types (frontend/src/api/types.ts) match backend Pydantic models
- [ ] Route paths in frontend match backend router prefixes
- [ ] Shared constants (status enums, role names) are consistent across frontend and backend
