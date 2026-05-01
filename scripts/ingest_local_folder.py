from __future__ import annotations

import argparse
import sys
from dataclasses import dataclass
from datetime import UTC, datetime
from pathlib import Path
from typing import Any, Iterable
from uuid import uuid4

from sqlalchemy.dialects.mysql import insert as mysql_insert
from sqlalchemy.dialects.sqlite import insert as sqlite_insert
from sqlalchemy.orm import Session

try:
    from PIL import Image
    from PIL.ExifTags import GPSTAGS, TAGS
except ModuleNotFoundError as import_error:
    Image = None
    GPSTAGS = {}
    TAGS = {}
    PIL_IMPORT_ERROR = import_error
else:
    PIL_IMPORT_ERROR = None

try:
    from pillow_heif import register_heif_opener
except ModuleNotFoundError as import_error:
    HEIF_IMPORT_ERROR = import_error
else:
    register_heif_opener()
    HEIF_IMPORT_ERROR = None


PROJECT_ROOT = Path(__file__).resolve().parents[1]
API_SRC = PROJECT_ROOT / "apps" / "api" / "src"

if str(API_SRC) not in sys.path:
    sys.path.insert(0, str(API_SRC))

from api.db.models import Ingestion, IngestionError, Photo  # noqa: E402
from api.db.session import IS_SQLITE, SessionLocal, initialize_storage  # noqa: E402


SUPPORTED_EXTENSIONS = {".jpg", ".jpeg", ".heic"}
TIMESTAMP_TAGS = ("DateTimeOriginal", "DateTimeDigitized", "DateTime")


@dataclass(slots=True)
class PhotoMetadata:
    file_path: str
    file_name: str
    timestamp_original: str
    timestamp_normalized: str
    timezone_offset: str | None
    latitude: float | None
    longitude: float | None
    width: int | None
    height: int | None


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(
        description="Scan a local folder for JPEG/HEIC files and ingest EXIF metadata.",
    )
    parser.add_argument("folder", type=Path, nargs="?", help="Root folder to scan recursively.")
    parser.add_argument("--root", type=Path, help="Root folder to scan recursively.")
    args = parser.parse_args()

    if args.root is not None:
        args.folder = args.root

    if args.folder is None:
        parser.error("folder or --root is required")

    return args


def iso_now() -> str:
    return datetime.now(UTC).isoformat(timespec="seconds").replace("+00:00", "Z")


def iter_image_paths(root: Path) -> Iterable[Path]:
    for path in sorted(root.rglob("*")):
        if path.is_file() and path.suffix.lower() in SUPPORTED_EXTENSIONS:
            yield path


def normalize_timestamp(raw_timestamp: str, raw_offset: str | None) -> tuple[str, str | None]:
    timestamp = datetime.strptime(raw_timestamp, "%Y:%m:%d %H:%M:%S")
    offset = raw_offset if raw_offset else None

    if offset:
        normalized = datetime.fromisoformat(
            f"{timestamp.strftime('%Y-%m-%dT%H:%M:%S')}{offset}",
        ).astimezone(UTC)
        return normalized.isoformat(timespec="seconds").replace("+00:00", "Z"), offset

    return timestamp.isoformat(timespec="seconds"), None


def rational_to_float(value: Any) -> float:
    if hasattr(value, "numerator") and hasattr(value, "denominator"):
        return float(value.numerator) / float(value.denominator)
    if isinstance(value, tuple) and len(value) == 2:
        return float(value[0]) / float(value[1])
    return float(value)


def gps_to_decimal(values: Any, reference: str) -> float | None:
    if not values or len(values) != 3:
        return None

    degrees = rational_to_float(values[0])
    minutes = rational_to_float(values[1])
    seconds = rational_to_float(values[2])
    decimal = degrees + (minutes / 60.0) + (seconds / 3600.0)

    if reference in {"S", "W"}:
        decimal *= -1

    return decimal


def extract_metadata(path: Path) -> PhotoMetadata:
    if PIL_IMPORT_ERROR is not None:
        raise RuntimeError(
            "Pillow is required for local ingestion. Install dependencies in apps/api first.",
        ) from PIL_IMPORT_ERROR
    if path.suffix.lower() == ".heic" and HEIF_IMPORT_ERROR is not None:
        raise RuntimeError(
            "HEIC support requires pillow-heif. Reinstall apps/api dependencies first.",
        ) from HEIF_IMPORT_ERROR

    with Image.open(path) as image:
        exif = image.getexif()
        exif_tags = {TAGS.get(tag_id, str(tag_id)): value for tag_id, value in exif.items()}
        timestamp_original = next(
            (
                str(exif_tags.get(tag_name))
                for tag_name in TIMESTAMP_TAGS
                if exif_tags.get(tag_name)
            ),
            None,
        )
        timezone_offset = next(
            (
                str(exif_tags.get(tag_name))
                for tag_name in ("OffsetTimeOriginal", "OffsetTimeDigitized", "OffsetTime")
                if exif_tags.get(tag_name)
            ),
            None,
        )

        if not timestamp_original:
            raise ValueError("Missing EXIF timestamp")

        timestamp_normalized, normalized_offset = normalize_timestamp(
            timestamp_original,
            timezone_offset,
        )

        gps_info = exif.get_ifd(0x8825) if 0x8825 in exif else {}
        gps_tags = {
            GPSTAGS.get(tag_id, str(tag_id)): value for tag_id, value in gps_info.items()
        }

        latitude = gps_to_decimal(
            gps_tags.get("GPSLatitude"),
            str(gps_tags.get("GPSLatitudeRef", "")),
        )
        longitude = gps_to_decimal(
            gps_tags.get("GPSLongitude"),
            str(gps_tags.get("GPSLongitudeRef", "")),
        )

        return PhotoMetadata(
            file_path=str(path.resolve()),
            file_name=path.name,
            timestamp_original=timestamp_original,
            timestamp_normalized=timestamp_normalized,
            timezone_offset=normalized_offset,
            latitude=latitude,
            longitude=longitude,
            width=image.width,
            height=image.height,
        )


def create_ingestion_record(session: Session, root_path: Path) -> str:
    ingestion_id = str(uuid4())
    session.add(
        Ingestion(
            id=ingestion_id,
            root_path=str(root_path.resolve()),
            started_at=iso_now(),
            finished_at=None,
            status="running",
            scanned_count=0,
            imported_count=0,
            skipped_count=0,
            error_count=0,
            notes=None,
        ),
    )
    session.commit()
    return ingestion_id


def upsert_photo(session: Session, photo: PhotoMetadata) -> None:
    photo_id = str(uuid4())
    now = iso_now()
    values = {
        "id": photo_id,
        "source_type": "local",
        "file_path": photo.file_path,
        "file_name": photo.file_name,
        "timestamp_original": photo.timestamp_original,
        "timestamp_normalized": photo.timestamp_normalized,
        "timezone_offset": photo.timezone_offset,
        "latitude": photo.latitude,
        "longitude": photo.longitude,
        "width": photo.width,
        "height": photo.height,
        "thumbnail_path": None,
        "fingerprint": None,
        "created_at": now,
        "updated_at": now,
    }
    update_values = {
        "file_name": photo.file_name,
        "timestamp_original": photo.timestamp_original,
        "timestamp_normalized": photo.timestamp_normalized,
        "timezone_offset": photo.timezone_offset,
        "latitude": photo.latitude,
        "longitude": photo.longitude,
        "width": photo.width,
        "height": photo.height,
        "updated_at": now,
    }

    if IS_SQLITE:
        statement = sqlite_insert(Photo.__table__).values(**values)
        statement = statement.on_conflict_do_update(
            index_elements=[Photo.__table__.c.file_path],
            set_=update_values,
        )
    else:
        statement = mysql_insert(Photo.__table__).values(**values)
        statement = statement.on_duplicate_key_update(**update_values)

    session.execute(statement)


def log_ingestion_error(
    session: Session,
    ingestion_id: str,
    file_path: Path,
    error: Exception,
) -> None:
    session.add(
        IngestionError(
            id=str(uuid4()),
            ingestion_id=ingestion_id,
            file_path=str(file_path.resolve()),
            error_code=error.__class__.__name__,
            error_message=str(error),
            created_at=iso_now(),
        ),
    )


def finalize_ingestion(
    session: Session,
    ingestion_id: str,
    scanned_count: int,
    imported_count: int,
    skipped_count: int,
    error_count: int,
) -> None:
    if scanned_count == 0:
        status = "completed"
        notes = "No supported image files found."
    elif imported_count == 0 and error_count > 0:
        status = "failed"
        notes = "No files were ingested successfully."
    elif error_count > 0:
        status = "completed_with_errors"
        notes = None
    else:
        status = "completed"
        notes = None

    ingestion = session.get(Ingestion, ingestion_id)
    if ingestion is None:
        raise RuntimeError(f"Ingestion record not found: {ingestion_id}")

    ingestion.finished_at = iso_now()
    ingestion.status = status
    ingestion.scanned_count = scanned_count
    ingestion.imported_count = imported_count
    ingestion.skipped_count = skipped_count
    ingestion.error_count = error_count
    ingestion.notes = notes


def run_ingestion(root_path: Path) -> tuple[str, int, int]:
    if PIL_IMPORT_ERROR is not None:
        raise RuntimeError(
            "Pillow is required for local ingestion. Run `pip install -e apps/api` first.",
        ) from PIL_IMPORT_ERROR

    initialize_storage()

    scanned_count = 0
    imported_count = 0
    skipped_count = 0
    error_count = 0

    session = SessionLocal()
    ingestion_id = create_ingestion_record(session, root_path)

    try:
        try:
            for path in iter_image_paths(root_path):
                scanned_count += 1
                try:
                    metadata = extract_metadata(path)
                except Exception as error:  # noqa: BLE001
                    error_count += 1
                    log_ingestion_error(session, ingestion_id, path, error)
                    continue

                try:
                    with session.begin_nested():
                        upsert_photo(session, metadata)
                    imported_count += 1
                except Exception as error:  # noqa: BLE001
                    error_count += 1
                    log_ingestion_error(session, ingestion_id, path, error)

                if scanned_count % 100 == 0:
                    session.commit()

            finalize_ingestion(
                session,
                ingestion_id,
                scanned_count,
                imported_count,
                skipped_count,
                error_count,
            )
            session.commit()
        except Exception:  # noqa: BLE001
            session.rollback()
            finalize_ingestion(
                session,
                ingestion_id,
                scanned_count,
                imported_count,
                skipped_count,
                error_count + 1,
            )
            session.commit()
            raise
    finally:
        session.close()

    return ingestion_id, imported_count, error_count


def main() -> int:
    args = parse_args()
    root_path = args.folder.expanduser()

    if not root_path.exists() or not root_path.is_dir():
        print(f"Folder not found: {root_path}", file=sys.stderr)
        return 1

    ingestion_id, imported_count, error_count = run_ingestion(root_path)
    print(
        f"Ingestion {ingestion_id} completed: imported={imported_count} errors={error_count}",
    )
    return 0 if error_count == 0 else 2


if __name__ == "__main__":
    raise SystemExit(main())
