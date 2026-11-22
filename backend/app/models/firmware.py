from datetime import datetime

from sqlalchemy import Boolean, DateTime, Float, ForeignKey, Integer, String, Text, UniqueConstraint
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.core.database import Base
from app.models.base import TimestampMixin, utcnow


class FirmwareVersion(Base, TimestampMixin):
    __tablename__ = "firmware_versions"
    __table_args__ = (UniqueConstraint("version", "model", name="uq_firmware_version_model"),)

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    version: Mapped[str] = mapped_column(String(32), index=True, nullable=False)
    model: Mapped[str] = mapped_column(String(64), index=True, nullable=False)
    os_version: Mapped[str] = mapped_column(String(32), nullable=False)
    release_date: Mapped[datetime] = mapped_column(DateTime(timezone=True), nullable=False)
    release_notes: Mapped[str] = mapped_column(Text, default="", nullable=False)
    file_size_mb: Mapped[float] = mapped_column(Float, nullable=False)
    checksum_sha256: Mapped[str] = mapped_column(String(64), nullable=False)
    # ACTIVE | DEPRECATED | BETA
    status: Mapped[str] = mapped_column(String(16), default="ACTIVE", nullable=False)
    is_latest: Mapped[bool] = mapped_column(Boolean, default=False, nullable=False)


class FirmwareDeployment(Base, TimestampMixin):
    __tablename__ = "firmware_deployments"

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    deployment_code: Mapped[str] = mapped_column(String(16), unique=True, index=True, nullable=False)
    name: Mapped[str] = mapped_column(String(128), nullable=False)
    firmware_version_id: Mapped[int] = mapped_column(ForeignKey("firmware_versions.id"), index=True, nullable=False)
    # SCHEDULED | IN_PROGRESS | COMPLETED | COMPLETED_WITH_ERRORS | FAILED | CANCELLED | ROLLED_BACK
    status: Mapped[str] = mapped_column(String(24), index=True, nullable=False)
    is_rollback: Mapped[bool] = mapped_column(Boolean, default=False, nullable=False)
    # WAIT: retry offline devices until the deployment window closes; SKIP: fail offline devices at start.
    offline_policy: Mapped[str] = mapped_column(String(8), default="WAIT", nullable=False)
    rollback_of_id: Mapped[int | None] = mapped_column(ForeignKey("firmware_deployments.id"))
    scheduled_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utcnow, nullable=False)
    started_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    completed_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    created_by_id: Mapped[int | None] = mapped_column(ForeignKey("users.id"))

    firmware: Mapped[FirmwareVersion] = relationship(lazy="joined")
    created_by: Mapped["User | None"] = relationship(lazy="joined")  # noqa: F821
    targets: Mapped[list["DeploymentTarget"]] = relationship(
        back_populates="deployment", cascade="all, delete-orphan", passive_deletes=True
    )


class DeploymentTarget(Base):
    __tablename__ = "deployment_targets"
    __table_args__ = (UniqueConstraint("deployment_id", "device_pk", name="uq_deployment_target"),)

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    deployment_id: Mapped[int] = mapped_column(
        ForeignKey("firmware_deployments.id", ondelete="CASCADE"), index=True, nullable=False
    )
    device_pk: Mapped[int] = mapped_column(ForeignKey("devices.id", ondelete="CASCADE"), index=True, nullable=False)
    previous_firmware_version_id: Mapped[int | None] = mapped_column(ForeignKey("firmware_versions.id"))
    target_firmware_version_id: Mapped[int] = mapped_column(ForeignKey("firmware_versions.id"), nullable=False)
    # PENDING | DOWNLOADING | INSTALLING | SUCCESS | FAILED
    status: Mapped[str] = mapped_column(String(16), index=True, default="PENDING", nullable=False)
    error_message: Mapped[str | None] = mapped_column(Text)
    updated_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utcnow, onupdate=utcnow, nullable=False)

    deployment: Mapped[FirmwareDeployment] = relationship(back_populates="targets")
    device: Mapped["Device"] = relationship(lazy="joined")  # noqa: F821
