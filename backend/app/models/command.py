from datetime import datetime

from sqlalchemy import JSON, BigInteger, DateTime, ForeignKey, Integer, String, Text
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.core.database import Base
from app.models.base import TimestampMixin, utcnow


class DeviceCommand(Base, TimestampMixin):
    __tablename__ = "device_commands"

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    command_code: Mapped[str] = mapped_column(String(20), unique=True, index=True, nullable=False)
    device_pk: Mapped[int] = mapped_column(ForeignKey("devices.id", ondelete="CASCADE"), index=True, nullable=False)
    # REBOOT | FACTORY_RESET | SYNC_CONFIG | REFRESH_INFO | RESTART_APP | CLEAR_APP_CACHE
    command_type: Mapped[str] = mapped_column(String(24), index=True, nullable=False)
    # PENDING | QUEUED | SENT | ACKNOWLEDGED | EXECUTING | SUCCESSFUL | FAILED | TIMED_OUT
    status: Mapped[str] = mapped_column(String(16), index=True, default="PENDING", nullable=False)
    parameters: Mapped[dict] = mapped_column(JSON, default=dict, nullable=False)
    result_message: Mapped[str | None] = mapped_column(Text)
    requested_by_id: Mapped[int | None] = mapped_column(ForeignKey("users.id"))
    timeout_seconds: Mapped[int] = mapped_column(Integer, nullable=False)
    queued_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    sent_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    acknowledged_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    started_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    completed_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    expires_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), index=True, nullable=False)

    device: Mapped["Device"] = relationship(lazy="joined")  # noqa: F821
    requested_by: Mapped["User | None"] = relationship(lazy="joined")  # noqa: F821
    history: Mapped[list["DeviceCommandHistory"]] = relationship(
        order_by="DeviceCommandHistory.id", cascade="all, delete-orphan", passive_deletes=True
    )


class DeviceCommandHistory(Base):
    __tablename__ = "device_command_history"

    id: Mapped[int] = mapped_column(BigInteger, primary_key=True)
    command_id: Mapped[int] = mapped_column(
        ForeignKey("device_commands.id", ondelete="CASCADE"), index=True, nullable=False
    )
    status: Mapped[str] = mapped_column(String(16), nullable=False)
    message: Mapped[str | None] = mapped_column(Text)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utcnow, nullable=False)
