from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.auth.dependencies import get_current_user
from app.db.models import CourseInstance, User
from app.db.session import get_db_session
from app.services.catalog import get_catalog, get_course

router = APIRouter(prefix="/api/catalog", tags=["catalog"])


async def _completed_source_ids(db: AsyncSession, user_id: str) -> set[str]:
    """Return source_course_ids of predefined courses the user has completed."""
    result = await db.execute(
        select(CourseInstance.source_course_id).where(
            CourseInstance.user_id == user_id,
            CourseInstance.source_type == "predefined",
            CourseInstance.status == "completed",
        )
    )
    return {row[0] for row in result.all() if row[0]}


@router.get("")
async def list_catalog(
    search: str | None = None,
    tag: str | None = None,
    user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db_session),
):
    catalog = get_catalog()
    courses = list(catalog.values())

    if search:
        search_lower = search.lower()
        courses = [
            c
            for c in courses
            if search_lower in c.name.lower() or search_lower in c.description.lower()
        ]

    if tag:
        courses = [c for c in courses if tag in c.tags]

    completed = await _completed_source_ids(db, user.id)

    all_catalog = get_catalog()
    all_completed = all(cid in completed for cid in all_catalog)

    return {
        "courses": [
            {
                **c.model_dump(),
                "locked": c.depends_on is not None and c.depends_on not in completed,
                "completed": c.course_id in completed,
            }
            for c in courses
        ],
        "all_completed": all_completed,
    }


@router.post("/{course_id}/start", response_model=dict)
async def start_predefined_course(
    course_id: str,
    user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db_session),
):
    predefined = get_course(course_id)
    if not predefined:
        raise HTTPException(status_code=404, detail="Course not found in catalog")

    # Enforce dependency
    if predefined.depends_on:
        completed = await _completed_source_ids(db, user.id)
        if predefined.depends_on not in completed:
            dep = get_course(predefined.depends_on)
            dep_name = dep.name if dep else predefined.depends_on
            raise HTTPException(
                status_code=400,
                detail=f"Complete \"{dep_name}\" first",
            )

    course = CourseInstance(
        user_id=user.id,
        source_type="predefined",
        source_course_id=course_id,
        input_description=predefined.description,
        input_objectives=predefined.learning_objectives,
        status="draft",
    )
    db.add(course)
    await db.flush()

    return {"id": course.id, "status": course.status}
