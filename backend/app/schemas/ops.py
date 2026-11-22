from datetime import datetime

from pydantic import BaseModel, Field

from app.schemas.common import ORMModel

COMMAND_TYPES = ("REBOOT", "FACTORY_RESET", "SYNC_CONFIG", "REFRESH_INFO", "RESTART_APP", "CLEAR_APP_CACHE")
COMMAND_STATUSES = ("PENDING", "QUEUED", "SENT", "ACKNOWLEDGED", "EXECUTING", "SUCCESSFUL", "FAILED", "TIMED_OUT")
TERMINAL_COMMAND_STATUSES = ("SUCCESSFUL", "FAILED", "TIMED_OUT")


class CommandCreate(BaseModel):
    device_id: str = Field(min_length=3, max_length=32)
    command_type: str = Field(pattern="^(" + "|".join(COMMAND_TYPES) + ")$")
    parameters: dict = Field(default_factory=dict)
    timeout_seconds: int | None = Field(default=None, ge=10, le=3600)
    confirmation: str | None = Field(default=None, max_length=64)


class CommandHistoryOut(ORMModel):
    status: str
    message: str | None
    created_at: datetime


class CommandOut(BaseModel):
    id: int
    command_code: str
    device_id: str
    serial_number: str
    device_model: str
    command_type: str
    status: str
    parameters: dict
    result_message: str | None
    requested_by: str | None
    timeout_seconds: int
    created_at: datetime
    queued_at: datetime | None
    sent_at: datetime | None
    acknowledged_at: datetime | None
    started_at: datetime | None
    completed_at: datetime | None
    expires_at: datetime
    history: list[CommandHistoryOut] = []


class FirmwareOut(BaseModel):
    id: int
    version: str
    model: str
    os_version: str
    release_date: datetime
    release_notes: str
    file_size_mb: float
    checksum_sha256: str
    status: str
    is_latest: bool
    device_count: int


class FirmwareCreate(BaseModel):
    version: str = Field(pattern=r"^\d+\.\d+\.\d+(-[a-z0-9]+)?$")
    model: str = Field(min_length=2, max_length=64)
    os_version: str = Field(min_length=2, max_length=32)
    release_notes: str = Field(default="", max_length=4000)
    file_size_mb: float = Field(gt=0, le=4096)
    status: str = Field(default="ACTIVE", pattern="^(ACTIVE|BETA|DEPRECATED)$")
    mark_latest: bool = False


class DeploymentCreate(BaseModel):
    name: str = Field(min_length=3, max_length=128)
    firmware_version_id: int
    device_ids: list[str] = Field(min_length=1, max_length=1000)
    scheduled_at: datetime | None = None
    offline_policy: str = Field(default="WAIT", pattern="^(WAIT|SKIP)$")


class DeploymentOut(BaseModel):
    id: int
    deployment_code: str
    name: str
    firmware_version_id: int
    firmware_version: str
    model: str
    status: str
    is_rollback: bool
    rollback_of: str | None
    offline_policy: str
    target_count: int
    successful_count: int
    failed_count: int
    pending_count: int
    in_progress_count: int
    progress_pct: float
    scheduled_at: datetime
    started_at: datetime | None
    completed_at: datetime | None
    created_by: str | None
    created_at: datetime


class DeploymentTargetOut(BaseModel):
    id: int
    device_id: str
    serial_number: str
    region: str
    connection_status: str
    previous_version: str | None
    target_version: str
    status: str
    error_message: str | None
    updated_at: datetime


class ApplicationOut(BaseModel):
    id: int
    name: str
    package_id: str
    category: str
    publisher: str
    latest_version: str
    description: str
    device_count: int
    version_count: int
    latest_count: int
    update_available_count: int
    failed_count: int


class VersionCount(BaseModel):
    version: str
    device_count: int
    is_latest: bool
    percentage: float


class ApplicationDetail(ApplicationOut):
    versions: list[VersionCount]
    statuses: list[dict]
    usage_minutes_7d: int
    crash_count_7d: int


class AppInstallationOut(BaseModel):
    device_id: str
    serial_number: str
    model: str
    region: str
    version: str
    status: str
    installed_at: datetime
    last_used_at: datetime | None


class AlertOut(BaseModel):
    id: int
    alert_code: str
    device_id: str
    serial_number: str
    category: str
    severity: str
    title: str
    description: str
    status: str
    created_at: datetime
    acknowledged_at: datetime | None
    acknowledged_by: str | None
    resolved_at: datetime | None
    resolved_by: str | None
    resolution_note: str | None


class AlertResolve(BaseModel):
    note: str | None = Field(default=None, max_length=1000)


class AuditLogOut(ORMModel):
    id: int
    user_id: int | None
    username: str
    action: str
    target_type: str | None
    target_id: str | None
    details: dict
    result: str
    ip_address: str | None
    created_at: datetime


class SettingOut(ORMModel):
    key: str
    value: str
    description: str
    updated_at: datetime


class SettingsUpdate(BaseModel):
    values: dict[str, str]
