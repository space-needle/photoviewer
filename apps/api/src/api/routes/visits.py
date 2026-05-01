from __future__ import annotations

from fastapi import APIRouter, Body, HTTPException, Query

from api.services.timeline import parse_iso_timestamp
from api.services.visits import list_visit_photos, list_visits, update_visit_title


router = APIRouter(prefix="/visits", tags=["visits"])


@router.get("")
def get_visits(
    start: str | None = Query(None),
    end: str | None = Query(None),
    limit: int = Query(100, ge=1, le=500),
    offset: int = Query(0, ge=0),
) -> dict[str, object]:
    if start is not None:
        try:
            parse_iso_timestamp(start)
        except ValueError as error:
            raise HTTPException(status_code=400, detail=f"Invalid start timestamp: {error}") from error

    if end is not None:
        try:
            parse_iso_timestamp(end)
        except ValueError as error:
            raise HTTPException(status_code=400, detail=f"Invalid end timestamp: {error}") from error

    if start is not None and end is not None and parse_iso_timestamp(start) >= parse_iso_timestamp(end):
        raise HTTPException(status_code=400, detail="start must be earlier than end.")

    return list_visits(start, end, limit, offset)


@router.patch("/{visit_id}")
def patch_visit(
    visit_id: str,
    payload: dict[str, object] | None = Body(default=None),
) -> dict[str, object | None]:
    title = payload.get("title") if payload else None

    if not isinstance(title, str):
        raise HTTPException(status_code=400, detail="title is required.")

    return update_visit_title(visit_id, title)


@router.get("/{visit_id}/photos")
def get_visit_photos(
    visit_id: str,
    limit: int = Query(100, ge=1, le=500),
    offset: int = Query(0, ge=0),
) -> dict[str, object]:
    return list_visit_photos(visit_id, limit, offset)
