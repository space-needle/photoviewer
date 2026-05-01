from __future__ import annotations

from fastapi import APIRouter, Body, HTTPException

from api.services.photos import ensure_thumbnail


router = APIRouter(prefix="/thumbnails", tags=["thumbnails"])


@router.post("/ensure")
def ensure_photo_thumbnails(
    payload: dict[str, list[str]] = Body(...),
) -> dict[str, list[dict[str, str | None]]]:
    photo_ids = payload.get("photo_ids", [])
    if not isinstance(photo_ids, list):
        raise HTTPException(status_code=400, detail="photo_ids must be a list.")

    items: list[dict[str, str | None]] = []
    for photo_id in photo_ids:
        try:
            items.append(ensure_thumbnail(str(photo_id)))
        except HTTPException:
            items.append({"id": str(photo_id), "thumbnail_path": None})

    return {"items": items}
