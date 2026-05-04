"""add provider sync metadata

Revision ID: 20260503_0003
Revises: 20260501_0002
Create Date: 2026-05-03
"""

from __future__ import annotations

from alembic import op
import sqlalchemy as sa


revision = "20260503_0003"
down_revision = "20260501_0002"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.add_column("source_accounts", sa.Column("provider_user_id", sa.String(length=255), nullable=True))
    op.add_column("source_accounts", sa.Column("display_name", sa.String(length=255), nullable=True))
    op.add_column("source_accounts", sa.Column("sync_cursor", sa.Text(), nullable=True))

    op.add_column("photos", sa.Column("provider_photo_id", sa.String(length=255), nullable=True))
    op.add_column("photos", sa.Column("provider_drive_id", sa.String(length=255), nullable=True))
    op.add_column("photos", sa.Column("provider_web_url", sa.String(length=768), nullable=True))
    op.add_column("photos", sa.Column("deleted_at", sa.String(length=64), nullable=True))
    op.create_unique_constraint(
        "uq_photos_source_account_provider_photo_id",
        "photos",
        ["source_account_id", "provider_photo_id"],
    )
    op.create_index("idx_photos_deleted_at", "photos", ["deleted_at"])


def downgrade() -> None:
    op.drop_index("idx_photos_deleted_at", table_name="photos")
    op.drop_constraint("uq_photos_source_account_provider_photo_id", "photos", type_="unique")
    op.drop_column("photos", "deleted_at")
    op.drop_column("photos", "provider_web_url")
    op.drop_column("photos", "provider_drive_id")
    op.drop_column("photos", "provider_photo_id")
    op.drop_column("source_accounts", "sync_cursor")
    op.drop_column("source_accounts", "display_name")
    op.drop_column("source_accounts", "provider_user_id")
