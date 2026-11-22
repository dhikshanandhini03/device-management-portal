import secrets

from sqlalchemy import select
from sqlalchemy.orm import Session

from app.models import Alert, Device, SystemSetting
from app.models.base import utcnow

DEFAULT_SETTINGS: dict[str, tuple[str, str]] = {
    "cpu_alert_threshold": ("90", "CPU utilisation (%) that raises a High CPU Usage alert"),
    "memory_alert_threshold": ("90", "Memory utilisation (%) that raises a High Memory Usage alert"),
    "cpu_warning_threshold": ("80", "CPU utilisation (%) that marks device health as WARNING"),
    "memory_warning_threshold": ("80", "Memory utilisation (%) that marks device health as WARNING"),
    "storage_warning_threshold": ("90", "Storage utilisation (%) that marks device health as WARNING"),
    "temperature_critical_threshold": ("80", "Temperature (C) that marks device health as CRITICAL"),
    "offline_alerts_enabled": ("true", "Raise Device Offline alerts when devices disconnect"),
    "command_default_timeout_seconds": ("120", "Default remote command timeout"),
    "deployment_target_timeout_seconds": ("600", "Time an offline device may stay pending in a WAIT deployment"),
    "telemetry_raw_retention_hours": ("24", "Retention of raw telemetry before hourly roll-up only"),
}


def new_code(prefix: str) -> str:
    return f"{prefix}-{secrets.token_hex(4).upper()}"


def get_settings_map(db: Session) -> dict[str, str]:
    values = {k: v[0] for k, v in DEFAULT_SETTINGS.items()}
    for s in db.execute(select(SystemSetting)).scalars():
        values[s.key] = s.value
    return values


def setting_float(values: dict[str, str], key: str) -> float:
    try:
        return float(values[key])
    except (KeyError, ValueError):
        return float(DEFAULT_SETTINGS[key][0])


def raise_alert(
    db: Session, device: Device, category: str, severity: str, title: str, description: str
) -> Alert | None:
    """Create an alert unless an unresolved one of the same category already exists for the device."""
    existing = db.execute(
        select(Alert.id).where(Alert.device_pk == device.id, Alert.category == category, Alert.status != "RESOLVED")
    ).first()
    if existing:
        return None
    alert = Alert(
        alert_code=new_code("ALR"),
        device_pk=device.id,
        category=category,
        severity=severity,
        title=title,
        description=description,
        status="OPEN",
    )
    db.add(alert)
    return alert


def auto_resolve(db: Session, device_pk: int, category: str, note: str) -> None:
    for alert in db.execute(
        select(Alert).where(Alert.device_pk == device_pk, Alert.category == category, Alert.status != "RESOLVED")
    ).scalars():
        alert.status = "RESOLVED"
        alert.resolved_at = utcnow()
        alert.resolution_note = note


def serialize_alert(a: Alert) -> dict:
    return {
        "id": a.id,
        "alert_code": a.alert_code,
        "device_id": a.device.device_id,
        "serial_number": a.device.serial_number,
        "category": a.category,
        "severity": a.severity,
        "title": a.title,
        "description": a.description,
        "status": a.status,
        "created_at": a.created_at,
        "acknowledged_at": a.acknowledged_at,
        "acknowledged_by": a.acknowledged_by.username if a.acknowledged_by else None,
        "resolved_at": a.resolved_at,
        "resolved_by": a.resolved_by.username if a.resolved_by else ("system" if a.resolved_at else None),
        "resolution_note": a.resolution_note,
    }
