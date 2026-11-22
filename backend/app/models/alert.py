from datetime import datetime

from sqlalchemy import JSON, BigInteger, DateTime, ForeignKey, Index, Integer, String, Text
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.core.database import Base
from app.models.base import utcnow


class Alert(Base):
    __tablename__ = "alerts"
    __table_args__ = (Index("ix_alerts_device_category_status", "device_pk", "category", "status"),)

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    alert_code: Mapped[str] = mapped_column(String(20), unique=True, index=True, nullable=False)
    device_pk: Mapped[int] = mapped_column(ForeignKey("devices.id", ondelete="CASCADE"), index=True, nullable=False)
    # DEVICE_OFFLINE | HIGH_CPU | HIGH_MEMORY | FIRMWARE_UPDATE | APP_CRASH | NETWORK_DISCONNECT | CRITICAL_ERROR
    category: Mapped[str] = mapped_column(String(32), index=True, nullable=False)
    # INFO | WARNING | CRITICAL
    severity: Mapped[str] = mapped_column(String(16), index=True, nullable=False)
    title: Mapped[str] = mapped_column(String(160), nullable=False)
    description: Mapped[str] = mapped_column(Text, nullable=False)
    # OPEN | ACKNOWLEDGED | RESOLVED
    status: Mapped[str] = mapped_column(String(16), index=True, default="OPEN", nullable=False)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utcnow, index=True, nullable=False)
    acknowledged_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    acknowledged_by_id: Mapped[int | None] = mapped_column(ForeignKey("users.id"))
    resolved_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    resolved_by_id: Mapped[int | None] = mapped_column(ForeignKey("users.id"))
    resolution_note: Mapped[str | None] = mapped_column(Text)

    device: Mapped["Device"] = relationship(lazy="joined")  # noqa: F821
    acknowledged_by: Mapped["User | None"] = relationship(foreign_keys=[acknowledged_by_id], lazy="joined")  # noqa: F821
    resolved_by: Mapped["User | None"] = relationship(foreign_keys=[resolved_by_id], lazy="joined")  # noqa: F821


class AuditLog(Base):
    """Append-only. UPDATE/DELETE are blocked by a database trigger (see migration)."""

    __tablename__ = "audit_logs"

    id: Mapped[int] = mapped_column(BigInteger, primary_key=True)
    user_id: Mapped[int | None] = mapped_column(Integer, index=True)
    username: Mapped[str] = mapped_column(String(64), index=True, nullable=False)
    action: Mapped[str] = mapped_column(String(48), index=True, nullable=False)
    target_type: Mapped[str | None] = mapped_column(String(32))
    target_id: Mapped[str | None] = mapped_column(String(64), index=True)
    details: Mapped[dict] = mapped_column(JSON, default=dict, nullable=False)
    # SUCCESS | FAILURE | DENIED
    result: Mapped[str] = mapped_column(String(16), index=True, nullable=False)
    ip_address: Mapped[str | None] = mapped_column(String(45))
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utcnow, index=True, nullable=False)


class SystemSetting(Base):
    __tablename__ = "system_settings"

    key: Mapped[str] = mapped_column(String(64), primary_key=True)
    value: Mapped[str] = mapped_column(Text, nullable=False)
    description: Mapped[str] = mapped_column(String(255), default="", nullable=False)
    updated_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utcnow, onupdate=utcnow, nullable=False)
