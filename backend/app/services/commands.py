from datetime import timedelta

from fastapi import HTTPException
from sqlalchemy.orm import Session

from app.models import DeviceCommand, DeviceCommandHistory, DeviceEvent
from app.models.base import utcnow
from app.schemas.ops import TERMINAL_COMMAND_STATUSES

ALLOWED_TRANSITIONS: dict[str, set[str]] = {
    "PENDING": {"QUEUED", "FAILED"},
    "QUEUED": {"SENT", "TIMED_OUT", "FAILED"},
    "SENT": {"ACKNOWLEDGED", "FAILED", "TIMED_OUT"},
    "ACKNOWLEDGED": {"EXECUTING", "FAILED", "TIMED_OUT"},
    "EXECUTING": {"SUCCESSFUL", "FAILED", "TIMED_OUT"},
}

COMMAND_LABELS = {
    "REBOOT": "Reboot Device",
    "FACTORY_RESET": "Factory Reset",
    "SYNC_CONFIG": "Synchronize Configuration",
    "REFRESH_INFO": "Refresh Device Information",
    "RESTART_APP": "Restart Application",
    "CLEAR_APP_CACHE": "Clear Application Cache",
}

_TIMESTAMP_FIELD = {
    "QUEUED": "queued_at",
    "SENT": "sent_at",
    "ACKNOWLEDGED": "acknowledged_at",
    "EXECUTING": "started_at",
    "SUCCESSFUL": "completed_at",
    "FAILED": "completed_at",
    "TIMED_OUT": "completed_at",
}


def transition(db: Session, cmd: DeviceCommand, new_status: str, message: str | None = None) -> None:
    if new_status not in ALLOWED_TRANSITIONS.get(cmd.status, set()):
        raise HTTPException(409, f"Invalid command transition {cmd.status} -> {new_status}")
    now = utcnow()
    cmd.status = new_status
    setattr(cmd, _TIMESTAMP_FIELD[new_status], now)
    if message:
        cmd.result_message = message
    db.add(DeviceCommandHistory(command_id=cmd.id, status=new_status, message=message, created_at=now))
    if new_status in TERMINAL_COMMAND_STATUSES:
        severity = {"SUCCESSFUL": "INFO", "FAILED": "ERROR", "TIMED_OUT": "WARNING"}[new_status]
        db.add(
            DeviceEvent(
                device_pk=cmd.device_pk,
                event_type="COMMAND_" + new_status,
                severity=severity,
                description=f"{COMMAND_LABELS.get(cmd.command_type, cmd.command_type)} ({cmd.command_code}) "
                f"{new_status.replace('_', ' ').lower()}" + (f": {message}" if message else ""),
                created_at=now,
            )
        )


def compute_expiry(timeout_seconds: int):
    return utcnow() + timedelta(seconds=timeout_seconds)


def serialize_command(c: DeviceCommand, include_history: bool = False) -> dict:
    data = {
        "id": c.id,
        "command_code": c.command_code,
        "device_id": c.device.device_id,
        "serial_number": c.device.serial_number,
        "device_model": c.device.model,
        "command_type": c.command_type,
        "status": c.status,
        "parameters": c.parameters or {},
        "result_message": c.result_message,
        "requested_by": c.requested_by.username if c.requested_by else None,
        "timeout_seconds": c.timeout_seconds,
        "created_at": c.created_at,
        "queued_at": c.queued_at,
        "sent_at": c.sent_at,
        "acknowledged_at": c.acknowledged_at,
        "started_at": c.started_at,
        "completed_at": c.completed_at,
        "expires_at": c.expires_at,
        "history": [],
    }
    if include_history:
        data["history"] = [
            {"status": h.status, "message": h.message, "created_at": h.created_at} for h in c.history
        ]
    return data
