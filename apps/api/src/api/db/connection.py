from __future__ import annotations

import sqlite3
import os
import hashlib
from pathlib import Path


PROJECT_ROOT = Path(__file__).resolve().parents[5]
DATA_DIR = Path(os.environ.get("PHOTOVIEWER_DATA_DIR", PROJECT_ROOT / "data"))
DATABASE_PATH = DATA_DIR / "photoviewer.db"
THUMBNAILS_DIR = Path(
    os.environ.get("PHOTOVIEWER_THUMBNAILS_DIR", DATA_DIR / "thumbnails"),
)
DEFAULT_USER_ID = "dev-user"
DEFAULT_SOURCE_ACCOUNT_ID = "dev-local-source"

SCHEMA_STATEMENTS = (
    """
    CREATE TABLE IF NOT EXISTS users (
      id TEXT PRIMARY KEY,
      email TEXT UNIQUE,
      display_name TEXT,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );
    """,
    """
    CREATE TABLE IF NOT EXISTS source_accounts (
      id TEXT PRIMARY KEY,
      user_id TEXT NOT NULL,
      provider TEXT NOT NULL,
      provider_user_id TEXT,
      account_label TEXT NOT NULL,
      display_name TEXT,
      sync_cursor TEXT,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL,
      UNIQUE(user_id, provider, account_label),
      FOREIGN KEY (user_id) REFERENCES users(id)
    );
    """,
    """
    CREATE TABLE IF NOT EXISTS photos (
      id TEXT PRIMARY KEY,
      user_id TEXT NOT NULL,
      source_account_id TEXT NOT NULL,
      source_type TEXT NOT NULL,
      provider_photo_id TEXT,
      provider_drive_id TEXT,
      provider_web_url TEXT,
      file_path TEXT NOT NULL,
      file_path_hash TEXT NOT NULL,
      file_name TEXT NOT NULL,
      timestamp_original TEXT,
      timestamp_normalized TEXT NOT NULL,
      timezone_offset TEXT,
      latitude REAL,
      longitude REAL,
      width INTEGER,
      height INTEGER,
      thumbnail_path TEXT,
      fingerprint TEXT,
      deleted_at TEXT,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL,
      UNIQUE(source_account_id, file_path_hash),
      FOREIGN KEY (user_id) REFERENCES users(id),
      FOREIGN KEY (source_account_id) REFERENCES source_accounts(id)
    );
    """,
    "CREATE INDEX IF NOT EXISTS idx_photos_user_timestamp ON photos(user_id, timestamp_normalized);",
    "CREATE INDEX IF NOT EXISTS idx_photos_source_account_timestamp ON photos(source_account_id, timestamp_normalized);",
    "CREATE UNIQUE INDEX IF NOT EXISTS uq_photos_source_account_provider_photo_id ON photos(source_account_id, provider_photo_id);",
    "CREATE INDEX IF NOT EXISTS idx_photos_timestamp ON photos(timestamp_normalized);",
    "CREATE INDEX IF NOT EXISTS idx_photos_lat_lon ON photos(latitude, longitude);",
    "CREATE INDEX IF NOT EXISTS idx_photos_fingerprint ON photos(fingerprint);",
    """
    CREATE TABLE IF NOT EXISTS photo_day_counts (
      id TEXT PRIMARY KEY,
      user_id TEXT NOT NULL,
      source_account_id TEXT,
      day TEXT NOT NULL,
      photo_count INTEGER NOT NULL,
      gps_photo_count INTEGER NOT NULL,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL,
      UNIQUE(user_id, source_account_id, day),
      FOREIGN KEY (user_id) REFERENCES users(id),
      FOREIGN KEY (source_account_id) REFERENCES source_accounts(id)
    );
    """,
    "CREATE INDEX IF NOT EXISTS idx_photo_day_counts_user_day ON photo_day_counts(user_id, day);",
    """
    CREATE TABLE IF NOT EXISTS ingestions (
      id TEXT PRIMARY KEY,
      root_path TEXT NOT NULL,
      started_at TEXT NOT NULL,
      finished_at TEXT,
      status TEXT NOT NULL,
      scanned_count INTEGER NOT NULL DEFAULT 0,
      imported_count INTEGER NOT NULL DEFAULT 0,
      skipped_count INTEGER NOT NULL DEFAULT 0,
      error_count INTEGER NOT NULL DEFAULT 0,
      notes TEXT
    );
    """,
    """
    CREATE TABLE IF NOT EXISTS ingestion_errors (
      id TEXT PRIMARY KEY,
      ingestion_id TEXT NOT NULL,
      file_path TEXT NOT NULL,
      error_code TEXT NOT NULL,
      error_message TEXT NOT NULL,
      created_at TEXT NOT NULL,
      FOREIGN KEY (ingestion_id) REFERENCES ingestions(id)
    );
    """,
    """
    CREATE TABLE IF NOT EXISTS visits (
      id TEXT PRIMARY KEY,
      title TEXT,
      start_time TEXT NOT NULL,
      end_time TEXT NOT NULL,
      center_lat REAL,
      center_lon REAL,
      photo_count INTEGER NOT NULL,
      location_label TEXT,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );
    """,
    "CREATE INDEX IF NOT EXISTS idx_visits_start_end ON visits(start_time, end_time);",
    """
    CREATE TABLE IF NOT EXISTS photo_visits (
      photo_id TEXT NOT NULL,
      visit_id TEXT NOT NULL,
      PRIMARY KEY (photo_id, visit_id),
      FOREIGN KEY (photo_id) REFERENCES photos(id),
      FOREIGN KEY (visit_id) REFERENCES visits(id)
    );
    """,
)


def iso_now() -> str:
    from datetime import UTC, datetime

    return datetime.now(UTC).isoformat(timespec="seconds").replace("+00:00", "Z")


def get_connection() -> sqlite3.Connection:
    DATA_DIR.mkdir(parents=True, exist_ok=True)
    THUMBNAILS_DIR.mkdir(parents=True, exist_ok=True)

    connection = sqlite3.connect(DATABASE_PATH)
    connection.row_factory = sqlite3.Row
    connection.execute("PRAGMA foreign_keys = ON;")
    return connection


def initialize_database() -> None:
    if os.environ.get("DATABASE_URL"):
        THUMBNAILS_DIR.mkdir(parents=True, exist_ok=True)
        return

    with get_connection() as connection:
        for statement in SCHEMA_STATEMENTS:
            connection.execute(statement)
        ensure_sqlite_source_account_columns(connection)
        ensure_sqlite_identity(connection)
        ensure_sqlite_photo_owner_columns(connection)


def ensure_sqlite_identity(connection: sqlite3.Connection) -> None:
    now = iso_now()
    connection.execute(
        """
        INSERT OR IGNORE INTO users (id, email, display_name, created_at, updated_at)
        VALUES (?, ?, ?, ?, ?)
        """,
        (DEFAULT_USER_ID, "dev@local", "Development User", now, now),
    )
    connection.execute(
        """
        INSERT OR IGNORE INTO source_accounts (
          id,
          user_id,
          provider,
          provider_user_id,
          account_label,
          display_name,
          sync_cursor,
          created_at,
          updated_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
        """,
        (
            DEFAULT_SOURCE_ACCOUNT_ID,
            DEFAULT_USER_ID,
            "local",
            None,
            "Local Photos",
            "Local Photos",
            None,
            now,
            now,
        ),
    )


def ensure_sqlite_photo_owner_columns(connection: sqlite3.Connection) -> None:
    columns = {
        str(row["name"])
        for row in connection.execute("PRAGMA table_info(photos)").fetchall()
    }
    if "user_id" not in columns:
        connection.execute("ALTER TABLE photos ADD COLUMN user_id TEXT")
        connection.execute("UPDATE photos SET user_id = ?", (DEFAULT_USER_ID,))
    if "source_account_id" not in columns:
        connection.execute("ALTER TABLE photos ADD COLUMN source_account_id TEXT")
        connection.execute(
            "UPDATE photos SET source_account_id = ?",
            (DEFAULT_SOURCE_ACCOUNT_ID,),
        )
    if "file_path_hash" not in columns:
        connection.execute("ALTER TABLE photos ADD COLUMN file_path_hash TEXT")
        rows = connection.execute("SELECT id, file_path FROM photos").fetchall()
        for row in rows:
            connection.execute(
                "UPDATE photos SET file_path_hash = ? WHERE id = ?",
                (hashlib.sha256(str(row["file_path"]).encode("utf-8")).hexdigest(), row["id"]),
            )
    for column_name in (
        "provider_photo_id",
        "provider_drive_id",
        "provider_web_url",
        "deleted_at",
    ):
        if column_name not in columns:
            connection.execute(f"ALTER TABLE photos ADD COLUMN {column_name} TEXT")
    connection.execute(
        """
        CREATE UNIQUE INDEX IF NOT EXISTS uq_photos_source_account_file_path_hash
        ON photos(source_account_id, file_path_hash)
        """,
    )
    connection.execute(
        """
        CREATE UNIQUE INDEX IF NOT EXISTS uq_photos_source_account_provider_photo_id
        ON photos(source_account_id, provider_photo_id)
        """,
    )


def ensure_sqlite_source_account_columns(connection: sqlite3.Connection) -> None:
    columns = {
        str(row["name"])
        for row in connection.execute("PRAGMA table_info(source_accounts)").fetchall()
    }
    for column_name in ("provider_user_id", "display_name", "sync_cursor"):
        if column_name not in columns:
            connection.execute(f"ALTER TABLE source_accounts ADD COLUMN {column_name} TEXT")
