from __future__ import annotations

import argparse
import hashlib
import os
import random
import sys
import time
from dataclasses import dataclass
from datetime import UTC, datetime
from pathlib import Path
from typing import Any
from uuid import uuid4

import msal
import requests
from sqlalchemy import select, text
from sqlalchemy.dialects.mysql import insert as mysql_insert
from sqlalchemy.dialects.sqlite import insert as sqlite_insert
from sqlalchemy.orm import Session


PROJECT_ROOT = Path(__file__).resolve().parents[1]
API_SRC = PROJECT_ROOT / "apps" / "api" / "src"

if str(API_SRC) not in sys.path:
    sys.path.insert(0, str(API_SRC))

from api.db.defaults import DEFAULT_USER_ID, ensure_default_identity  # noqa: E402
from api.db.models import Photo, SourceAccount  # noqa: E402
from api.db.session import IS_SQLITE, SessionLocal, engine, initialize_storage  # noqa: E402


GRAPH_BASE_URL = "https://graph.microsoft.com/v1.0"
IMAGE_EXTENSIONS = {".jpg", ".jpeg", ".heic", ".png"}
RETRYABLE_STATUS_CODES = {429, 503, 504}
NON_RETRYABLE_STATUS_CODES = {400, 401, 403, 404}
MAX_GRAPH_RETRIES = 5
PAGE_PACING_SECONDS = 0.3


@dataclass(slots=True)
class SyncSummary:
    scanned: int = 0
    images: int = 0
    inserted: int = 0
    updated: int = 0
    deleted_marked: int = 0
    skipped: int = 0
    delta_saved: bool = False


def iso_now() -> str:
    return datetime.now(UTC).isoformat(timespec="seconds").replace("+00:00", "Z")


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(description="Authenticate and sync OneDrive photo metadata.")
    subparsers = parser.add_subparsers(dest="command", required=True)
    subparsers.add_parser("auth", help="Run Microsoft device code authentication.")
    subparsers.add_parser("sync", help="Sync OneDrive image metadata with Graph delta.")
    return parser.parse_args()


def get_scopes() -> list[str]:
    raw_scopes = os.environ.get("ONEDRIVE_SCOPES", "Files.Read offline_access User.Read")
    return [scope for scope in raw_scopes.split() if scope]


def get_client_id() -> str:
    client_id = os.environ.get("MS_CLIENT_ID")
    if not client_id:
        raise RuntimeError("MS_CLIENT_ID is required for OneDrive auth.")
    return client_id


def get_authority() -> str:
    tenant_id = os.environ.get("MS_TENANT_ID", "common")
    return f"https://login.microsoftonline.com/{tenant_id}"


def get_token_cache_path() -> Path:
    data_dir = Path(os.environ.get("PHOTOVIEWER_DATA_DIR", "/data"))
    return data_dir / "msal_token_cache.bin"


def load_token_cache() -> msal.SerializableTokenCache:
    cache = msal.SerializableTokenCache()
    cache_path = get_token_cache_path()
    if cache_path.exists():
        cache.deserialize(cache_path.read_text())
    return cache


def save_token_cache(cache: msal.SerializableTokenCache) -> None:
    if not cache.has_state_changed:
        return

    cache_path = get_token_cache_path()
    cache_path.parent.mkdir(parents=True, exist_ok=True)
    cache_path.write_text(cache.serialize())


def build_public_client(cache: msal.SerializableTokenCache) -> msal.PublicClientApplication:
    return msal.PublicClientApplication(
        client_id=get_client_id(),
        authority=get_authority(),
        token_cache=cache,
    )


def auth() -> None:
    cache = load_token_cache()
    app = build_public_client(cache)
    flow = app.initiate_device_flow(scopes=get_scopes())
    if "user_code" not in flow:
        raise RuntimeError(f"Failed to create device flow: {flow}")

    print(flow.get("message", ""))
    print(f"Verification URL: {flow.get('verification_uri')}")
    print(f"User code: {flow.get('user_code')}")
    result = app.acquire_token_by_device_flow(flow)
    if "access_token" not in result:
        raise RuntimeError(f"Authentication failed: {result}")

    save_token_cache(cache)
    print(f"Authentication complete. Token cache saved to {get_token_cache_path()}.")


def acquire_access_token() -> str:
    cache = load_token_cache()
    app = build_public_client(cache)
    accounts = app.get_accounts()
    if not accounts:
        raise RuntimeError("No cached Microsoft account found. Run `sync_onedrive.py auth` first.")

    result = app.acquire_token_silent(get_scopes(), account=accounts[0])
    if not result or "access_token" not in result:
        raise RuntimeError("Could not acquire cached token. Run `sync_onedrive.py auth` again.")

    save_token_cache(cache)
    return str(result["access_token"])


def retry_delay_seconds(response: requests.Response | None, attempt: int) -> float:
    if response is not None:
        retry_after = response.headers.get("Retry-After")
        if retry_after:
            try:
                return max(0.0, float(retry_after))
            except ValueError:
                pass

    base_delay = min(60.0, 2.0 ** attempt)
    return base_delay + random.uniform(0.0, min(1.0, base_delay * 0.25))


def graph_get(session: requests.Session, url: str, max_retries: int = MAX_GRAPH_RETRIES) -> dict[str, Any]:
    last_error: str | None = None

    for attempt in range(max_retries + 1):
        response: requests.Response | None = None
        try:
            response = session.get(url, timeout=60)
        except requests.RequestException as error:
            last_error = str(error)
            if attempt >= max_retries:
                break

            delay = retry_delay_seconds(None, attempt)
            print(f"Graph network error; retrying in {delay:.1f} seconds: {error}")
            time.sleep(delay)
            continue

        if response.status_code < 400:
            data = response.json()
            if not isinstance(data, dict):
                raise RuntimeError(f"Unexpected Graph response: {data}")
            return data

        if response.status_code in NON_RETRYABLE_STATUS_CODES:
            raise RuntimeError(f"Graph request failed {response.status_code}: {response.text}")

        if response.status_code not in RETRYABLE_STATUS_CODES:
            raise RuntimeError(f"Graph request failed {response.status_code}: {response.text}")

        last_error = f"{response.status_code}: {response.text}"
        if attempt >= max_retries:
            break

        delay = retry_delay_seconds(response, attempt)
        log_prefix = "Rate limited" if response.status_code == 429 else "Graph transient error"
        print(f"{log_prefix}; retrying in {delay:.1f} seconds")
        time.sleep(delay)

    raise RuntimeError(f"Graph request failed after {max_retries} retries: {last_error}")


def is_image_item(item: dict[str, Any]) -> bool:
    if "file" not in item:
        return False

    mime_type = str(item.get("file", {}).get("mimeType", ""))
    if mime_type.startswith("image/"):
        return True

    name = str(item.get("name", ""))
    return Path(name).suffix.lower() in IMAGE_EXTENSIONS


def hash_value(value: str) -> str:
    return hashlib.sha256(value.encode("utf-8")).hexdigest()


def normalize_graph_timestamp(value: str | None) -> str | None:
    if not value:
        return None
    parsed = datetime.fromisoformat(value.replace("Z", "+00:00"))
    if parsed.tzinfo is not None:
        return parsed.astimezone(UTC).isoformat(timespec="seconds").replace("+00:00", "Z")
    return parsed.isoformat(timespec="seconds")


def get_item_path(item: dict[str, Any]) -> str:
    parent_reference = item.get("parentReference") or {}
    parent_path = str(parent_reference.get("path") or "")
    name = str(item.get("name") or item.get("id") or "unknown")
    if parent_path:
        normalized_parent = parent_path.replace("/drive/root:", "")
        return f"onedrive:{normalized_parent}/{name}"
    return str(item.get("webUrl") or item.get("id") or name)


def get_dimension(item: dict[str, Any], key: str) -> int | None:
    image = item.get("image") or {}
    value = image.get(key)
    return int(value) if value is not None else None


def get_location(item: dict[str, Any]) -> tuple[float | None, float | None]:
    location = item.get("location") or item.get("photo", {}).get("location") or {}
    latitude = location.get("latitude")
    longitude = location.get("longitude")
    return (
        float(latitude) if latitude is not None else None,
        float(longitude) if longitude is not None else None,
    )


def ensure_onedrive_source_account(
    db: Session,
    provider_user_id: str,
    display_name: str,
) -> SourceAccount:
    ensure_default_identity(db)
    existing = db.execute(
        select(SourceAccount).where(
            SourceAccount.user_id == DEFAULT_USER_ID,
            SourceAccount.provider == "onedrive",
            SourceAccount.provider_user_id == provider_user_id,
        )
    ).scalar_one_or_none()
    now = iso_now()
    account_label = f"OneDrive: {provider_user_id}"
    if existing:
        existing.account_label = account_label
        existing.display_name = display_name
        existing.updated_at = now
        db.commit()
        return existing

    source_account = SourceAccount(
        id=str(uuid4()),
        user_id=DEFAULT_USER_ID,
        provider="onedrive",
        provider_user_id=provider_user_id,
        account_label=account_label,
        display_name=display_name,
        sync_cursor=None,
        created_at=now,
        updated_at=now,
    )
    db.add(source_account)
    db.commit()
    return source_account


def get_graph_user(graph_session: requests.Session) -> tuple[str, str]:
    me = graph_get(graph_session, f"{GRAPH_BASE_URL}/me")
    provider_user_id = str(me.get("id") or me.get("mail") or me.get("userPrincipalName"))
    if not provider_user_id:
        raise RuntimeError("Could not determine Microsoft user id from /me.")
    display_name = str(
        me.get("displayName")
        or me.get("mail")
        or me.get("userPrincipalName")
        or provider_user_id
    )
    return provider_user_id, display_name


def mark_deleted(db: Session, source_account_id: str, provider_photo_id: str) -> bool:
    now = iso_now()
    result = db.execute(
        text(
            """
            UPDATE photos
            SET deleted_at = :deleted_at, updated_at = :updated_at
            WHERE source_account_id = :source_account_id
              AND provider_photo_id = :provider_photo_id
              AND deleted_at IS NULL
            """
        ),
        {
            "deleted_at": now,
            "updated_at": now,
            "source_account_id": source_account_id,
            "provider_photo_id": provider_photo_id,
        },
    )
    return result.rowcount > 0


def upsert_photo(db: Session, source_account: SourceAccount, item: dict[str, Any]) -> str:
    now = iso_now()
    provider_photo_id = str(item.get("id") or "")
    if not provider_photo_id:
        raise RuntimeError(f"Drive item is missing id: {item}")

    file_path = get_item_path(item)
    parent_reference = item.get("parentReference") or {}
    timestamp = normalize_graph_timestamp(
        item.get("photo", {}).get("takenDateTime") or item.get("createdDateTime"),
    )
    if not timestamp:
        raise RuntimeError(f"Drive item is missing usable timestamp: {item}")

    latitude, longitude = get_location(item)
    values = {
        "id": str(uuid4()),
        "user_id": DEFAULT_USER_ID,
        "source_account_id": source_account.id,
        "source_type": "onedrive",
        "provider_photo_id": provider_photo_id,
        "provider_drive_id": parent_reference.get("driveId"),
        "provider_web_url": item.get("webUrl"),
        "file_path": file_path,
        "file_path_hash": hash_value(file_path),
        "file_name": str(item.get("name") or provider_photo_id),
        "timestamp_original": timestamp,
        "timestamp_normalized": timestamp,
        "timezone_offset": None,
        "latitude": latitude,
        "longitude": longitude,
        "width": get_dimension(item, "width"),
        "height": get_dimension(item, "height"),
        "thumbnail_path": None,
        "fingerprint": None,
        "deleted_at": None,
        "created_at": now,
        "updated_at": now,
    }
    update_values = {
        key: values[key]
        for key in (
            "provider_drive_id",
            "provider_web_url",
            "file_path",
            "file_path_hash",
            "file_name",
            "timestamp_original",
            "timestamp_normalized",
            "latitude",
            "longitude",
            "width",
            "height",
            "deleted_at",
            "updated_at",
        )
    }

    existing = db.execute(
        text(
            """
            SELECT id
            FROM photos
            WHERE source_account_id = :source_account_id
              AND (
                provider_photo_id = :provider_photo_id
                OR file_path_hash = :file_path_hash
              )
            LIMIT 1
            """
        ),
        {
            "source_account_id": source_account.id,
            "provider_photo_id": provider_photo_id,
            "file_path_hash": values["file_path_hash"],
        },
    ).first()

    if IS_SQLITE:
        statement = sqlite_insert(Photo.__table__).values(**values)
        statement = statement.on_conflict_do_update(
            index_elements=[
                Photo.__table__.c.source_account_id,
                Photo.__table__.c.provider_photo_id,
            ],
            set_=update_values,
        )
    else:
        statement = mysql_insert(Photo.__table__).values(**values)
        statement = statement.on_duplicate_key_update(**update_values)

    db.execute(statement)
    return "updated" if existing else "inserted"


def sync() -> None:
    initialize_storage()
    access_token = acquire_access_token()
    graph_session = requests.Session()
    graph_session.headers.update({"Authorization": f"Bearer {access_token}"})
    provider_user_id, display_name = get_graph_user(graph_session)

    db = SessionLocal()
    try:
        source_account = ensure_onedrive_source_account(db, provider_user_id, display_name)
        next_url = source_account.sync_cursor or f"{GRAPH_BASE_URL}/me/drive/root/delta"
        summary = SyncSummary()
        delta_link: str | None = None

        while next_url:
            payload = graph_get(graph_session, next_url)
            for item in payload.get("value", []):
                summary.scanned += 1
                if not isinstance(item, dict):
                    summary.skipped += 1
                    continue

                provider_photo_id = str(item.get("id") or "")
                if item.get("deleted"):
                    if provider_photo_id and mark_deleted(db, source_account.id, provider_photo_id):
                        summary.deleted_marked += 1
                    else:
                        summary.skipped += 1
                    continue

                if not is_image_item(item):
                    summary.skipped += 1
                    continue

                summary.images += 1
                result = upsert_photo(db, source_account, item)
                if result == "inserted":
                    summary.inserted += 1
                else:
                    summary.updated += 1

            db.commit()
            next_url = payload.get("@odata.nextLink")
            delta_link = payload.get("@odata.deltaLink") or delta_link
            if next_url:
                time.sleep(PAGE_PACING_SECONDS)

        if delta_link:
            source_account.sync_cursor = delta_link
            source_account.updated_at = iso_now()
            db.commit()
            summary.delta_saved = True

        print(
            "OneDrive sync complete: "
            f"scanned={summary.scanned} images={summary.images} "
            f"inserted={summary.inserted} updated={summary.updated} "
            f"deleted_marked={summary.deleted_marked} skipped={summary.skipped} "
            f"deltaLink_saved={'yes' if summary.delta_saved else 'no'}"
        )
    except Exception:
        db.rollback()
        raise
    finally:
        db.close()


def main() -> int:
    args = parse_args()
    if args.command == "auth":
        auth()
    elif args.command == "sync":
        sync()
    else:
        raise RuntimeError(f"Unknown command: {args.command}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
