from __future__ import annotations

import sys
from dataclasses import dataclass
from datetime import UTC, datetime
from pathlib import Path
from uuid import uuid4

from sqlalchemy import text


PROJECT_ROOT = Path(__file__).resolve().parents[1]
API_SRC = PROJECT_ROOT / "apps" / "api" / "src"

if str(API_SRC) not in sys.path:
    sys.path.insert(0, str(API_SRC))

from api.db.defaults import DEFAULT_USER_ID, ensure_default_identity  # noqa: E402
from api.db.session import SessionLocal, initialize_storage  # noqa: E402


@dataclass(slots=True)
class DayCount:
    day: str
    photo_count: int
    gps_photo_count: int


def iso_now() -> str:
    return datetime.now(UTC).isoformat(timespec="seconds").replace("+00:00", "Z")


def load_day_counts() -> list[DayCount]:
    with SessionLocal() as session:
        rows = session.execute(
            text(
                """
            SELECT
              SUBSTR(timestamp_normalized, 1, 10) AS day,
              COUNT(*) AS photo_count,
              SUM(
                CASE
                  WHEN latitude IS NOT NULL AND longitude IS NOT NULL THEN 1
                  ELSE 0
                END
              ) AS gps_photo_count
            FROM photos
            WHERE user_id = :user_id
              AND deleted_at IS NULL
            GROUP BY SUBSTR(timestamp_normalized, 1, 10)
            ORDER BY day
            """
            ),
            {"user_id": DEFAULT_USER_ID},
        ).mappings().all()

    return [
        DayCount(
            day=str(row["day"]),
            photo_count=int(row["photo_count"]),
            gps_photo_count=int(row["gps_photo_count"] or 0),
        )
        for row in rows
    ]


def rebuild_day_counts() -> int:
    initialize_storage()
    day_counts = load_day_counts()
    now = iso_now()

    with SessionLocal() as session:
        ensure_default_identity(session)
        session.execute(
            text(
                """
            DELETE FROM photo_day_counts
            WHERE user_id = :user_id
              AND source_account_id IS NULL
            """
            ),
            {"user_id": DEFAULT_USER_ID},
        )
        if day_counts:
            session.execute(
                text(
                    """
                INSERT INTO photo_day_counts (
                  id,
                  user_id,
                  source_account_id,
                  day,
                  photo_count,
                  gps_photo_count,
                  created_at,
                  updated_at
                ) VALUES (
                  :id,
                  :user_id,
                  NULL,
                  :day,
                  :photo_count,
                  :gps_photo_count,
                  :created_at,
                  :updated_at
                )
                """
                ),
                [
                    {
                        "id": str(uuid4()),
                        "user_id": DEFAULT_USER_ID,
                        "day": day_count.day,
                        "photo_count": day_count.photo_count,
                        "gps_photo_count": day_count.gps_photo_count,
                        "created_at": now,
                        "updated_at": now,
                    }
                    for day_count in day_counts
                ],
            )
        session.commit()

    return len(day_counts)


def main() -> int:
    count = rebuild_day_counts()
    print(f"Rebuilt timeline daily aggregates for {count} days.")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
