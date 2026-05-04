from __future__ import annotations

from sqlalchemy import Float, ForeignKey, Integer, String, Text, UniqueConstraint
from sqlalchemy.orm import DeclarativeBase, Mapped, mapped_column


class Base(DeclarativeBase):
    pass


class User(Base):
    __tablename__ = "users"

    id: Mapped[str] = mapped_column(String(36), primary_key=True)
    email: Mapped[str | None] = mapped_column(String(255), unique=True)
    display_name: Mapped[str | None] = mapped_column(String(255))
    created_at: Mapped[str] = mapped_column(String(64), nullable=False)
    updated_at: Mapped[str] = mapped_column(String(64), nullable=False)


class SourceAccount(Base):
    __tablename__ = "source_accounts"
    __table_args__ = (
        UniqueConstraint(
            "user_id",
            "provider",
            "account_label",
            name="uq_source_accounts_user_provider_label",
        ),
    )

    id: Mapped[str] = mapped_column(String(36), primary_key=True)
    user_id: Mapped[str] = mapped_column(ForeignKey("users.id"), nullable=False)
    provider: Mapped[str] = mapped_column(String(64), nullable=False)
    provider_user_id: Mapped[str | None] = mapped_column(String(255))
    account_label: Mapped[str] = mapped_column(String(255), nullable=False)
    display_name: Mapped[str | None] = mapped_column(String(255))
    sync_cursor: Mapped[str | None] = mapped_column(Text)
    created_at: Mapped[str] = mapped_column(String(64), nullable=False)
    updated_at: Mapped[str] = mapped_column(String(64), nullable=False)


class Photo(Base):
    __tablename__ = "photos"
    __table_args__ = (
        UniqueConstraint(
            "source_account_id",
            "file_path_hash",
            name="uq_photos_source_account_file_path_hash",
        ),
    )

    id: Mapped[str] = mapped_column(String(36), primary_key=True)
    user_id: Mapped[str] = mapped_column(ForeignKey("users.id"), nullable=False)
    source_account_id: Mapped[str] = mapped_column(ForeignKey("source_accounts.id"), nullable=False)
    source_type: Mapped[str] = mapped_column(String(32), nullable=False)
    provider_photo_id: Mapped[str | None] = mapped_column(String(255))
    provider_drive_id: Mapped[str | None] = mapped_column(String(255))
    provider_web_url: Mapped[str | None] = mapped_column(String(768))
    file_path: Mapped[str] = mapped_column(String(768), nullable=False)
    file_path_hash: Mapped[str] = mapped_column(String(64), nullable=False)
    file_name: Mapped[str] = mapped_column(String(255), nullable=False)
    timestamp_original: Mapped[str | None] = mapped_column(String(64))
    timestamp_normalized: Mapped[str] = mapped_column(String(64), nullable=False)
    timezone_offset: Mapped[str | None] = mapped_column(String(16))
    latitude: Mapped[float | None] = mapped_column(Float)
    longitude: Mapped[float | None] = mapped_column(Float)
    width: Mapped[int | None] = mapped_column(Integer)
    height: Mapped[int | None] = mapped_column(Integer)
    thumbnail_path: Mapped[str | None] = mapped_column(String(768))
    fingerprint: Mapped[str | None] = mapped_column(String(128))
    deleted_at: Mapped[str | None] = mapped_column(String(64))
    created_at: Mapped[str] = mapped_column(String(64), nullable=False)
    updated_at: Mapped[str] = mapped_column(String(64), nullable=False)


class Ingestion(Base):
    __tablename__ = "ingestions"

    id: Mapped[str] = mapped_column(String(36), primary_key=True)
    root_path: Mapped[str] = mapped_column(String(768), nullable=False)
    started_at: Mapped[str] = mapped_column(String(64), nullable=False)
    finished_at: Mapped[str | None] = mapped_column(String(64))
    status: Mapped[str] = mapped_column(String(64), nullable=False)
    scanned_count: Mapped[int] = mapped_column(Integer, nullable=False, default=0)
    imported_count: Mapped[int] = mapped_column(Integer, nullable=False, default=0)
    skipped_count: Mapped[int] = mapped_column(Integer, nullable=False, default=0)
    error_count: Mapped[int] = mapped_column(Integer, nullable=False, default=0)
    notes: Mapped[str | None] = mapped_column(Text)


class IngestionError(Base):
    __tablename__ = "ingestion_errors"

    id: Mapped[str] = mapped_column(String(36), primary_key=True)
    ingestion_id: Mapped[str] = mapped_column(ForeignKey("ingestions.id"), nullable=False)
    file_path: Mapped[str] = mapped_column(String(768), nullable=False)
    error_code: Mapped[str] = mapped_column(String(128), nullable=False)
    error_message: Mapped[str] = mapped_column(Text, nullable=False)
    created_at: Mapped[str] = mapped_column(String(64), nullable=False)


class Visit(Base):
    __tablename__ = "visits"

    id: Mapped[str] = mapped_column(String(36), primary_key=True)
    title: Mapped[str | None] = mapped_column(Text)
    start_time: Mapped[str] = mapped_column(String(64), nullable=False)
    end_time: Mapped[str] = mapped_column(String(64), nullable=False)
    center_lat: Mapped[float | None] = mapped_column(Float)
    center_lon: Mapped[float | None] = mapped_column(Float)
    photo_count: Mapped[int] = mapped_column(Integer, nullable=False)
    location_label: Mapped[str | None] = mapped_column(Text)
    created_at: Mapped[str] = mapped_column(String(64), nullable=False)
    updated_at: Mapped[str] = mapped_column(String(64), nullable=False)


class PhotoVisit(Base):
    __tablename__ = "photo_visits"

    photo_id: Mapped[str] = mapped_column(ForeignKey("photos.id"), primary_key=True)
    visit_id: Mapped[str] = mapped_column(ForeignKey("visits.id"), primary_key=True)
