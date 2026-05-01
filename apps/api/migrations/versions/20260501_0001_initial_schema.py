"""initial schema

Revision ID: 20260501_0001
Revises:
Create Date: 2026-05-01
"""

from __future__ import annotations

from alembic import op
import sqlalchemy as sa


revision = "20260501_0001"
down_revision = None
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.create_table(
        "photos",
        sa.Column("id", sa.String(length=36), primary_key=True),
        sa.Column("source_type", sa.String(length=32), nullable=False),
        sa.Column("file_path", sa.String(length=768), nullable=False),
        sa.Column("file_name", sa.String(length=255), nullable=False),
        sa.Column("timestamp_original", sa.String(length=64), nullable=True),
        sa.Column("timestamp_normalized", sa.String(length=64), nullable=False),
        sa.Column("timezone_offset", sa.String(length=16), nullable=True),
        sa.Column("latitude", sa.Float(), nullable=True),
        sa.Column("longitude", sa.Float(), nullable=True),
        sa.Column("width", sa.Integer(), nullable=True),
        sa.Column("height", sa.Integer(), nullable=True),
        sa.Column("thumbnail_path", sa.String(length=768), nullable=True),
        sa.Column("fingerprint", sa.String(length=128), nullable=True),
        sa.Column("created_at", sa.String(length=64), nullable=False),
        sa.Column("updated_at", sa.String(length=64), nullable=False),
        sa.UniqueConstraint("file_path", name="uq_photos_file_path"),
    )
    op.create_index("idx_photos_timestamp", "photos", ["timestamp_normalized"])
    op.create_index("idx_photos_lat_lon", "photos", ["latitude", "longitude"])
    op.create_index("idx_photos_fingerprint", "photos", ["fingerprint"])

    op.create_table(
        "ingestions",
        sa.Column("id", sa.String(length=36), primary_key=True),
        sa.Column("root_path", sa.String(length=768), nullable=False),
        sa.Column("started_at", sa.String(length=64), nullable=False),
        sa.Column("finished_at", sa.String(length=64), nullable=True),
        sa.Column("status", sa.String(length=64), nullable=False),
        sa.Column("scanned_count", sa.Integer(), nullable=False, server_default="0"),
        sa.Column("imported_count", sa.Integer(), nullable=False, server_default="0"),
        sa.Column("skipped_count", sa.Integer(), nullable=False, server_default="0"),
        sa.Column("error_count", sa.Integer(), nullable=False, server_default="0"),
        sa.Column("notes", sa.Text(), nullable=True),
    )

    op.create_table(
        "ingestion_errors",
        sa.Column("id", sa.String(length=36), primary_key=True),
        sa.Column("ingestion_id", sa.String(length=36), nullable=False),
        sa.Column("file_path", sa.String(length=768), nullable=False),
        sa.Column("error_code", sa.String(length=128), nullable=False),
        sa.Column("error_message", sa.Text(), nullable=False),
        sa.Column("created_at", sa.String(length=64), nullable=False),
        sa.ForeignKeyConstraint(
            ["ingestion_id"],
            ["ingestions.id"],
            name="fk_ingestion_errors_ingestion_id",
        ),
    )

    op.create_table(
        "visits",
        sa.Column("id", sa.String(length=36), primary_key=True),
        sa.Column("title", sa.Text(), nullable=True),
        sa.Column("start_time", sa.String(length=64), nullable=False),
        sa.Column("end_time", sa.String(length=64), nullable=False),
        sa.Column("center_lat", sa.Float(), nullable=True),
        sa.Column("center_lon", sa.Float(), nullable=True),
        sa.Column("photo_count", sa.Integer(), nullable=False),
        sa.Column("location_label", sa.Text(), nullable=True),
        sa.Column("created_at", sa.String(length=64), nullable=False),
        sa.Column("updated_at", sa.String(length=64), nullable=False),
    )
    op.create_index("idx_visits_start_end", "visits", ["start_time", "end_time"])

    op.create_table(
        "photo_visits",
        sa.Column("photo_id", sa.String(length=36), nullable=False),
        sa.Column("visit_id", sa.String(length=36), nullable=False),
        sa.ForeignKeyConstraint(["photo_id"], ["photos.id"], name="fk_photo_visits_photo_id"),
        sa.ForeignKeyConstraint(["visit_id"], ["visits.id"], name="fk_photo_visits_visit_id"),
        sa.PrimaryKeyConstraint("photo_id", "visit_id", name="pk_photo_visits"),
    )


def downgrade() -> None:
    op.drop_table("photo_visits")
    op.drop_index("idx_visits_start_end", table_name="visits")
    op.drop_table("visits")
    op.drop_table("ingestion_errors")
    op.drop_table("ingestions")
    op.drop_index("idx_photos_fingerprint", table_name="photos")
    op.drop_index("idx_photos_lat_lon", table_name="photos")
    op.drop_index("idx_photos_timestamp", table_name="photos")
    op.drop_table("photos")
