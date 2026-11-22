from datetime import datetime

from sqlalchemy import DateTime, ForeignKey, Integer, String, Text, UniqueConstraint
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.core.database import Base
from app.models.base import TimestampMixin, utcnow


class Application(Base, TimestampMixin):
    __tablename__ = "applications"

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    name: Mapped[str] = mapped_column(String(64), unique=True, nullable=False)
    package_id: Mapped[str] = mapped_column(String(128), unique=True, index=True, nullable=False)
    category: Mapped[str] = mapped_column(String(32), nullable=False)
    publisher: Mapped[str] = mapped_column(String(64), nullable=False)
    latest_version: Mapped[str] = mapped_column(String(32), nullable=False)
    description: Mapped[str] = mapped_column(Text, default="", nullable=False)


class InstalledApplication(Base):
    __tablename__ = "installed_applications"
    __table_args__ = (UniqueConstraint("device_pk", "application_id", name="uq_installed_app_device"),)

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    device_pk: Mapped[int] = mapped_column(ForeignKey("devices.id", ondelete="CASCADE"), index=True, nullable=False)
    application_id: Mapped[int] = mapped_column(ForeignKey("applications.id"), index=True, nullable=False)
    version: Mapped[str] = mapped_column(String(32), index=True, nullable=False)
    # INSTALLED | UPDATE_AVAILABLE | INSTALL_FAILED | DISABLED
    status: Mapped[str] = mapped_column(String(24), default="INSTALLED", nullable=False)
    installed_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utcnow, nullable=False)
    last_used_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    usage_minutes_7d: Mapped[int] = mapped_column(Integer, default=0, nullable=False)
    crash_count_7d: Mapped[int] = mapped_column(Integer, default=0, nullable=False)

    application: Mapped[Application] = relationship(lazy="joined")
