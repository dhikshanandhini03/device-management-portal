from datetime import timedelta

from fastapi import APIRouter, Depends
from sqlalchemy import and_, func, select
from sqlalchemy.orm import Session, aliased

from app.api.deps import require
from app.core.database import get_db
from app.core.permissions import Permission
from app.models import Alert, AuditLog, Device, DeviceEvent, DeviceStatus, FirmwareVersion, User
from app.models.base import utcnow
from app.services.alerts import serialize_alert

router = APIRouter(prefix="/api/dashboard", tags=["Dashboard"])


def fleet_counts(db: Session) -> dict:
    status_counts = dict(db.execute(select(DeviceStatus.connection_status, func.count()).group_by(DeviceStatus.connection_status)).all())
    health_counts = dict(db.execute(select(DeviceStatus.health_status, func.count()).group_by(DeviceStatus.health_status)).all())
    latest = aliased(FirmwareVersion)
    update_available = db.execute(
        select(func.count(Device.id))
        .join(latest, and_(latest.model == Device.model, latest.is_latest.is_(True)))
        .where(latest.id != Device.firmware_version_id)
    ).scalar_one()
    total = db.execute(select(func.count(Device.id))).scalar_one()
    return {
        "total_devices": total,
        "online_devices": status_counts.get("ONLINE", 0),
        "offline_devices": status_counts.get("OFFLINE", 0),
        "rebooting_devices": status_counts.get("REBOOTING", 0),
        "warning_devices": health_counts.get("WARNING", 0),
        "critical_devices": health_counts.get("CRITICAL", 0),
        "healthy_devices": health_counts.get("HEALTHY", 0),
        "firmware_update_available": update_available,
    }


@router.get("/summary")
def summary(db: Session = Depends(get_db), _: User = Depends(require(Permission.DASHBOARD_VIEW))):
    data = fleet_counts(db)
    data["open_alerts"] = db.execute(select(func.count(Alert.id)).where(Alert.status != "RESOLVED")).scalar_one()
    data["generated_at"] = utcnow()
    return data


@router.get("/charts")
def charts(db: Session = Depends(get_db), _: User = Depends(require(Permission.DASHBOARD_VIEW))):
    counts = fleet_counts(db)
    now = utcnow()

    month = func.date_trunc("month", Device.registered_at)
    registrations = db.execute(
        select(month.label("m"), func.count()).where(Device.registered_at >= now - timedelta(days=365))
        .group_by("m").order_by("m")
    ).all()

    firmware = db.execute(
        select(FirmwareVersion.version, func.count(Device.id))
        .join(Device, Device.firmware_version_id == FirmwareVersion.id)
        .group_by(FirmwareVersion.version).order_by(func.count(Device.id).desc())
    ).all()
    top_fw = [{"label": v, "value": c} for v, c in firmware[:8]]
    if len(firmware) > 8:
        top_fw.append({"label": "Other", "value": sum(c for _, c in firmware[8:])})

    models = db.execute(select(Device.model, func.count()).group_by(Device.model).order_by(func.count().desc())).all()

    hour = func.date_trunc("hour", DeviceEvent.created_at)
    events = db.execute(
        select(hour.label("h"), DeviceEvent.severity, func.count())
        .where(DeviceEvent.created_at >= now - timedelta(hours=24))
        .group_by("h", DeviceEvent.severity).order_by("h")
    ).all()
    by_hour: dict = {}
    for h, sev, c in events:
        row = by_hour.setdefault(h, {"timestamp": h, "INFO": 0, "WARNING": 0, "ERROR": 0, "CRITICAL": 0})
        row[sev] = row.get(sev, 0) + c

    return {
        "online_offline": [
            {"label": "Online", "value": counts["online_devices"]},
            {"label": "Offline", "value": counts["offline_devices"]},
            {"label": "Rebooting", "value": counts["rebooting_devices"]},
        ],
        "registration_trend": [{"timestamp": m, "value": c} for m, c in registrations],
        "firmware_distribution": top_fw,
        "model_distribution": [{"label": m, "value": c} for m, c in models],
        "health_overview": [
            {"label": "Healthy", "value": counts["healthy_devices"]},
            {"label": "Warning", "value": counts["warning_devices"]},
            {"label": "Critical", "value": counts["critical_devices"]},
        ],
        "recent_events": list(by_hour.values()),
    }


@router.get("/activity")
def activity(db: Session = Depends(get_db), _: User = Depends(require(Permission.DASHBOARD_VIEW))):
    alerts = db.execute(
        select(Alert).where(Alert.status != "RESOLVED").order_by(Alert.created_at.desc()).limit(6)
    ).unique().scalars().all()

    def recent(column):
        rows = db.execute(
            select(Device.device_id, Device.serial_number, Device.model, Device.region, column)
            .join(DeviceStatus, DeviceStatus.device_pk == Device.id)
            .where(column.is_not(None))
            .order_by(column.desc())
            .limit(6)
        ).all()
        return [{"device_id": r[0], "serial_number": r[1], "model": r[2], "region": r[3], "timestamp": r[4]} for r in rows]

    connected = recent(DeviceStatus.last_connected_at)
    disconnected = recent(DeviceStatus.last_disconnected_at)
    admin = db.execute(
        select(AuditLog).where(AuditLog.action.not_in(["LOGIN", "LOGOUT", "LOGIN_FAILED"]))
        .order_by(AuditLog.created_at.desc()).limit(8)
    ).scalars().all()
    events = db.execute(select(DeviceEvent).order_by(DeviceEvent.created_at.desc(), DeviceEvent.id.desc()).limit(10)).unique().scalars().all()
    status_dist = db.execute(
        select(DeviceStatus.connection_status, DeviceStatus.health_status, func.count())
        .group_by(DeviceStatus.connection_status, DeviceStatus.health_status)
    ).all()
    return {
        "recent_alerts": [serialize_alert(a) for a in alerts],
        "recently_connected": connected,
        "recently_disconnected": disconnected,
        "recent_admin_activity": [
            {"id": a.id, "username": a.username, "action": a.action, "target_id": a.target_id, "result": a.result,
             "created_at": a.created_at} for a in admin
        ],
        "recent_device_events": [
            {"id": e.id, "device_id": e.device.device_id, "event_type": e.event_type, "severity": e.severity,
             "description": e.description, "created_at": e.created_at} for e in events
        ],
        "status_distribution": [{"connection_status": c, "health_status": h, "count": n} for c, h, n in status_dist],
    }
