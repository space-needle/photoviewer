from __future__ import annotations

import sqlite3
import os
from pathlib import Path


PROJECT_ROOT = Path(__file__).resolve().parents[5]
DATA_DIR = Path(os.environ.get("PHOTOVIEWER_DATA_DIR", PROJECT_ROOT / "data"))
DATABASE_PATH = DATA_DIR / "photoviewer.db"
THUMBNAILS_DIR = Path(
    os.environ.get("PHOTOVIEWER_THUMBNAILS_DIR", DATA_DIR / "thumbnails"),
)

SCHEMA_STATEMENTS = (
    """
    CREATE TABLE IF NOT EXISTS photos (
      id TEXT PRIMARY KEY,
      source_type TEXT NOT NULL,
      file_path TEXT NOT NULL UNIQUE,
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
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );
    """,
    "CREATE INDEX IF NOT EXISTS idx_photos_timestamp ON photos(timestamp_normalized);",
    "CREATE INDEX IF NOT EXISTS idx_photos_lat_lon ON photos(latitude, longitude);",
    "CREATE INDEX IF NOT EXISTS idx_photos_fingerprint ON photos(fingerprint);",
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
