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


async def _instance_by_source(db: AsyncSession, user_id: str) -> dict[str, tuple[str, str]]:
    """Return {source_course_id: (instance_id, status)} for user's predefined courses."""
    result = await db.execute(
        select(
            CourseInstance.source_course_id,
            CourseInstance.id,
            CourseInstance.status,
        ).where(
            CourseInstance.user_id == user_id,
            CourseInstance.source_type == "predefined",
        )
    )
    mapping: dict[str, tuple[str, str]] = {}
    for row in result.all():
        if row[0]:
            mapping[row[0]] = (str(row[1]), row[2])
    return mapping


@router.get("")
async def list_catalog(
    user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db_session),
):
    catalog = get_catalog()
    courses = list(catalog.values())

    completed = await _completed_source_ids(db, user.id)
    instances = await _instance_by_source(db, user.id)

    all_catalog = get_catalog()
    all_completed = all(cid in completed for cid in all_catalog)

    items = []
    for c in courses:
        entry = {
            **c.model_dump(),
            "locked": c.depends_on is not None and c.depends_on not in completed,
            "completed": c.course_id in completed,
            "instance_id": None,
            "instance_status": None,
        }
        if c.course_id in instances:
            entry["instance_id"] = instances[c.course_id][0]
            entry["instance_status"] = instances[c.course_id][1]
        items.append(entry)

    return {
        "courses": items,
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

    # Return existing instance if user already started this course
    existing = await db.execute(
        select(CourseInstance).where(
            CourseInstance.user_id == user.id,
            CourseInstance.source_type == "predefined",
            CourseInstance.source_course_id == course_id,
        )
    )
    instance = existing.scalar_one_or_none()
    if instance:
        return {"id": instance.id, "status": instance.status}

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
