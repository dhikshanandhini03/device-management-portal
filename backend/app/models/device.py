from datetime import datetime

from sqlalchemy import (
    BigInteger,
    DateTime,
    Float,
    ForeignKey,
    Index,
    Integer,
    String,
    Text,
    func,
)
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.core.database import Base
from app.models.base import TimestampMixin, utcnow


class Device(Base, TimestampMixin):
    __tablename__ = "devices"

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    device_id: Mapped[str] = mapped_column(String(32), unique=True, index=True, nullable=False)
    serial_number: Mapped[str] = mapped_column(String(32), unique=True, index=True, nullable=False)
    mac_address: Mapped[str] = mapped_column(String(17), unique=True, index=True, nullable=False)
    model: Mapped[str] = mapped_column(String(64), index=True, nullable=False)
    hardware_version: Mapped[str] = mapped_column(String(16), nullable=False)
    firmware_version_id: Mapped[int] = mapped_column(ForeignKey("firmware_versions.id"), index=True, nullable=False)
    os_version: Mapped[str] = mapped_column(String(32), nullable=False)
    ip_address: Mapped[str] = mapped_column(String(45), nullable=False)
    customer_ref: Mapped[str] = mapped_column(String(32), index=True, nullable=False)
    region: Mapped[str] = mapped_column(String(32), index=True, nullable=False)
    city: Mapped[str] = mapped_column(String(64), nullable=False)
    # STANDARD | STABLE_ONLINE | STABLE_OFFLINE: controls simulator randomness (deterministic test devices).
    simulation_profile: Mapped[str] = mapped_column(String(16), default="STANDARD", nullable=False)
    registered_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utcnow, index=True, nullable=False)

    firmware: Mapped["FirmwareVersion"] = relationship(lazy="joined")  # noqa: F821
    status: Mapped["DeviceStatus"] = relationship(
        back_populates="device", uselist=False, lazy="joined", cascade="all, delete-orphan", passive_deletes=True
    )


class DeviceStatus(Base):
    """Latest known state of a device (hot, one row per device)."""

    __tablename__ = "device_status"

    device_pk: Mapped[int] = mapped_column(ForeignKey("devices.id", ondelete="CASCADE"), primary_key=True)
    connection_status: Mapped[str] = mapped_column(String(16), index=True, default="OFFLINE", nullable=False)
    health_status: Mapped[str] = mapped_column(String(16), index=True, default="HEALTHY", nullable=False)
    last_seen_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), index=True)
    last_boot_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    last_connected_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    last_disconnected_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    cpu_usage: Mapped[float] = mapped_column(Float, default=0, nullable=False)
    memory_usage: Mapped[float] = mapped_column(Float, default=0, nullable=False)
    storage_usage: Mapped[float] = mapped_column(Float, default=0, nullable=False)
    temperature_c: Mapped[float | None] = mapped_column(Float)
    network_type: Mapped[str] = mapped_column(String(16), default="ETHERNET", nullable=False)
    signal_strength_dbm: Mapped[float | None] = mapped_column(Float)
    bandwidth_mbps: Mapped[float] = mapped_column(Float, default=0, nullable=False)
    latency_ms: Mapped[float] = mapped_column(Float, default=0, nullable=False)
    packet_loss_pct: Mapped[float] = mapped_column(Float, default=0, nullable=False)
    updated_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now(), default=utcnow, onupdate=utcnow, nullable=False
    )

    device: Mapped[Device] = relationship(back_populates="status")


class DeviceEvent(Base):
    __tablename__ = "device_events"
    __table_args__ = (Index("ix_device_events_device_created", "device_pk", "created_at"),)

    id: Mapped[int] = mapped_column(BigInteger, primary_key=True)
    device_pk: Mapped[int] = mapped_column(ForeignKey("devices.id", ondelete="CASCADE"), nullable=False)
    event_type: Mapped[str] = mapped_column(String(32), index=True, nullable=False)
    severity: Mapped[str] = mapped_column(String(16), default="INFO", nullable=False)
    description: Mapped[str] = mapped_column(Text, nullable=False)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utcnow, index=True, nullable=False)

    device: Mapped[Device] = relationship(lazy="joined")


class DeviceLog(Base):
    __tablename__ = "device_logs"
    __table_args__ = (Index("ix_device_logs_device_created", "device_pk", "created_at"),)

    id: Mapped[int] = mapped_column(BigInteger, primary_key=True)
    device_pk: Mapped[int] = mapped_column(ForeignKey("devices.id", ondelete="CASCADE"), nullable=False)
    severity: Mapped[str] = mapped_column(String(16), index=True, nullable=False)
    category: Mapped[str] = mapped_column(String(32), index=True, nullable=False)
    component: Mapped[str] = mapped_column(String(64), nullable=False)
    message: Mapped[str] = mapped_column(Text, nullable=False)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utcnow, index=True, nullable=False)

    device: Mapped[Device] = relationship(lazy="joined")


class DeviceTelemetry(Base):
    """Raw telemetry samples. Short retention; rolled up into device_telemetry_hourly."""

    __tablename__ = "device_telemetry"
    __table_args__ = (Index("ix_device_telemetry_device_recorded", "device_pk", "recorded_at"),)

    id: Mapped[int] = mapped_column(BigInteger, primary_key=True)
    device_pk: Mapped[int] = mapped_column(ForeignKey("devices.id", ondelete="CASCADE"), nullable=False)
    recorded_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), index=True, nullable=False)
    cpu_usage: Mapped[float] = mapped_column(Float, nullable=False)
    memory_usage: Mapped[float] = mapped_column(Float, nullable=False)
    storage_usage: Mapped[float] = mapped_column(Float, nullable=False)
    temperature_c: Mapped[float | None] = mapped_column(Float)
    latency_ms: Mapped[float] = mapped_column(Float, nullable=False)
    bandwidth_mbps: Mapped[float] = mapped_column(Float, nullable=False)


class DeviceTelemetryHourly(Base):
    """Historical hourly aggregates (long retention)."""

    __tablename__ = "device_telemetry_hourly"

    device_pk: Mapped[int] = mapped_column(ForeignKey("devices.id", ondelete="CASCADE"), primary_key=True)
    bucket: Mapped[datetime] = mapped_column(DateTime(timezone=True), primary_key=True, index=True)
    avg_cpu: Mapped[float] = mapped_column(Float, nullable=False)
    max_cpu: Mapped[float] = mapped_column(Float, nullable=False)
    avg_memory: Mapped[float] = mapped_column(Float, nullable=False)
    max_memory: Mapped[float] = mapped_column(Float, nullable=False)
    avg_storage: Mapped[float] = mapped_column(Float, nullable=False)
    avg_temperature: Mapped[float | None] = mapped_column(Float)
    avg_latency: Mapped[float] = mapped_column(Float, nullable=False)
    samples: Mapped[int] = mapped_column(Integer, nullable=False)
