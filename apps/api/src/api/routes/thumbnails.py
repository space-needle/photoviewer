from __future__ import annotations

from typing import Any

from fastapi import APIRouter, Body, HTTPException

from api.services.photos import ensure_thumbnail


router = APIRouter(prefix="/thumbnails", tags=["thumbnails"])


@router.post("/ensure")
def ensure_photo_thumbnails(
    payload: dict[str, Any] = Body(...),
) -> dict[str, list[dict[str, str | None]]]:
    photo_ids = payload.get("photo_ids", [])
    force = payload.get("force", False)

    if not isinstance(photo_ids, list):
        raise HTTPException(status_code=400, detail="photo_ids must be a list.")

    if not isinstance(force, bool):
        raise HTTPException(status_code=400, detail="force must be a boolean.")

    items: list[dict[str, str | None]] = []
    for photo_id in photo_ids:
        try:
            items.append(ensure_thumbnail(str(photo_id), force=force))
        except HTTPException:
            items.append({"id": str(photo_id), "thumbnail_path": None})

    return {"items": items}
