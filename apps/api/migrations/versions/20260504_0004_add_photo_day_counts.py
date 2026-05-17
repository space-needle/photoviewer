"""add photo day counts

Revision ID: 20260504_0004
Revises: 20260503_0003
Create Date: 2026-05-04
"""

from __future__ import annotations

from alembic import op
import sqlalchemy as sa


revision = "20260504_0004"
down_revision = "20260503_0003"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.create_table(
        "photo_day_counts",
        sa.Column("id", sa.String(length=36), primary_key=True),
        sa.Column("user_id", sa.String(length=36), nullable=False),
        sa.Column("source_account_id", sa.String(length=36), nullable=True),
        sa.Column("day", sa.String(length=10), nullable=False),
        sa.Column("photo_count", sa.Integer(), nullable=False),
        sa.Column("gps_photo_count", sa.Integer(), nullable=False),
        sa.Column("created_at", sa.String(length=64), nullable=False),
        sa.Column("updated_at", sa.String(length=64), nullable=False),
        sa.ForeignKeyConstraint(["user_id"], ["users.id"], name="fk_photo_day_counts_user_id"),
        sa.ForeignKeyConstraint(
            ["source_account_id"],
            ["source_accounts.id"],
            name="fk_photo_day_counts_source_account_id",
        ),
        sa.UniqueConstraint(
            "user_id",
            "source_account_id",
            "day",
            name="uq_photo_day_counts_user_source_day",
        ),
    )
    op.create_index("idx_photo_day_counts_user_day", "photo_day_counts", ["user_id", "day"])


def downgrade() -> None:
    op.drop_index("idx_photo_day_counts_user_day", table_name="photo_day_counts")
    op.drop_table("photo_day_counts")
