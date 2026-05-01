from __future__ import annotations

from dataclasses import dataclass
from datetime import UTC, datetime
from typing import Any

from fastapi import HTTPException
from sqlalchemy import text

from api.db.defaults import DEFAULT_SOURCE_ACCOUNT_ID, DEFAULT_USER_ID
from api.db.session import get_session
from api.services.photos import PhotoRecord


MAX_VISIT_TITLE_LENGTH = 120


def iso_now() -> str:
    return datetime.now(UTC).isoformat(timespec="seconds").replace("+00:00", "Z")


@dataclass(slots=True)
class VisitRecord:
    id: str
    title: str | None
    start_time: str
    end_time: str
    center_lat: float | None
    center_lon: float | None
    photo_count: int
    location_label: str | None

    @classmethod
    def from_row(cls, row: Any) -> "VisitRecord":
        return cls(
            id=str(row["id"]),
            title=str(row["title"]) if row["title"] else None,
            start_time=str(row["start_time"]),
            end_time=str(row["end_time"]),
            center_lat=float(row["center_lat"]) if row["center_lat"] is not None else None,
            center_lon=float(row["center_lon"]) if row["center_lon"] is not None else None,
            photo_count=int(row["photo_count"]),
            location_label=str(row["location_label"]) if row["location_label"] else None,
        )

    def to_item(self) -> dict[str, object | None]:
        return {
            "id": self.id,
            "title": self.title,
            "start_time": self.start_time,
            "end_time": self.end_time,
            "center_lat": self.center_lat,
            "center_lon": self.center_lon,
            "photo_count": self.photo_count,
            "location_label": self.location_label,
        }


def list_visits(
    start: str | None,
    end: str | None,
    limit: int,
    offset: int,
) -> dict[str, object]:
    clauses: list[str] = [
        """
        EXISTS (
          SELECT 1
          FROM photo_visits
          JOIN photos ON photos.id = photo_visits.photo_id
          WHERE photo_visits.visit_id = visits.id
            AND photos.user_id = :user_id
            AND photos.source_account_id = :source_account_id
        )
        """,
    ]
    params: dict[str, object] = {
        "user_id": DEFAULT_USER_ID,
        "source_account_id": DEFAULT_SOURCE_ACCOUNT_ID,
    }

    if start is not None:
        clauses.append("end_time >= :start")
        params["start"] = start

    if end is not None:
        clauses.append("start_time < :end")
        params["end"] = end

    where = f"WHERE {' AND '.join(clauses)}" if clauses else ""

    with get_session() as session:
        total = session.execute(
            text(f"SELECT COUNT(*) FROM visits {where}"),
            params,
        ).scalar_one()
        rows = session.execute(
            text(
                f"""
            SELECT *
            FROM visits
            {where}
            ORDER BY start_time, id
            LIMIT :limit OFFSET :offset
            """,
            ),
            {**params, "limit": limit, "offset": offset},
        ).mappings().all()

    return {
        "total": int(total),
        "items": [VisitRecord.from_row(row).to_item() for row in rows],
    }


def get_visit(visit_id: str) -> VisitRecord:
    with get_session() as session:
        row = session.execute(
            text(
                """
                SELECT *
                FROM visits
                WHERE id = :visit_id
                  AND EXISTS (
                    SELECT 1
                    FROM photo_visits
                    JOIN photos ON photos.id = photo_visits.photo_id
                    WHERE photo_visits.visit_id = visits.id
                      AND photos.user_id = :user_id
                      AND photos.source_account_id = :source_account_id
                  )
                """
            ),
            {
                "visit_id": visit_id,
                "user_id": DEFAULT_USER_ID,
                "source_account_id": DEFAULT_SOURCE_ACCOUNT_ID,
            },
        ).mappings().one_or_none()

    if row is None:
        raise HTTPException(status_code=404, detail="Visit not found.")

    return VisitRecord.from_row(row)


def update_visit_title(visit_id: str, title: str) -> dict[str, object | None]:
    normalized_title = title.strip()

    if not normalized_title:
        raise HTTPException(status_code=400, detail="title is required.")

    if len(normalized_title) > MAX_VISIT_TITLE_LENGTH:
        raise HTTPException(
            status_code=400,
            detail=f"title must be {MAX_VISIT_TITLE_LENGTH} characters or fewer.",
        )

    get_visit(visit_id)

    with get_session() as session:
        session.execute(
            text(
                """
            UPDATE visits
            SET title = :title, updated_at = :updated_at
            WHERE id = :visit_id
            """,
            ),
            {"title": normalized_title, "updated_at": iso_now(), "visit_id": visit_id},
        )
        row = session.execute(
            text("SELECT * FROM visits WHERE id = :visit_id"),
            {"visit_id": visit_id},
        ).mappings().one()
        session.commit()

    return VisitRecord.from_row(row).to_item()


def list_visit_photos(visit_id: str, limit: int, offset: int) -> dict[str, object]:
    get_visit(visit_id)

    with get_session() as session:
        total = session.execute(
            text(
                """
                SELECT COUNT(*)
                FROM photo_visits
                JOIN photos ON photos.id = photo_visits.photo_id
                WHERE photo_visits.visit_id = :visit_id
                  AND photos.user_id = :user_id
                  AND photos.source_account_id = :source_account_id
                """
            ),
            {
                "visit_id": visit_id,
                "user_id": DEFAULT_USER_ID,
                "source_account_id": DEFAULT_SOURCE_ACCOUNT_ID,
            },
        ).scalar_one()
        rows = session.execute(
            text(
                """
            SELECT photos.*
            FROM photos
            JOIN photo_visits ON photo_visits.photo_id = photos.id
            WHERE photo_visits.visit_id = :visit_id
              AND photos.user_id = :user_id
              AND photos.source_account_id = :source_account_id
            ORDER BY photos.timestamp_normalized, photos.id
            LIMIT :limit OFFSET :offset
            """,
            ),
            {
                "visit_id": visit_id,
                "user_id": DEFAULT_USER_ID,
                "source_account_id": DEFAULT_SOURCE_ACCOUNT_ID,
                "limit": limit,
                "offset": offset,
            },
        ).mappings().all()

    return {
        "total": int(total),
        "items": [PhotoRecord.from_row(row).to_list_item() for row in rows],
    }
