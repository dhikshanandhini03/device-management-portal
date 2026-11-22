from datetime import datetime, timedelta

from fastapi import APIRouter, Depends, Query
from sqlalchemy import func, select
from sqlalchemy.orm import Session

from app.api.deps import require
from app.core.database import get_db
from app.core.permissions import Permission
from app.models import Device, DeviceEvent, DeviceLog, DeviceStatus, DeviceTelemetry, DeviceTelemetryHourly, User
from app.models.base import utcnow
from app.schemas.common import Page
from app.schemas.device import DeviceLogOut
from app.services.alerts import get_settings_map, setting_float
from app.services.devices import escape_like, get_device_row, serialize_device_detail
from app.services.query import PageParams, csv_response, paginate

router = APIRouter(prefix="/api/monitoring", tags=["Monitoring & Diagnostics"])

LOG_CATEGORIES = ["SYSTEM", "NETWORK", "APPLICATION", "FIRMWARE", "HARDWARE", "SECURITY"]


@router.get("/overview")
def overview(db: Session = Depends(get_db), _: User = Depends(require(Permission.MONITORING_VIEW))):
    now = utcnow()
    online = DeviceStatus.connection_status == "ONLINE"
    avg = db.execute(
        select(
            func.avg(DeviceStatus.cpu_usage), func.avg(DeviceStatus.memory_usage), func.avg(DeviceStatus.storage_usage),
            func.avg(DeviceStatus.temperature_c), func.avg(DeviceStatus.latency_ms),
            func.avg(func.extract("epoch", func.now() - DeviceStatus.last_boot_at)),
            func.count(),
        ).where(online)
    ).one()
    network = db.execute(
        select(DeviceStatus.network_type, DeviceStatus.connection_status, func.count())
        .group_by(DeviceStatus.network_type, DeviceStatus.connection_status)
    ).all()
    since = now - timedelta(hours=24)
    crashes = db.execute(
        select(func.count()).where(DeviceEvent.event_type == "APP_CRASH", DeviceEvent.created_at >= since)
    ).scalar_one()
    errors = db.execute(
        select(func.count()).where(DeviceLog.severity.in_(["ERROR", "CRITICAL"]), DeviceLog.created_at >= since)
    ).scalar_one()
    s = get_settings_map(db)
    high_cpu = db.execute(
        select(func.count()).where(online, DeviceStatus.cpu_usage >= setting_float(s, "cpu_warning_threshold"))
    ).scalar_one()
    high_mem = db.execute(
        select(func.count()).where(online, DeviceStatus.memory_usage >= setting_float(s, "memory_warning_threshold"))
    ).scalar_one()
    total = db.execute(select(func.count()).select_from(DeviceStatus)).scalar_one()
    return {
        "avg_cpu_usage": round(avg[0] or 0, 1),
        "avg_memory_usage": round(avg[1] or 0, 1),
        "avg_storage_usage": round(avg[2] or 0, 1),
        "avg_temperature_c": round(avg[3] or 0, 1),
        "avg_latency_ms": round(avg[4] or 0, 1),
        "avg_uptime_seconds": int(avg[5] or 0),
        "online_devices": avg[6],
        "total_devices": total,
        "connectivity_pct": round(100 * avg[6] / total, 1) if total else 0,
        "network": [{"network_type": n, "connection_status": c, "count": k} for n, c, k in network],
        "app_crashes_24h": crashes,
        "device_errors_24h": errors,
        "high_cpu_devices": high_cpu,
        "high_memory_devices": high_mem,
        "generated_at": now,
    }


@router.get("/health-history")
def health_history(
    hours: int = Query(24, ge=1, le=24 * 90),
    db: Session = Depends(get_db),
    _: User = Depends(require(Permission.MONITORING_VIEW)),
):
    now = utcnow()
    since = now - timedelta(hours=hours)
    h = DeviceTelemetryHourly
    rows = db.execute(
        select(h.bucket, func.avg(h.avg_cpu), func.avg(h.avg_memory), func.avg(h.avg_storage), func.avg(h.avg_temperature),
               func.avg(h.avg_latency), func.count(func.distinct(h.device_pk)))
        .where(h.bucket >= since).group_by(h.bucket).order_by(h.bucket)
    ).all()
    points = {r[0]: r for r in rows}
    # Current, not-yet-rolled-up hours come from raw telemetry.
    raw_bucket = func.date_trunc("hour", DeviceTelemetry.recorded_at)
    t = DeviceTelemetry
    raw = db.execute(
        select(raw_bucket.label("b"), func.avg(t.cpu_usage), func.avg(t.memory_usage), func.avg(t.storage_usage),
               func.avg(t.temperature_c), func.avg(t.latency_ms), func.count(func.distinct(t.device_pk)))
        .where(t.recorded_at >= since).group_by("b").order_by("b")
    ).all()
    for r in raw:
        points.setdefault(r[0], r)
    out = []
    for bucket in sorted(points):
        r = points[bucket]
        out.append({
            "timestamp": bucket, "cpu_usage": round(r[1] or 0, 1), "memory_usage": round(r[2] or 0, 1),
            "storage_usage": round(r[3] or 0, 1), "temperature_c": round(r[4] or 0, 1),
            "latency_ms": round(r[5] or 0, 1), "reporting_devices": r[6],
        })
    return out


@router.get("/top-devices")
def top_devices(
    metric: str = Query("cpu_usage", pattern="^(cpu_usage|memory_usage|storage_usage|temperature_c|latency_ms)$"),
    limit: int = Query(10, ge=1, le=50),
    db: Session = Depends(get_db),
    _: User = Depends(require(Permission.MONITORING_VIEW)),
):
    col = getattr(DeviceStatus, metric)
    rows = db.execute(
        select(Device.device_id, Device.serial_number, Device.model, Device.region, col, DeviceStatus.health_status)
        .join(DeviceStatus, DeviceStatus.device_pk == Device.id)
        .where(DeviceStatus.connection_status == "ONLINE", col.is_not(None))
        .order_by(col.desc()).limit(limit)
    ).all()
    return [
        {"device_id": r[0], "serial_number": r[1], "model": r[2], "region": r[3], "value": r[4], "health_status": r[5]}
        for r in rows
    ]


def _log_stmt(device_id, serial_number, severity, category, search, date_from, date_to):
    stmt = select(DeviceLog).join(Device, Device.id == DeviceLog.device_pk)
    if device_id:
        stmt = stmt.where(Device.device_id.ilike(f"%{escape_like(device_id.strip())}%", escape="\\"))
    if serial_number:
        stmt = stmt.where(Device.serial_number.ilike(f"%{escape_like(serial_number.strip())}%", escape="\\"))
    if severity:
        stmt = stmt.where(DeviceLog.severity.in_([s.strip().upper() for s in severity.split(",") if s.strip()]))
    if category:
        stmt = stmt.where(DeviceLog.category == category.upper())
    if search:
        stmt = stmt.where(DeviceLog.message.ilike(f"%{escape_like(search.strip())}%", escape="\\"))
    if date_from:
        stmt = stmt.where(DeviceLog.created_at >= date_from)
    if date_to:
        stmt = stmt.where(DeviceLog.created_at <= date_to)
    return stmt.order_by(DeviceLog.created_at.desc(), DeviceLog.id.desc())


@router.get("/logs", response_model=Page[DeviceLogOut])
def diagnostic_logs(
    device_id: str | None = Query(None, max_length=64),
    serial_number: str | None = Query(None, max_length=64),
    severity: str | None = Query(None, max_length=64),
    category: str | None = Query(None, max_length=32),
    search: str | None = Query(None, max_length=128),
    date_from: datetime | None = None,
    date_to: datetime | None = None,
    params: PageParams = Depends(),
    db: Session = Depends(get_db),
    _: User = Depends(require(Permission.MONITORING_VIEW)),
):
    rows, meta = paginate(db, _log_stmt(device_id, serial_number, severity, category, search, date_from, date_to), params)
    items = [
        DeviceLogOut.model_validate(r).model_copy(update={"device_id": r.device.device_id,
                                                         "serial_number": r.device.serial_number})
        for r in rows
    ]
    return {"items": items, **meta}


@router.get("/logs/export")
def export_logs(
    device_id: str | None = Query(None, max_length=64),
    serial_number: str | None = Query(None, max_length=64),
    severity: str | None = Query(None, max_length=64),
    category: str | None = Query(None, max_length=32),
    search: str | None = Query(None, max_length=128),
    date_from: datetime | None = None,
    date_to: datetime | None = None,
    db: Session = Depends(get_db),
    _: User = Depends(require(Permission.MONITORING_VIEW)),
):
    stmt = _log_stmt(device_id, serial_number, severity, category, search, date_from, date_to).limit(20000)
    rows = db.execute(stmt).unique().scalars().all()
    return csv_response(
        "bell-stb-diagnostic-logs.csv",
        ["Timestamp", "Device ID", "Serial Number", "Severity", "Category", "Component", "Message"],
        ([r.created_at, r.device.device_id, r.device.serial_number, r.severity, r.category, r.component, r.message]
         for r in rows),
    )


@router.get("/log-categories")
def log_categories(_: User = Depends(require(Permission.MONITORING_VIEW))):
    return LOG_CATEGORIES


@router.get("/devices/{device_id}/diagnostics")
def device_diagnostics(device_id: str, db: Session = Depends(get_db), _: User = Depends(require(Permission.MONITORING_VIEW))):
    device, latest = get_device_row(db, device_id)
    detail = serialize_device_detail(db, device, latest)
    s = get_settings_map(db)
    st = device.status
    online = st.connection_status == "ONLINE"

    def check(name: str, ok: bool, warn: bool, value: str, hint: str) -> dict:
        return {"check": name, "result": "PASS" if ok else ("WARN" if warn else "FAIL"), "value": value, "detail": hint}

    cpu_warn, mem_warn = setting_float(s, "cpu_warning_threshold"), setting_float(s, "memory_warning_threshold")
    checks = [
        check("Connectivity", online, st.connection_status == "REBOOTING", st.connection_status,
              "Device heartbeat received" if online else "No heartbeat from device"),
        check("CPU utilisation", st.cpu_usage < cpu_warn, st.cpu_usage < 95, f"{st.cpu_usage:.1f}%",
              f"Warning threshold {cpu_warn:.0f}%"),
        check("Memory utilisation", st.memory_usage < mem_warn, st.memory_usage < 95, f"{st.memory_usage:.1f}%",
              f"Warning threshold {mem_warn:.0f}%"),
        check("Storage utilisation", st.storage_usage < setting_float(s, "storage_warning_threshold"),
              st.storage_usage < 97, f"{st.storage_usage:.1f}%", "Free space for recordings and app cache"),
        check("Temperature", (st.temperature_c or 0) < 70, (st.temperature_c or 0) < setting_float(s, "temperature_critical_threshold"),
              f"{st.temperature_c or 0:.1f} C", "SoC temperature sensor"),
        check("Network latency", st.latency_ms < 60, st.latency_ms < 150, f"{st.latency_ms:.0f} ms", "Round trip to headend"),
        check("Packet loss", st.packet_loss_pct < 1, st.packet_loss_pct < 5, f"{st.packet_loss_pct:.1f}%", "Last heartbeat window"),
        check("Firmware", not detail["update_available"], True, device.firmware.version,
              "Up to date" if not detail["update_available"] else f"Update {detail['latest_firmware_version']} available"),
    ]
    since = utcnow() - timedelta(hours=24)
    errors = db.execute(
        select(DeviceLog).where(DeviceLog.device_pk == device.id, DeviceLog.severity.in_(["ERROR", "CRITICAL"]))
        .order_by(DeviceLog.created_at.desc()).limit(10)
    ).unique().scalars().all()
    crash_count = db.execute(
        select(func.count()).where(DeviceEvent.device_pk == device.id, DeviceEvent.event_type == "APP_CRASH",
                                   DeviceEvent.created_at >= since)
    ).scalar_one()
    return {
        "device": detail,
        "checks": checks,
        "app_crashes_24h": crash_count,
        "recent_errors": [
            {"id": e.id, "severity": e.severity, "category": e.category, "component": e.component, "message": e.message,
             "created_at": e.created_at} for e in errors
        ],
    }
