from __future__ import annotations

from fastapi import APIRouter, HTTPException, Query

from api.db.connection import get_connection
from api.services.timeline import parse_iso_timestamp


router = APIRouter(prefix="/map", tags=["map"])


@router.get("/points")
def get_map_points(
    start: str | None = Query(None),
    end: str | None = Query(None),
    bounds: str | None = Query(None),
    cluster: bool = Query(False),
) -> dict[str, list[dict[str, object | None]]]:
    del bounds, cluster

    clauses = ["latitude IS NOT NULL", "longitude IS NOT NULL"]
    params: list[str] = []

    if start is not None:
        try:
            parse_iso_timestamp(start)
        except ValueError as error:
            raise HTTPException(status_code=400, detail=f"Invalid start timestamp: {error}") from error

        clauses.append("datetime(timestamp_normalized) >= datetime(?)")
        params.append(start)

    if end is not None:
        try:
            parse_iso_timestamp(end)
        except ValueError as error:
            raise HTTPException(status_code=400, detail=f"Invalid end timestamp: {error}") from error

        clauses.append("datetime(timestamp_normalized) < datetime(?)")
        params.append(end)

    if start is not None and end is not None:
        parsed_start = parse_iso_timestamp(start)
        parsed_end = parse_iso_timestamp(end)
        if parsed_start >= parsed_end:
            raise HTTPException(status_code=400, detail="start must be earlier than end.")

    with get_connection() as connection:
        rows = connection.execute(
            f"""
            SELECT
              id,
              latitude,
              longitude,
              thumbnail_path,
              timestamp_normalized,
              file_name
            FROM photos
            WHERE {" AND ".join(clauses)}
            ORDER BY datetime(timestamp_normalized), id
            """,
            params,
        ).fetchall()

    return {
        "items": [
            {
                "type": "photo",
                "id": str(row["id"]),
                "lat": float(row["latitude"]),
                "lon": float(row["longitude"]),
                "thumbnail_path": (
                    str(row["thumbnail_path"]) if row["thumbnail_path"] else None
                ),
                "timestamp_normalized": str(row["timestamp_normalized"]),
                "file_name": str(row["file_name"]),
            }
            for row in rows
        ],
    }
