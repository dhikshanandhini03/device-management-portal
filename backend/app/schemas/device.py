import re
from datetime import datetime

from pydantic import BaseModel, Field, field_validator

from app.schemas.common import ORMModel

MAC_RE = re.compile(r"^([0-9A-F]{2}:){5}[0-9A-F]{2}$")


class DeviceListItem(BaseModel):
    id: int
    device_id: str
    serial_number: str
    mac_address: str
    model: str
    hardware_version: str
    firmware_version: str
    os_version: str
    ip_address: str
    connection_status: str
    health_status: str
    last_seen_at: datetime | None
    customer_ref: str
    region: str
    city: str
    simulation_profile: str
    registered_at: datetime
    update_available: bool
    latest_firmware_version: str | None


class DeviceDetail(DeviceListItem):
    firmware_release_date: datetime | None
    last_boot_at: datetime | None
    uptime_seconds: int | None
    last_connected_at: datetime | None
    last_disconnected_at: datetime | None
    cpu_usage: float
    memory_usage: float
    storage_usage: float
    temperature_c: float | None
    network_type: str
    signal_strength_dbm: float | None
    bandwidth_mbps: float
    latency_ms: float
    packet_loss_pct: float
    open_alerts: int


class DeviceCreate(BaseModel):
    serial_number: str = Field(pattern=r"^[A-Z0-9]{8,20}$")
    mac_address: str
    model: str = Field(min_length=2, max_length=64)
    hardware_version: str = Field(min_length=1, max_length=16)
    ip_address: str = Field(min_length=7, max_length=45)
    customer_ref: str = Field(min_length=3, max_length=32)
    region: str = Field(min_length=2, max_length=32)
    city: str = Field(min_length=2, max_length=64)
    simulation_profile: str = Field(default="STANDARD", pattern=r"^(STANDARD|STABLE_ONLINE|STABLE_OFFLINE)$")
    initial_status: str = Field(default="OFFLINE", pattern=r"^(ONLINE|OFFLINE)$")

    @field_validator("mac_address")
    @classmethod
    def mac(cls, v: str) -> str:
        v = v.upper().replace("-", ":")
        if not MAC_RE.match(v):
            raise ValueError("MAC address must be in format AA:BB:CC:DD:EE:FF")
        return v


class DeviceUpdate(BaseModel):
    customer_ref: str | None = Field(default=None, min_length=3, max_length=32)
    region: str | None = Field(default=None, min_length=2, max_length=32)
    city: str | None = Field(default=None, min_length=2, max_length=64)
    simulation_profile: str | None = Field(default=None, pattern=r"^(STANDARD|STABLE_ONLINE|STABLE_OFFLINE)$")


class DeviceFilters(BaseModel):
    models: list[str]
    firmware_versions: list[str]
    regions: list[str]
    statuses: list[str]
    health_statuses: list[str]


class DeviceEventOut(ORMModel):
    id: int
    event_type: str
    severity: str
    description: str
    created_at: datetime
    device_id: str | None = None


class DeviceLogOut(ORMModel):
    id: int
    severity: str
    category: str
    component: str
    message: str
    created_at: datetime
    device_id: str | None = None
    serial_number: str | None = None


class TelemetryPoint(BaseModel):
    timestamp: datetime
    cpu_usage: float
    memory_usage: float
    storage_usage: float
    temperature_c: float | None
    latency_ms: float


class TelemetryResponse(BaseModel):
    device_id: str
    resolution: str
    points: list[TelemetryPoint]


class InstalledAppOut(BaseModel):
    application_id: int
    name: str
    package_id: str
    category: str
    version: str
    latest_version: str
    status: str
    update_available: bool
    installed_at: datetime
    last_used_at: datetime | None
    usage_minutes_7d: int
    crash_count_7d: int


class NetworkInfo(BaseModel):
    device_id: str
    ip_address: str
    mac_address: str
    connection_status: str
    network_type: str
    signal_strength_dbm: float | None
    bandwidth_mbps: float
    latency_ms: float
    packet_loss_pct: float
    last_connected_at: datetime | None
    last_disconnected_at: datetime | None
    connection_history: list[DeviceEventOut]


class SoftwareInfo(BaseModel):
    firmware_version: str
    firmware_release_date: datetime | None
    os_version: str
    latest_firmware_version: str | None
    latest_os_version: str | None
    update_available: bool
    applications: list[InstalledAppOut]
