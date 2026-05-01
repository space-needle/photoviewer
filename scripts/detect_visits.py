from __future__ import annotations

import math
import sys
from dataclasses import dataclass
from datetime import UTC, datetime, timedelta
from pathlib import Path
from uuid import uuid4


PROJECT_ROOT = Path(__file__).resolve().parents[1]
API_SRC = PROJECT_ROOT / "apps" / "api" / "src"

if str(API_SRC) not in sys.path:
    sys.path.insert(0, str(API_SRC))

from api.db.connection import get_connection, initialize_database  # noqa: E402


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
    with get_connection() as connection:
        rows = connection.execute(
            """
            SELECT id, timestamp_normalized, latitude, longitude
            FROM photos
            WHERE latitude IS NOT NULL
              AND longitude IS NOT NULL
            ORDER BY datetime(timestamp_normalized), id
            """,
        ).fetchall()

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
    with get_connection() as connection:
        rows = connection.execute(
            """
            SELECT
              visits.id,
              visits.title,
              visits.created_at,
              (
                SELECT GROUP_CONCAT(ordered.photo_id, '|')
                FROM (
                  SELECT photo_visits.photo_id
                  FROM photo_visits
                  JOIN photos ON photos.id = photo_visits.photo_id
                  WHERE photo_visits.visit_id = visits.id
                  ORDER BY datetime(photos.timestamp_normalized), photos.id
                ) AS ordered
              ) AS photo_ids
            FROM visits
            """
        ).fetchall()

    return {
        str(row["photo_ids"]): ExistingVisit(
            id=str(row["id"]),
            title=str(row["title"]),
            created_at=str(row["created_at"]),
        )
        for row in rows
        if row["photo_ids"] and row["title"]
    }


def persist_visits(visits: list[list[VisitPhoto]]) -> None:
    now = iso_now()
    existing_visits = load_existing_visits()

    with get_connection() as connection:
        connection.execute("DELETE FROM photo_visits")
        connection.execute("DELETE FROM visits")

        for visit in visits:
            existing_visit = existing_visits.get(visit_signature(visit))
            visit_id = existing_visit.id if existing_visit else str(uuid4())
            start_time = visit[0].timestamp
            end_time = visit[-1].timestamp
            start_date = parse_timestamp(start_time).date().isoformat()
            title = existing_visit.title if existing_visit else f"Visit: {start_date}"
            center_lat = sum(photo.latitude for photo in visit) / len(visit)
            center_lon = sum(photo.longitude for photo in visit) / len(visit)

            connection.execute(
                """
                INSERT INTO visits (
                  id,
                  title,
                  start_time,
                  end_time,
                  center_lat,
                  center_lon,
                  photo_count,
                  location_label,
                  created_at,
                  updated_at
                ) VALUES (?, ?, ?, ?, ?, ?, ?, NULL, ?, ?)
                """,
                (
                    visit_id,
                    title,
                    start_time,
                    end_time,
                    center_lat,
                    center_lon,
                    len(visit),
                    existing_visit.created_at if existing_visit else now,
                    now,
                ),
            )

            connection.executemany(
                "INSERT INTO photo_visits (photo_id, visit_id) VALUES (?, ?)",
                [(photo.id, visit_id) for photo in visit],
            )


def main() -> int:
    initialize_database()
    photos = load_visit_photos()
    visits = group_visits(photos)
    persist_visits(visits)
    print(f"Detected {len(visits)} visits from {len(photos)} GPS-tagged photos.")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
