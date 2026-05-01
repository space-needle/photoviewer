from __future__ import annotations

from datetime import UTC, datetime

from sqlalchemy.dialects.mysql import insert as mysql_insert
from sqlalchemy.dialects.sqlite import insert as sqlite_insert
from sqlalchemy.orm import Session

from api.db.models import SourceAccount, User
from api.db.session import IS_SQLITE


DEFAULT_USER_ID = "dev-user"
DEFAULT_SOURCE_ACCOUNT_ID = "dev-local-source"


def iso_now() -> str:
    return datetime.now(UTC).isoformat(timespec="seconds").replace("+00:00", "Z")


def ensure_default_identity(session: Session) -> tuple[str, str]:
    now = iso_now()
    user_values = {
        "id": DEFAULT_USER_ID,
        "email": "dev@local",
        "display_name": "Development User",
        "created_at": now,
        "updated_at": now,
    }
    source_account_values = {
        "id": DEFAULT_SOURCE_ACCOUNT_ID,
        "user_id": DEFAULT_USER_ID,
        "provider": "local",
        "account_label": "Local Photos",
        "created_at": now,
        "updated_at": now,
    }

    if IS_SQLITE:
        user_statement = sqlite_insert(User.__table__).values(**user_values)
        user_statement = user_statement.on_conflict_do_nothing(
            index_elements=[User.__table__.c.id],
        )
        source_statement = sqlite_insert(SourceAccount.__table__).values(**source_account_values)
        source_statement = source_statement.on_conflict_do_nothing(
            index_elements=[SourceAccount.__table__.c.id],
        )
    else:
        user_statement = mysql_insert(User.__table__).values(**user_values)
        user_statement = user_statement.on_duplicate_key_update(id=user_values["id"])
        source_statement = mysql_insert(SourceAccount.__table__).values(**source_account_values)
        source_statement = source_statement.on_duplicate_key_update(
            id=source_account_values["id"],
        )

    session.execute(user_statement)
    session.execute(source_statement)
    return DEFAULT_USER_ID, DEFAULT_SOURCE_ACCOUNT_ID
