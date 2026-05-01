from __future__ import annotations

from dataclasses import dataclass
from datetime import UTC, datetime
from pathlib import Path
from typing import Any

from fastapi import HTTPException
from sqlalchemy import text

from api.db.connection import THUMBNAILS_DIR
from api.db.defaults import DEFAULT_SOURCE_ACCOUNT_ID, DEFAULT_USER_ID
from api.db.session import get_session

try:
    from PIL import Image
    from PIL import ImageOps
except ModuleNotFoundError as import_error:
    Image = None
    ImageOps = None
    PIL_IMPORT_ERROR = import_error
else:
    PIL_IMPORT_ERROR = None

try:
    from pillow_heif import register_heif_opener
except ModuleNotFoundError:
    HEIF_IMPORT_ERROR = True
else:
    register_heif_opener()
    HEIF_IMPORT_ERROR = False


THUMBNAIL_MAX_DIMENSION = 320


def iso_now() -> str:
    return datetime.now(UTC).isoformat(timespec="seconds").replace("+00:00", "Z")


@dataclass(slots=True)
class PhotoRecord:
    id: str
    user_id: str
    source_account_id: str
    file_path: str
    file_name: str
    thumbnail_path: str | None
    timestamp_normalized: str
    latitude: float | None
    longitude: float | None
    source_type: str
    timestamp_original: str | None
    timezone_offset: str | None
    width: int | None
    height: int | None
    fingerprint: str | None
    created_at: str
    updated_at: str

    @classmethod
    def from_row(cls, row: Any) -> "PhotoRecord":
        return cls(
            id=str(row["id"]),
            user_id=str(row["user_id"]),
            source_account_id=str(row["source_account_id"]),
            file_path=str(row["file_path"]),
            file_name=str(row["file_name"]),
            thumbnail_path=str(row["thumbnail_path"]) if row["thumbnail_path"] else None,
            timestamp_normalized=str(row["timestamp_normalized"]),
            latitude=float(row["latitude"]) if row["latitude"] is not None else None,
            longitude=float(row["longitude"]) if row["longitude"] is not None else None,
            source_type=str(row["source_type"]),
            timestamp_original=(
                str(row["timestamp_original"]) if row["timestamp_original"] else None
            ),
            timezone_offset=(
                str(row["timezone_offset"]) if row["timezone_offset"] else None
            ),
            width=int(row["width"]) if row["width"] is not None else None,
            height=int(row["height"]) if row["height"] is not None else None,
            fingerprint=str(row["fingerprint"]) if row["fingerprint"] else None,
            created_at=str(row["created_at"]),
            updated_at=str(row["updated_at"]),
        )

    def to_list_item(self) -> dict[str, object | None]:
        return {
            "id": self.id,
            "file_path": self.file_path,
            "file_name": self.file_name,
            "thumbnail_path": self.thumbnail_path,
            "timestamp_normalized": self.timestamp_normalized,
            "latitude": self.latitude,
            "longitude": self.longitude,
        }

    def to_detail(self) -> dict[str, object | None]:
        return {
            "id": self.id,
            "user_id": self.user_id,
            "source_account_id": self.source_account_id,
            "source_type": self.source_type,
            "file_path": self.file_path,
            "file_name": self.file_name,
            "timestamp_original": self.timestamp_original,
            "timestamp_normalized": self.timestamp_normalized,
            "timezone_offset": self.timezone_offset,
            "latitude": self.latitude,
            "longitude": self.longitude,
            "width": self.width,
            "height": self.height,
            "thumbnail_path": self.thumbnail_path,
            "fingerprint": self.fingerprint,
            "created_at": self.created_at,
            "updated_at": self.updated_at,
        }


def list_photos_in_bucket(
    bucket_start: str,
    bucket_end: str,
    limit: int,
    offset: int,
) -> dict[str, object]:
    with get_session() as session:
        total = session.execute(
            text(
                """
            SELECT COUNT(*)
            FROM photos
            WHERE timestamp_normalized >= :bucket_start
              AND timestamp_normalized < :bucket_end
              AND user_id = :user_id
              AND source_account_id = :source_account_id
            """,
            ),
            {
                "bucket_start": bucket_start,
                "bucket_end": bucket_end,
                "user_id": DEFAULT_USER_ID,
                "source_account_id": DEFAULT_SOURCE_ACCOUNT_ID,
            },
        ).scalar_one()

        rows = session.execute(
            text(
                """
            SELECT *
            FROM photos
            WHERE timestamp_normalized >= :bucket_start
              AND timestamp_normalized < :bucket_end
              AND user_id = :user_id
              AND source_account_id = :source_account_id
            ORDER BY timestamp_normalized, id
            LIMIT :limit OFFSET :offset
            """,
            ),
            {
                "bucket_start": bucket_start,
                "bucket_end": bucket_end,
                "user_id": DEFAULT_USER_ID,
                "source_account_id": DEFAULT_SOURCE_ACCOUNT_ID,
                "limit": limit,
                "offset": offset,
            },
        ).mappings().all()

    items = [PhotoRecord.from_row(row).to_list_item() for row in rows]
    return {"total": int(total), "items": items}


def get_photo_range() -> dict[str, object | None]:
    with get_session() as session:
        row = session.execute(
            text(
                """
            SELECT
              MIN(timestamp_normalized) AS start,
              MAX(timestamp_normalized) AS end,
              COUNT(*) AS photo_count
            FROM photos
            WHERE user_id = :user_id
              AND source_account_id = :source_account_id
            """
            ),
            {
                "user_id": DEFAULT_USER_ID,
                "source_account_id": DEFAULT_SOURCE_ACCOUNT_ID,
            },
        ).mappings().one()

    photo_count = int(row["photo_count"])
    return {
        "start": str(row["start"]) if row["start"] else None,
        "end": str(row["end"]) if row["end"] else None,
        "photo_count": photo_count,
    }


def get_photo(photo_id: str) -> PhotoRecord:
    with get_session() as session:
        row = session.execute(
            text(
                """
                SELECT *
                FROM photos
                WHERE id = :photo_id
                  AND user_id = :user_id
                  AND source_account_id = :source_account_id
                """
            ),
            {
                "photo_id": photo_id,
                "user_id": DEFAULT_USER_ID,
                "source_account_id": DEFAULT_SOURCE_ACCOUNT_ID,
            },
        ).mappings().one_or_none()

    if row is None:
        raise HTTPException(status_code=404, detail="Photo not found.")

    return PhotoRecord.from_row(row)


def ensure_thumbnail(photo_id: str, force: bool = False) -> dict[str, str | None]:
    photo = get_photo(photo_id)
    source_path = Path(photo.file_path)

    if not source_path.exists():
        raise HTTPException(status_code=404, detail=f"Photo file missing: {photo.file_name}")

    thumbnail_filename = f"{photo.id}.jpg"
    thumbnail_file = THUMBNAILS_DIR / thumbnail_filename
    thumbnail_url = f"/thumbnails/{thumbnail_filename}"

    if not force and photo.thumbnail_path == thumbnail_url and thumbnail_file.exists():
        return {"id": photo.id, "thumbnail_path": thumbnail_url}

    if PIL_IMPORT_ERROR is not None:
        raise HTTPException(
            status_code=500,
            detail="Pillow is required for thumbnail generation.",
        ) from PIL_IMPORT_ERROR

    if source_path.suffix.lower() == ".heic" and HEIF_IMPORT_ERROR:
        raise HTTPException(
            status_code=500,
            detail="HEIC thumbnail generation requires pillow-heif.",
        )

    with Image.open(source_path) as image:
        image = ImageOps.exif_transpose(image)
        image = image.convert("RGB")
        image.thumbnail((THUMBNAIL_MAX_DIMENSION, THUMBNAIL_MAX_DIMENSION))
        image.save(thumbnail_file, format="JPEG", quality=85)

    with get_session() as session:
        session.execute(
            text(
                """
            UPDATE photos
            SET thumbnail_path = :thumbnail_path, updated_at = :updated_at
            WHERE id = :photo_id
              AND user_id = :user_id
              AND source_account_id = :source_account_id
            """,
            ),
            {
                "thumbnail_path": thumbnail_url,
                "updated_at": iso_now(),
                "photo_id": photo.id,
                "user_id": DEFAULT_USER_ID,
                "source_account_id": DEFAULT_SOURCE_ACCOUNT_ID,
            },
        )
        session.commit()

    return {"id": photo.id, "thumbnail_path": thumbnail_url}
