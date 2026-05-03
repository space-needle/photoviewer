from __future__ import annotations

import math
import sys
from dataclasses import dataclass
from datetime import UTC, datetime, timedelta
from pathlib import Path
from uuid import uuid4

from sqlalchemy import inspect, text


PROJECT_ROOT = Path(__file__).resolve().parents[1]
API_SRC = PROJECT_ROOT / "apps" / "api" / "src"

if str(API_SRC) not in sys.path:
    sys.path.insert(0, str(API_SRC))

from api.db.defaults import DEFAULT_SOURCE_ACCOUNT_ID, DEFAULT_USER_ID  # noqa: E402
from api.db.session import engine, initialize_storage  # noqa: E402


MAX_VISIT_GAP = timedelta(hours=12)
MAX_VISIT_DISTANCE_MILES = 30.0
EARTH_RADIUS_MILES = 3958.8


@dataclass(slots=True)
class VisitPhoto:
    id: str
    timestamp: str
    latitude: float
    longitude: float


@dataclass(slots=True)
class ExistingVisit:
    id: str
    title: str
    created_at: str


@dataclass(slots=True)
class VisitTableShape:
    has_user_id: bool
    has_source_account_id: bool


def parse_timestamp(value: str) -> datetime:
    parsed = datetime.fromisoformat(value.replace("Z", "+00:00"))
    if parsed.tzinfo is not None:
        return parsed.astimezone(UTC).replace(tzinfo=None)
    return parsed


def iso_now() -> str:
    return datetime.now(UTC).isoformat(timespec="seconds").replace("+00:00", "Z")


def distance_miles(first: VisitPhoto, second: VisitPhoto) -> float:
    lat1 = math.radians(first.latitude)
    lat2 = math.radians(second.latitude)
    delta_lat = math.radians(second.latitude - first.latitude)
    delta_lon = math.radians(second.longitude - first.longitude)

    a = (
        math.sin(delta_lat / 2) ** 2
        + math.cos(lat1) * math.cos(lat2) * math.sin(delta_lon / 2) ** 2
    )
    return EARTH_RADIUS_MILES * (2 * math.atan2(math.sqrt(a), math.sqrt(1 - a)))


def load_visit_photos() -> list[VisitPhoto]:
    with engine.connect() as connection:
        rows = connection.execute(
            text(
                """
            SELECT id, timestamp_normalized, latitude, longitude
            FROM photos
            WHERE latitude IS NOT NULL
              AND longitude IS NOT NULL
              AND user_id = :user_id
              AND source_account_id = :source_account_id
            ORDER BY timestamp_normalized, id
            """,
            ),
            {
                "user_id": DEFAULT_USER_ID,
                "source_account_id": DEFAULT_SOURCE_ACCOUNT_ID,
            },
        ).mappings().all()

    return [
        VisitPhoto(
            id=str(row["id"]),
            timestamp=str(row["timestamp_normalized"]),
            latitude=float(row["latitude"]),
            longitude=float(row["longitude"]),
        )
        for row in rows
    ]


def group_visits(photos: list[VisitPhoto]) -> list[list[VisitPhoto]]:
    visits: list[list[VisitPhoto]] = []
    current_visit: list[VisitPhoto] = []

    for photo in photos:
        if not current_visit:
            current_visit.append(photo)
            continue

        previous = current_visit[-1]
        time_gap = parse_timestamp(photo.timestamp) - parse_timestamp(previous.timestamp)
        distance_gap = distance_miles(previous, photo)

        if time_gap > MAX_VISIT_GAP or distance_gap > MAX_VISIT_DISTANCE_MILES:
            visits.append(current_visit)
            current_visit = [photo]
        else:
            current_visit.append(photo)

    if current_visit:
        visits.append(current_visit)

    return visits


def visit_signature(visit: list[VisitPhoto]) -> str:
    return "|".join(photo.id for photo in visit)


def load_existing_visits() -> dict[str, ExistingVisit]:
    visits_by_id: dict[str, ExistingVisit] = {}
    photo_ids_by_visit_id: dict[str, list[str]] = {}

    with engine.connect() as connection:
        rows = connection.execute(
            text(
                """
            SELECT
              visits.id,
              visits.title,
              visits.created_at,
              photo_visits.photo_id
            FROM visits
            JOIN photo_visits ON photo_visits.visit_id = visits.id
            JOIN photos ON photos.id = photo_visits.photo_id
            WHERE photos.user_id = :user_id
              AND photos.source_account_id = :source_account_id
            ORDER BY visits.id, photos.timestamp_normalized, photos.id
            """
            ),
            {
                "user_id": DEFAULT_USER_ID,
                "source_account_id": DEFAULT_SOURCE_ACCOUNT_ID,
            },
        ).mappings().all()

    for row in rows:
        visit_id = str(row["id"])
        visits_by_id.setdefault(
            visit_id,
            ExistingVisit(
                id=visit_id,
                title=str(row["title"]),
                created_at=str(row["created_at"]),
            ),
        )
        photo_ids_by_visit_id.setdefault(visit_id, []).append(str(row["photo_id"]))

    return {
        "|".join(photo_ids): visits_by_id[visit_id]
        for visit_id, photo_ids in photo_ids_by_visit_id.items()
        if photo_ids and visits_by_id[visit_id].title
    }


def get_visit_table_shape() -> VisitTableShape:
    inspector = inspect(engine)
    visit_columns = {column["name"] for column in inspector.get_columns("visits")}
    return VisitTableShape(
        has_user_id="user_id" in visit_columns,
        has_source_account_id="source_account_id" in visit_columns,
    )


def persist_visits(visits: list[list[VisitPhoto]]) -> None:
    now = iso_now()
    existing_visits = load_existing_visits()
    table_shape = get_visit_table_shape()

    with engine.begin() as connection:
        if table_shape.has_user_id and table_shape.has_source_account_id:
            connection.execute(
                text(
                    """
                    DELETE FROM photo_visits
                    WHERE visit_id IN (
                      SELECT id
                      FROM visits
                      WHERE user_id = :user_id
                        AND source_account_id = :source_account_id
                    )
                    """
                ),
                {
                    "user_id": DEFAULT_USER_ID,
                    "source_account_id": DEFAULT_SOURCE_ACCOUNT_ID,
                },
            )
            connection.execute(
                text(
                    """
                    DELETE FROM visits
                    WHERE user_id = :user_id
                      AND source_account_id = :source_account_id
                    """
                ),
                {
                    "user_id": DEFAULT_USER_ID,
                    "source_account_id": DEFAULT_SOURCE_ACCOUNT_ID,
                },
            )
        else:
            connection.execute(text("DELETE FROM photo_visits"))
            connection.execute(text("DELETE FROM visits"))

        for visit in visits:
            existing_visit = existing_visits.get(visit_signature(visit))
            visit_id = existing_visit.id if existing_visit else str(uuid4())
            start_time = visit[0].timestamp
            end_time = visit[-1].timestamp
            start_date = parse_timestamp(start_time).date().isoformat()
            title = existing_visit.title if existing_visit else f"Visit: {start_date}"
            center_lat = sum(photo.latitude for photo in visit) / len(visit)
            center_lon = sum(photo.longitude for photo in visit) / len(visit)

            visit_values = {
                "id": visit_id,
                "title": title,
                "start_time": start_time,
                "end_time": end_time,
                "center_lat": center_lat,
                "center_lon": center_lon,
                "photo_count": len(visit),
                "created_at": existing_visit.created_at if existing_visit else now,
                "updated_at": now,
            }
            visit_columns = [
                "id",
                "title",
                "start_time",
                "end_time",
                "center_lat",
                "center_lon",
                "photo_count",
                "location_label",
                "created_at",
                "updated_at",
            ]
            if table_shape.has_user_id:
                visit_columns.insert(1, "user_id")
                visit_values["user_id"] = DEFAULT_USER_ID
            if table_shape.has_source_account_id:
                visit_columns.insert(2 if table_shape.has_user_id else 1, "source_account_id")
                visit_values["source_account_id"] = DEFAULT_SOURCE_ACCOUNT_ID

            placeholders = [
                "NULL" if column == "location_label" else f":{column}"
                for column in visit_columns
            ]
            connection.execute(
                text(
                    f"""
                INSERT INTO visits (
                  {", ".join(visit_columns)}
                ) VALUES (
                  {", ".join(placeholders)}
                )
                """
                ),
                visit_values,
            )

            connection.execute(
                text(
                    """
                    INSERT INTO photo_visits (photo_id, visit_id)
                    VALUES (:photo_id, :visit_id)
                    """
                ),
                [{"photo_id": photo.id, "visit_id": visit_id} for photo in visit],
            )


def load_persisted_counts() -> tuple[int, int]:
    with engine.connect() as connection:
        visit_count = connection.execute(text("SELECT COUNT(*) FROM visits")).scalar_one()
        photo_visit_count = connection.execute(text("SELECT COUNT(*) FROM photo_visits")).scalar_one()

    return int(visit_count), int(photo_visit_count)


def main() -> int:
    initialize_storage()
    photos = load_visit_photos()
    visits = group_visits(photos)
    persist_visits(visits)
    print(f"Detected {len(visits)} visits from {len(photos)} GPS-tagged photos.")
    visit_count, photo_visit_count = load_persisted_counts()
    print(f"Persisted visits={visit_count} photo_visits={photo_visit_count}.")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
