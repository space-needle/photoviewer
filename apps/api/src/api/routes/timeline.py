from __future__ import annotations

from fastapi import APIRouter, HTTPException, Query

from api.services.timeline import (
    ZOOM_CONFIG,
    build_timeline_buckets,
    format_iso_timestamp,
    parse_iso_timestamp,
)


router = APIRouter(prefix="/timeline", tags=["timeline"])


@router.get("/buckets")
def get_timeline_buckets(
    start: str = Query(..., description="Inclusive start ISO timestamp."),
    end: str = Query(..., description="Exclusive end ISO timestamp."),
    zoom: str = Query(..., description="overview, mid, or detail."),
    include_empty: bool = Query(True),
) -> dict[str, object]:
    if zoom not in ZOOM_CONFIG:
        raise HTTPException(
            status_code=400,
            detail="Invalid zoom. Expected one of: overview, mid, detail.",
        )

    try:
        parsed_start = parse_iso_timestamp(start)
        parsed_end = parse_iso_timestamp(end)
    except ValueError as error:
        raise HTTPException(
            status_code=400,
            detail=f"Invalid timestamp: {error}",
        ) from error

    if parsed_start >= parsed_end:
        raise HTTPException(
            status_code=400,
            detail="start must be earlier than end.",
        )

    bucket_size, buckets = build_timeline_buckets(
        start=parsed_start,
        end=parsed_end,
        zoom=zoom,
        include_empty=include_empty,
    )

    return {
        "start": format_iso_timestamp(parsed_start),
        "end": format_iso_timestamp(parsed_end),
        "zoom": zoom,
        "bucket_size": bucket_size,
        "buckets": [
            {
                "bucket_start": bucket.bucket_start,
                "bucket_end": bucket.bucket_end,
                "photo_count": bucket.photo_count,
                "color_level": bucket.color_level,
                "has_gap_label": bucket.has_gap_label,
                "gap_label": bucket.gap_label,
            }
            for bucket in buckets
        ],
    }
