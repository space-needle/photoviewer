from __future__ import annotations

from pathlib import Path

from fastapi import APIRouter, HTTPException, Query
from fastapi.responses import FileResponse

from api.services.photos import get_photo, get_photo_range, list_photos_in_bucket
from api.services.timeline import parse_iso_timestamp


router = APIRouter(prefix="/photos", tags=["photos"])


@router.get("")
def get_photos(
    bucket_start: str = Query(...),
    bucket_end: str = Query(...),
    limit: int = Query(100, ge=1, le=500),
    offset: int = Query(0, ge=0),
) -> dict[str, object]:
    try:
        parsed_start = parse_iso_timestamp(bucket_start)
        parsed_end = parse_iso_timestamp(bucket_end)
    except ValueError as error:
        raise HTTPException(status_code=400, detail=f"Invalid timestamp: {error}") from error

    if parsed_start >= parsed_end:
        raise HTTPException(status_code=400, detail="bucket_start must be earlier than bucket_end.")

    return list_photos_in_bucket(bucket_start, bucket_end, limit, offset)


@router.get("/range")
def get_photos_range() -> dict[str, object | None]:
    return get_photo_range()


@router.get("/{photo_id}")
def get_photo_detail(photo_id: str) -> dict[str, object | None]:
    return get_photo(photo_id).to_detail()


@router.get("/{photo_id}/file")
def get_photo_file(photo_id: str) -> FileResponse:
    photo = get_photo(photo_id)
    file_path = Path(photo.file_path)

    if not file_path.exists():
        raise HTTPException(status_code=404, detail="Photo file not found.")

    return FileResponse(file_path, filename=photo.file_name)
