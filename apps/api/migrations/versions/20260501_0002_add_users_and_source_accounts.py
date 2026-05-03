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
    if op.get_context().as_sql:
        # Offline SQL rendering sees the current 0001 migration, which already includes
        # file_path_hash and no longer creates the long global file_path unique key.
        existing_tables: set[str] = set()
        photos_columns = {"file_path_hash"}
        photos_unique_constraints: set[str] = set()
        photos_indexes: set[str] = set()
        photos_foreign_keys: set[str] = set()
    else:
        bind = op.get_bind()
        inspector = sa.inspect(bind)
        existing_tables = set(inspector.get_table_names())
        photos_columns = {column["name"] for column in inspector.get_columns("photos")}
        photos_unique_constraints = {
            constraint["name"]
            for constraint in inspector.get_unique_constraints("photos")
            if constraint["name"]
        }
        photos_indexes = {
            index["name"] for index in inspector.get_indexes("photos") if index["name"]
        }
        photos_foreign_keys = {
            foreign_key["name"]
            for foreign_key in inspector.get_foreign_keys("photos")
            if foreign_key["name"]
        }

    # Create ownership tables before touching existing photo rows.
    if "users" not in existing_tables:
        op.create_table(
            "users",
            sa.Column("id", sa.String(length=36), primary_key=True),
            sa.Column("email", sa.String(length=255), nullable=True),
            sa.Column("display_name", sa.String(length=255), nullable=True),
            sa.Column("created_at", sa.String(length=64), nullable=False),
            sa.Column("updated_at", sa.String(length=64), nullable=False),
            sa.UniqueConstraint("email", name="uq_users_email"),
        )

    if "source_accounts" not in existing_tables:
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

    # Seed a stable default owner so existing single-user data remains usable.
    now = iso_now()
    op.execute(
        "INSERT IGNORE INTO users (id, email, display_name, created_at, updated_at) "
        f"VALUES ('{DEFAULT_USER_ID}', 'dev@local', 'Development User', '{now}', '{now}')",
    )
    op.execute(
        "INSERT IGNORE INTO source_accounts "
        "(id, user_id, provider, account_label, created_at, updated_at) "
        f"VALUES ('{DEFAULT_SOURCE_ACCOUNT_ID}', '{DEFAULT_USER_ID}', "
        f"'local', 'Local Photos', '{now}', '{now}')",
    )

    # Safe migration sequence for existing rows:
    # 1. Add nullable columns.
    # 2. Backfill all existing photos to the default development owner/source.
    # 3. Backfill file_path_hash from the existing file_path.
    # 4. Only then make the new columns NOT NULL and add foreign keys/indexes.
    if "user_id" not in photos_columns:
        op.add_column("photos", sa.Column("user_id", sa.String(length=36), nullable=True))
    if "source_account_id" not in photos_columns:
        op.add_column("photos", sa.Column("source_account_id", sa.String(length=36), nullable=True))
    if "file_path_hash" not in photos_columns:
        op.add_column("photos", sa.Column("file_path_hash", sa.String(length=64), nullable=True))
    op.execute(
        "UPDATE photos "
        f"SET user_id = '{DEFAULT_USER_ID}', "
        f"source_account_id = '{DEFAULT_SOURCE_ACCOUNT_ID}'",
    )
    op.execute("UPDATE photos SET file_path_hash = SHA2(file_path, 256)")
    op.alter_column("photos", "user_id", existing_type=sa.String(length=36), nullable=False)
    op.alter_column(
        "photos",
        "source_account_id",
        existing_type=sa.String(length=36),
        nullable=False,
    )
    op.alter_column(
        "photos",
        "file_path_hash",
        existing_type=sa.String(length=64),
        nullable=False,
    )
    if "fk_photos_user_id" not in photos_foreign_keys:
        op.create_foreign_key("fk_photos_user_id", "photos", "users", ["user_id"], ["id"])
    if "fk_photos_source_account_id" not in photos_foreign_keys:
        op.create_foreign_key(
            "fk_photos_source_account_id",
            "photos",
            "source_accounts",
            ["source_account_id"],
            ["id"],
        )
    # Replace global file path uniqueness with source-scoped path-hash uniqueness.
    if "uq_photos_file_path" in photos_unique_constraints:
        op.drop_constraint("uq_photos_file_path", "photos", type_="unique")
    if "idx_photos_user_timestamp" not in photos_indexes:
        op.create_index("idx_photos_user_timestamp", "photos", ["user_id", "timestamp_normalized"])
    if "idx_photos_source_account_timestamp" not in photos_indexes:
        op.create_index(
            "idx_photos_source_account_timestamp",
            "photos",
            ["source_account_id", "timestamp_normalized"],
        )
    if "uq_photos_source_account_file_path_hash" not in photos_unique_constraints:
        op.create_unique_constraint(
            "uq_photos_source_account_file_path_hash",
            "photos",
            ["source_account_id", "file_path_hash"],
        )


def downgrade() -> None:
    op.drop_constraint("uq_photos_source_account_file_path_hash", "photos", type_="unique")
    op.drop_index("idx_photos_source_account_timestamp", table_name="photos")
    op.drop_index("idx_photos_user_timestamp", table_name="photos")
    op.create_unique_constraint("uq_photos_file_path", "photos", ["file_path"])
    op.drop_constraint("fk_photos_source_account_id", "photos", type_="foreignkey")
    op.drop_constraint("fk_photos_user_id", "photos", type_="foreignkey")
    op.drop_column("photos", "file_path_hash")
    op.drop_column("photos", "source_account_id")
    op.drop_column("photos", "user_id")
    op.drop_table("source_accounts")
    op.drop_table("users")
