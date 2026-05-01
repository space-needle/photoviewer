"""add users and source accounts

Revision ID: 20260501_0002
Revises: 20260501_0001
Create Date: 2026-05-01
"""

from __future__ import annotations

from datetime import UTC, datetime

from alembic import op
import sqlalchemy as sa


revision = "20260501_0002"
down_revision = "20260501_0001"
branch_labels = None
depends_on = None

DEFAULT_USER_ID = "dev-user"
DEFAULT_SOURCE_ACCOUNT_ID = "dev-local-source"


def iso_now() -> str:
    return datetime.now(UTC).isoformat(timespec="seconds").replace("+00:00", "Z")


def upgrade() -> None:
    op.create_table(
        "users",
        sa.Column("id", sa.String(length=36), primary_key=True),
        sa.Column("email", sa.String(length=255), nullable=True),
        sa.Column("display_name", sa.String(length=255), nullable=True),
        sa.Column("created_at", sa.String(length=64), nullable=False),
        sa.Column("updated_at", sa.String(length=64), nullable=False),
        sa.UniqueConstraint("email", name="uq_users_email"),
    )

    op.create_table(
        "source_accounts",
        sa.Column("id", sa.String(length=36), primary_key=True),
        sa.Column("user_id", sa.String(length=36), nullable=False),
        sa.Column("provider", sa.String(length=64), nullable=False),
        sa.Column("account_label", sa.String(length=255), nullable=False),
        sa.Column("created_at", sa.String(length=64), nullable=False),
        sa.Column("updated_at", sa.String(length=64), nullable=False),
        sa.ForeignKeyConstraint(["user_id"], ["users.id"], name="fk_source_accounts_user_id"),
        sa.UniqueConstraint(
            "user_id",
            "provider",
            "account_label",
            name="uq_source_accounts_user_provider_label",
        ),
    )

    now = iso_now()
    op.bulk_insert(
        sa.table(
            "users",
            sa.column("id", sa.String),
            sa.column("email", sa.String),
            sa.column("display_name", sa.String),
            sa.column("created_at", sa.String),
            sa.column("updated_at", sa.String),
        ),
        [
            {
                "id": DEFAULT_USER_ID,
                "email": "dev@local",
                "display_name": "Development User",
                "created_at": now,
                "updated_at": now,
            },
        ],
    )
    op.bulk_insert(
        sa.table(
            "source_accounts",
            sa.column("id", sa.String),
            sa.column("user_id", sa.String),
            sa.column("provider", sa.String),
            sa.column("account_label", sa.String),
            sa.column("created_at", sa.String),
            sa.column("updated_at", sa.String),
        ),
        [
            {
                "id": DEFAULT_SOURCE_ACCOUNT_ID,
                "user_id": DEFAULT_USER_ID,
                "provider": "local",
                "account_label": "Local Photos",
                "created_at": now,
                "updated_at": now,
            },
        ],
    )

    op.add_column("photos", sa.Column("user_id", sa.String(length=36), nullable=True))
    op.add_column("photos", sa.Column("source_account_id", sa.String(length=36), nullable=True))
    op.execute(
        "UPDATE photos "
        f"SET user_id = '{DEFAULT_USER_ID}', "
        f"source_account_id = '{DEFAULT_SOURCE_ACCOUNT_ID}'",
    )
    op.alter_column("photos", "user_id", existing_type=sa.String(length=36), nullable=False)
    op.alter_column(
        "photos",
        "source_account_id",
        existing_type=sa.String(length=36),
        nullable=False,
    )
    op.create_foreign_key("fk_photos_user_id", "photos", "users", ["user_id"], ["id"])
    op.create_foreign_key(
        "fk_photos_source_account_id",
        "photos",
        "source_accounts",
        ["source_account_id"],
        ["id"],
    )
    op.drop_constraint("uq_photos_file_path", "photos", type_="unique")
    op.create_index("idx_photos_user_timestamp", "photos", ["user_id", "timestamp_normalized"])
    op.create_index(
        "idx_photos_source_account_timestamp",
        "photos",
        ["source_account_id", "timestamp_normalized"],
    )
    op.create_index(
        "uq_photos_source_account_file_path",
        "photos",
        ["source_account_id", "file_path"],
        unique=True,
        mysql_length={"file_path": 732},
    )


def downgrade() -> None:
    op.drop_index("uq_photos_source_account_file_path", table_name="photos")
    op.drop_index("idx_photos_source_account_timestamp", table_name="photos")
    op.drop_index("idx_photos_user_timestamp", table_name="photos")
    op.create_unique_constraint("uq_photos_file_path", "photos", ["file_path"])
    op.drop_constraint("fk_photos_source_account_id", "photos", type_="foreignkey")
    op.drop_constraint("fk_photos_user_id", "photos", type_="foreignkey")
    op.drop_column("photos", "source_account_id")
    op.drop_column("photos", "user_id")
    op.drop_table("source_accounts")
    op.drop_table("users")
