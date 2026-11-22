from datetime import datetime, timedelta, timezone
from typing import Literal

from fastapi import APIRouter, Depends, HTTPException, Query, Request
from sqlalchemy import delete, select
from sqlalchemy.orm import Session

from app.api.deps import require
from app.core.database import get_db
from app.core.permissions import Permission
from app.models import (
    Alert,
    Device,
    DeviceCommand,
    DeviceEvent,
    DeviceLog,
    DeviceTelemetry,
    DeviceTelemetryHourly,
    FirmwareVersion,
    InstalledApplication,
    User,
)
from app.models.base import utcnow
from app.schemas.common import Message, Page
from app.schemas.device import (
    DeviceCreate,
    DeviceDetail,
    DeviceEventOut,
    DeviceFilters,
    DeviceListItem,
    DeviceLogOut,
    DeviceUpdate,
    InstalledAppOut,
    NetworkInfo,
    SoftwareInfo,
    TelemetryResponse,
)
from app.schemas.ops import AlertOut, CommandOut
from app.services.alerts import serialize_alert
from app.services.audit import record_audit
from app.services.commands import serialize_command
from app.services.devices import (
    DEVICE_SORT_COLUMNS,
    apply_device_filters,
    device_select,
    get_device,
    get_device_row,
    provision_device,
    serialize_device,
    serialize_device_detail,
)
from app.services.query import PageParams, apply_sort, csv_response, paginate, validate_sort

router = APIRouter(prefix="/api/devices", tags=["Devices"])

SortDir = Literal["asc", "desc"]


def _filtered(search, status, model, firmware, region, health, update_available, sort_by, sort_dir):
    validate_sort(sort_by, DEVICE_SORT_COLUMNS)
    stmt = apply_device_filters(
        device_select(),
        search=search,
        status=status,
        model=model,
        firmware=firmware,
        region=region,
        health=health,
        update_available=update_available,
    )
    return apply_sort(stmt, sort_by, sort_dir, DEVICE_SORT_COLUMNS, Device.device_id)


@router.get("", response_model=Page[DeviceListItem])
def list_devices(
    search: str | None = Query(None, max_length=64),
    status: str | None = Query(None, pattern="^(ONLINE|OFFLINE|REBOOTING|online|offline|rebooting)$"),
    model: str | None = None,
    firmware: str | None = None,
    region: str | None = None,
    health: str | None = Query(None, pattern="^(HEALTHY|WARNING|CRITICAL)$"),
    update_available: bool | None = None,
    sort_by: str | None = None,
    sort_dir: SortDir = "asc",
    params: PageParams = Depends(),
    db: Session = Depends(get_db),
    _: User = Depends(require(Permission.DEVICES_VIEW)),
):
    stmt = _filtered(search, status, model, firmware, region, health, update_available, sort_by, sort_dir)
    rows, meta = paginate(db, stmt, params, scalars=False)
    return {"items": [serialize_device(d, latest) for d, latest in rows], **meta}


@router.get("/export")
def export_devices(
    request: Request,
    search: str | None = Query(None, max_length=64),
    status: str | None = Query(None, pattern="^(ONLINE|OFFLINE|REBOOTING|online|offline|rebooting)$"),
    model: str | None = None,
    firmware: str | None = None,
    region: str | None = None,
    health: str | None = Query(None, pattern="^(HEALTHY|WARNING|CRITICAL)$"),
    update_available: bool | None = None,
    sort_by: str | None = None,
    sort_dir: SortDir = "asc",
    db: Session = Depends(get_db),
    user: User = Depends(require(Permission.DEVICES_VIEW)),
):
    stmt = _filtered(search, status, model, firmware, region, health, update_available, sort_by, sort_dir)
    rows = db.execute(stmt).unique().all()
    record_audit(db, user=user, action="DEVICE_EXPORT", target_type="device", request=request,
                 details={"rows": len(rows), "filters": dict(request.query_params)})
    db.commit()
    headers = ["Device ID", "Serial Number", "MAC Address", "Model", "Hardware Version", "Firmware Version",
               "OS Version", "IP Address", "Connection Status", "Health", "Last Seen", "Customer Reference",
               "Region", "City", "Data Source"]
    return csv_response(
        f"bell-stb-devices-{datetime.now(timezone.utc):%Y%m%d-%H%M%S}.csv",
        headers,
        (
            [d.device_id, d.serial_number, d.mac_address, d.model, d.hardware_version, d.firmware.version,
             d.os_version, d.ip_address, d.status.connection_status, d.status.health_status,
             d.status.last_seen_at, d.customer_ref, d.region, d.city, "SIMULATED"]
            for d, _latest in rows
        ),
    )


@router.get("/filters", response_model=DeviceFilters)
def device_filters(db: Session = Depends(get_db), _: User = Depends(require(Permission.DEVICES_VIEW))):
    models = db.execute(select(Device.model).distinct().order_by(Device.model)).scalars().all()
    regions = db.execute(select(Device.region).distinct().order_by(Device.region)).scalars().all()
    versions = db.execute(
        select(FirmwareVersion.version).join(Device, Device.firmware_version_id == FirmwareVersion.id)
        .distinct().order_by(FirmwareVersion.version)
    ).scalars().all()
    return {
        "models": models,
        "firmware_versions": versions,
        "regions": regions,
        "statuses": ["ONLINE", "OFFLINE", "REBOOTING"],
        "health_statuses": ["HEALTHY", "WARNING", "CRITICAL"],
    }


@router.post("", response_model=DeviceDetail, status_code=201)
def register_device(
    body: DeviceCreate,
    request: Request,
    db: Session = Depends(get_db),
    user: User = Depends(require(Permission.DEVICES_MANAGE)),
):
    device = provision_device(db, body, f"Device registered by {user.username}")
    record_audit(db, user=user, action="DEVICE_REGISTERED", target_type="device", target_id=device.device_id,
                 request=request, details={"serial_number": device.serial_number, "model": device.model,
                                           "simulation_profile": device.simulation_profile})
    db.commit()
    d, latest = get_device_row(db, device.device_id)
    return serialize_device_detail(db, d, latest)


@router.get("/{device_id}", response_model=DeviceDetail)
def device_detail(device_id: str, db: Session = Depends(get_db), _: User = Depends(require(Permission.DEVICES_VIEW))):
    d, latest = get_device_row(db, device_id)
    return serialize_device_detail(db, d, latest)


@router.patch("/{device_id}", response_model=DeviceDetail)
def update_device(
    device_id: str,
    body: DeviceUpdate,
    request: Request,
    db: Session = Depends(get_db),
    user: User = Depends(require(Permission.DEVICES_MANAGE)),
):
    device = get_device(db, device_id)
    changes = body.model_dump(exclude_unset=True, exclude_none=True)
    for k, v in changes.items():
        setattr(device, k, v)
    record_audit(db, user=user, action="DEVICE_UPDATED", target_type="device", target_id=device_id,
                 request=request, details=changes)
    db.commit()
    d, latest = get_device_row(db, device_id)
    return serialize_device_detail(db, d, latest)


@router.delete("/{device_id}", response_model=Message)
def decommission_device(
    device_id: str,
    request: Request,
    db: Session = Depends(get_db),
    user: User = Depends(require(Permission.DEVICES_MANAGE)),
):
    device = get_device(db, device_id)
    serial = device.serial_number
    db.execute(delete(Device).where(Device.id == device.id))
    record_audit(db, user=user, action="DEVICE_DECOMMISSIONED", target_type="device", target_id=device_id,
                 request=request, details={"serial_number": serial})
    db.commit()
    return {"message": f"Device {device_id} decommissioned"}


@router.get("/{device_id}/network", response_model=NetworkInfo)
def device_network(device_id: str, db: Session = Depends(get_db), _: User = Depends(require(Permission.DEVICES_VIEW))):
    d = get_device(db, device_id)
    s = d.status
    history = db.execute(
        select(DeviceEvent)
        .where(DeviceEvent.device_pk == d.id, DeviceEvent.event_type.in_(["CONNECTED", "DISCONNECTED", "NETWORK_CHANGE"]))
        .order_by(DeviceEvent.created_at.desc())
        .limit(50)
    ).unique().scalars().all()
    return {
        "device_id": d.device_id,
        "ip_address": d.ip_address,
        "mac_address": d.mac_address,
        "connection_status": s.connection_status,
        "network_type": s.network_type,
        "signal_strength_dbm": s.signal_strength_dbm,
        "bandwidth_mbps": s.bandwidth_mbps,
        "latency_ms": s.latency_ms,
        "packet_loss_pct": s.packet_loss_pct,
        "last_connected_at": s.last_connected_at,
        "last_disconnected_at": s.last_disconnected_at,
        "connection_history": [DeviceEventOut.model_validate(e) for e in history],
    }


def _installed_apps(db: Session, device_pk: int) -> list[dict]:
    rows = db.execute(
        select(InstalledApplication).where(InstalledApplication.device_pk == device_pk)
    ).unique().scalars().all()
    rows.sort(key=lambda r: r.application.name)
    return [
        {
            "application_id": r.application_id,
            "name": r.application.name,
            "package_id": r.application.package_id,
            "category": r.application.category,
            "version": r.version,
            "latest_version": r.application.latest_version,
            "status": r.status,
            "update_available": r.version != r.application.latest_version,
            "installed_at": r.installed_at,
            "last_used_at": r.last_used_at,
            "usage_minutes_7d": r.usage_minutes_7d,
            "crash_count_7d": r.crash_count_7d,
        }
        for r in rows
    ]


@router.get("/{device_id}/applications", response_model=list[InstalledAppOut])
def device_applications(device_id: str, db: Session = Depends(get_db), _: User = Depends(require(Permission.DEVICES_VIEW))):
    return _installed_apps(db, get_device(db, device_id).id)


@router.get("/{device_id}/software", response_model=SoftwareInfo)
def device_software(device_id: str, db: Session = Depends(get_db), _: User = Depends(require(Permission.DEVICES_VIEW))):
    d, latest = get_device_row(db, device_id)
    return {
        "firmware_version": d.firmware.version,
        "firmware_release_date": d.firmware.release_date,
        "os_version": d.os_version,
        "latest_firmware_version": latest.version if latest else None,
        "latest_os_version": latest.os_version if latest else None,
        "update_available": bool(latest and latest.id != d.firmware_version_id),
        "applications": _installed_apps(db, d.id),
    }


@router.get("/{device_id}/telemetry", response_model=TelemetryResponse)
def device_telemetry(
    device_id: str,
    hours: int = Query(24, ge=1, le=24 * 90),
    db: Session = Depends(get_db),
    _: User = Depends(require(Permission.DEVICES_VIEW)),
):
    d = get_device(db, device_id)
    since = utcnow() - timedelta(hours=hours)
    points: list[dict] = []
    if hours <= 24:
        rows = db.execute(
            select(DeviceTelemetry)
            .where(DeviceTelemetry.device_pk == d.id, DeviceTelemetry.recorded_at >= since)
            .order_by(DeviceTelemetry.recorded_at)
        ).scalars().all()
        points = [
            {"timestamp": r.recorded_at, "cpu_usage": r.cpu_usage, "memory_usage": r.memory_usage,
             "storage_usage": r.storage_usage, "temperature_c": r.temperature_c, "latency_ms": r.latency_ms}
            for r in rows
        ]
        resolution = "raw"
    if not points:
        rows = db.execute(
            select(DeviceTelemetryHourly)
            .where(DeviceTelemetryHourly.device_pk == d.id, DeviceTelemetryHourly.bucket >= since)
            .order_by(DeviceTelemetryHourly.bucket)
        ).scalars().all()
        points = [
            {"timestamp": r.bucket, "cpu_usage": r.avg_cpu, "memory_usage": r.avg_memory,
             "storage_usage": r.avg_storage, "temperature_c": r.avg_temperature, "latency_ms": r.avg_latency}
            for r in rows
        ]
        resolution = "hourly"
    return {"device_id": d.device_id, "resolution": resolution, "points": points}


@router.get("/{device_id}/events", response_model=Page[DeviceEventOut])
def device_events(
    device_id: str,
    event_type: str | None = None,
    params: PageParams = Depends(),
    db: Session = Depends(get_db),
    _: User = Depends(require(Permission.DEVICES_VIEW)),
):
    d = get_device(db, device_id)
    stmt = select(DeviceEvent).where(DeviceEvent.device_pk == d.id)
    if event_type:
        types = [t.strip().upper() for t in event_type.split(",") if t.strip()]
        stmt = stmt.where(DeviceEvent.event_type.in_(types))
    rows, meta = paginate(db, stmt.order_by(DeviceEvent.created_at.desc(), DeviceEvent.id.desc()), params)
    items = [DeviceEventOut.model_validate(e).model_copy(update={"device_id": d.device_id}) for e in rows]
    return {"items": items, **meta}


@router.get("/{device_id}/logs", response_model=Page[DeviceLogOut])
def device_logs(
    device_id: str,
    severity: str | None = Query(None, pattern="^(INFO|WARNING|ERROR|CRITICAL)$"),
    params: PageParams = Depends(),
    db: Session = Depends(get_db),
    _: User = Depends(require(Permission.DEVICES_VIEW)),
):
    d = get_device(db, device_id)
    stmt = select(DeviceLog).where(DeviceLog.device_pk == d.id)
    if severity:
        stmt = stmt.where(DeviceLog.severity == severity)
    rows, meta = paginate(db, stmt.order_by(DeviceLog.created_at.desc(), DeviceLog.id.desc()), params)
    items = [
        DeviceLogOut.model_validate(r).model_copy(update={"device_id": d.device_id, "serial_number": d.serial_number})
        for r in rows
    ]
    return {"items": items, **meta}


@router.get("/{device_id}/commands", response_model=Page[CommandOut])
def device_commands(
    device_id: str,
    params: PageParams = Depends(),
    db: Session = Depends(get_db),
    _: User = Depends(require(Permission.COMMANDS_VIEW)),
):
    d = get_device(db, device_id)
    stmt = select(DeviceCommand).where(DeviceCommand.device_pk == d.id).order_by(DeviceCommand.created_at.desc())
    rows, meta = paginate(db, stmt, params)
    return {"items": [serialize_command(c) for c in rows], **meta}


@router.get("/{device_id}/alerts", response_model=list[AlertOut])
def device_alerts(device_id: str, db: Session = Depends(get_db), _: User = Depends(require(Permission.ALERTS_VIEW))):
    d = get_device(db, device_id)
    rows = db.execute(
        select(Alert).where(Alert.device_pk == d.id).order_by(Alert.created_at.desc()).limit(50)
    ).unique().scalars().all()
    return [serialize_alert(a) for a in rows]
