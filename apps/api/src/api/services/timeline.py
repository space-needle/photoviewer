from __future__ import annotations

from dataclasses import dataclass
from datetime import UTC, datetime, timedelta
from typing import Literal

from api.db.connection import get_connection


ZoomLevel = Literal["overview", "mid", "detail"]

ZOOM_CONFIG: dict[ZoomLevel, dict[str, object]] = {
    "overview": {
        "bucket_delta": timedelta(days=1),
        "bucket_size": "1d",
        "gap_threshold": 7,
    },
    "mid": {
        "bucket_delta": timedelta(hours=6),
        "bucket_size": "6h",
        "gap_threshold": 4,
    },
    "detail": {
        "bucket_delta": timedelta(hours=1),
        "bucket_size": "1h",
        "gap_threshold": 24,
    },
}


@dataclass(slots=True)
class Bucket:
    bucket_start: str
    bucket_end: str
    photo_count: int
    color_level: int
    has_gap_label: bool
    gap_label: str | None


def parse_iso_timestamp(raw_value: str) -> datetime:
    normalized = raw_value.replace("Z", "+00:00")
    parsed = datetime.fromisoformat(normalized)
    if parsed.tzinfo is not None:
        parsed = parsed.astimezone(UTC).replace(tzinfo=None)
    return parsed


def format_iso_timestamp(value: datetime) -> str:
    return value.isoformat(timespec="seconds")


def floor_to_bucket(value: datetime, zoom: ZoomLevel) -> datetime:
    if zoom == "overview":
        return value.replace(hour=0, minute=0, second=0, microsecond=0)
    if zoom == "mid":
        return value.replace(
            hour=(value.hour // 6) * 6,
            minute=0,
            second=0,
            microsecond=0,
        )
    return value.replace(minute=0, second=0, microsecond=0)


def quantize_color_level(photo_count: int, zoom: ZoomLevel) -> int:
    if photo_count <= 0:
        return 0

    if zoom == "overview":
        if photo_count <= 2:
            return 1
        if photo_count <= 10:
            return 2
        if photo_count <= 30:
            return 3
        return 4

    if photo_count == 1:
        return 1
    if photo_count <= 5:
        return 2
    if photo_count <= 15:
        return 3
    return 4


def format_gap_label(empty_bucket_count: int, zoom: ZoomLevel) -> str:
    if zoom == "overview":
        return f"{empty_bucket_count}d gap"

    total_hours = empty_bucket_count * (6 if zoom == "mid" else 1)
    days = total_hours // 24
    if total_hours % 24 == 0:
        return f"{days}d gap"
    return f"{total_hours}h gap"


def fetch_bucket_counts(start: datetime, end: datetime, zoom: ZoomLevel) -> dict[datetime, int]:
    bucket_delta = ZOOM_CONFIG[zoom]["bucket_delta"]
    assert isinstance(bucket_delta, timedelta)

    with get_connection() as connection:
        rows = connection.execute(
            """
            SELECT timestamp_normalized
            FROM photos
            WHERE datetime(timestamp_normalized) >= datetime(?)
              AND datetime(timestamp_normalized) < datetime(?)
            ORDER BY datetime(timestamp_normalized)
            """,
            (format_iso_timestamp(start), format_iso_timestamp(end)),
        ).fetchall()

    counts: dict[datetime, int] = {}
    for row in rows:
        timestamp = parse_iso_timestamp(str(row["timestamp_normalized"]))
        bucket_start = floor_to_bucket(timestamp, zoom)
        if bucket_start >= end:
            continue
        counts[bucket_start] = counts.get(bucket_start, 0) + 1

    return counts


def build_raw_buckets(start: datetime, end: datetime, zoom: ZoomLevel) -> list[Bucket]:
    bucket_delta = ZOOM_CONFIG[zoom]["bucket_delta"]
    assert isinstance(bucket_delta, timedelta)

    counts = fetch_bucket_counts(start, end, zoom)
    buckets: list[Bucket] = []
    cursor = floor_to_bucket(start, zoom)

    while cursor < end:
        bucket_end = cursor + bucket_delta
        if bucket_end <= start:
            cursor = bucket_end
            continue

        bucket_count = counts.get(cursor, 0)
        buckets.append(
            Bucket(
                bucket_start=format_iso_timestamp(cursor),
                bucket_end=format_iso_timestamp(bucket_end),
                photo_count=bucket_count,
                color_level=quantize_color_level(bucket_count, zoom),
                has_gap_label=False,
                gap_label=None,
            ),
        )
        cursor = bucket_end

    return buckets


def compress_empty_gaps(buckets: list[Bucket], zoom: ZoomLevel) -> list[Bucket]:
    gap_threshold = ZOOM_CONFIG[zoom]["gap_threshold"]
    assert isinstance(gap_threshold, int)

    compressed: list[Bucket] = []
    index = 0

    while index < len(buckets):
        bucket = buckets[index]
        if bucket.photo_count != 0:
            compressed.append(bucket)
            index += 1
            continue

        run_end = index
        while run_end < len(buckets) and buckets[run_end].photo_count == 0:
            run_end += 1

        empty_bucket_count = run_end - index
        if empty_bucket_count >= gap_threshold:
            compressed.append(
                Bucket(
                    bucket_start=buckets[index].bucket_start,
                    bucket_end=buckets[run_end - 1].bucket_end,
                    photo_count=0,
                    color_level=0,
                    has_gap_label=True,
                    gap_label=format_gap_label(empty_bucket_count, zoom),
                ),
            )
        else:
            compressed.extend(buckets[index:run_end])

        index = run_end

    return compressed


def build_timeline_buckets(
    start: datetime,
    end: datetime,
    zoom: ZoomLevel,
    include_empty: bool,
) -> tuple[str, list[Bucket]]:
    raw_buckets = build_raw_buckets(start, end, zoom)
    bucket_size = ZOOM_CONFIG[zoom]["bucket_size"]
    assert isinstance(bucket_size, str)

    if include_empty:
        return bucket_size, compress_empty_gaps(raw_buckets, zoom)

    return bucket_size, [bucket for bucket in raw_buckets if bucket.photo_count > 0]
