"""Device gateway API.

This is the integration boundary between the portal and the device fleet. The bundled STB simulator
uses it today; a production integration service (e.g. a TR-069/USP ACS connector) would implement the same
contract. Authenticated with a shared gateway key, never with user JWTs.
"""

from datetime import datetime
from typing import Literal

from fastapi import APIRouter, Depends, HTTPException, Query
from pydantic import BaseModel, Field
from sqlalchemy import select
from sqlalchemy.orm import Session

from app.api.deps import require_gateway_key
from app.core.database import get_db
from app.models import (
    Application,
    DeploymentTarget,
    Device,
    DeviceCommand,
    DeviceEvent,
    DeviceLog,
    DeviceStatus,
    DeviceTelemetry,
    FirmwareDeployment,
    FirmwareVersion,
    InstalledApplication,
)
from app.models.base import utcnow
from app.schemas.device import DeviceCreate
from app.services.alerts import auto_resolve, get_settings_map, raise_alert, setting_float
from app.services.audit import record_audit
from app.services.commands import transition
from app.services.deployments import finalize_if_done
from app.services.devices import provision_device

router = APIRouter(prefix="/api/gateway", tags=["Device Gateway (integration)"], dependencies=[Depends(require_gateway_key)])


class HeartbeatReport(BaseModel):
    device_id: str
    connection_status: Literal["ONLINE", "OFFLINE", "REBOOTING"]
    cpu_usage: float = Field(0, ge=0, le=100)
    memory_usage: float = Field(0, ge=0, le=100)
    storage_usage: float = Field(0, ge=0, le=100)
    temperature_c: float | None = Field(None, ge=-20, le=130)
    network_type: Literal["ETHERNET", "WIFI"] = "ETHERNET"
    signal_strength_dbm: float | None = Field(None, ge=-120, le=0)
    bandwidth_mbps: float = Field(0, ge=0, le=10000)
    latency_ms: float = Field(0, ge=0, le=10000)
    packet_loss_pct: float = Field(0, ge=0, le=100)
    boot_time: datetime | None = None
    record_telemetry: bool = False


class HeartbeatBatch(BaseModel):
    reports: list[HeartbeatReport] = Field(max_length=2000)


class LogEntry(BaseModel):
    severity: Literal["INFO", "WARNING", "ERROR", "CRITICAL"]
    category: str = Field(max_length=32)
    component: str = Field(max_length=64)
    message: str = Field(max_length=2000)


class EventReport(BaseModel):
    device_id: str
    event_type: str = Field(max_length=32)
    severity: Literal["INFO", "WARNING", "ERROR", "CRITICAL"] = "INFO"
    description: str = Field(max_length=2000)
    package_id: str | None = None
    log: LogEntry | None = None


class EventBatch(BaseModel):
    events: list[EventReport] = Field(default_factory=list, max_length=2000)
    logs: list[dict] = Field(default_factory=list, max_length=5000)


class CommandStatusUpdate(BaseModel):
    status: Literal["SENT", "ACKNOWLEDGED", "EXECUTING", "SUCCESSFUL", "FAILED"]
    message: str | None = Field(None, max_length=1000)


class TargetStatusUpdate(BaseModel):
    status: Literal["DOWNLOADING", "INSTALLING", "SUCCESS", "FAILED"]
    error_message: str | None = Field(None, max_length=1000)


def _health(r: HeartbeatReport, s: dict) -> str:
    if r.cpu_usage >= 95 or r.memory_usage >= 95 or (r.temperature_c or 0) >= setting_float(s, "temperature_critical_threshold"):
        return "CRITICAL"
    if (
        r.cpu_usage >= setting_float(s, "cpu_warning_threshold")
        or r.memory_usage >= setting_float(s, "memory_warning_threshold")
        or r.storage_usage >= setting_float(s, "storage_warning_threshold")
        or r.packet_loss_pct >= 5
    ):
        return "WARNING"
    return "HEALTHY"


@router.get("/devices")
def gateway_devices(db: Session = Depends(get_db)):
    devices = db.execute(select(Device)).unique().scalars().all()
    apps: dict[int, list[str]] = {}
    for device_pk, package_id in db.execute(
        select(InstalledApplication.device_pk, Application.package_id)
        .join(Application, Application.id == InstalledApplication.application_id)
    ).all():
        apps.setdefault(device_pk, []).append(package_id)
    return [
        {
            "device_id": d.device_id, "model": d.model, "simulation_profile": d.simulation_profile,
            "firmware_version": d.firmware.version, "connection_status": d.status.connection_status,
            "network_type": d.status.network_type, "cpu_usage": d.status.cpu_usage,
            "memory_usage": d.status.memory_usage, "storage_usage": d.status.storage_usage,
            "temperature_c": d.status.temperature_c, "signal_strength_dbm": d.status.signal_strength_dbm,
            "last_boot_at": d.status.last_boot_at, "applications": apps.get(d.id, []),
        }
        for d in devices
    ]


@router.post("/devices/register", status_code=201)
def self_register(body: DeviceCreate, db: Session = Depends(get_db)):
    device = provision_device(db, body, "Device self-registered through the device gateway")
    record_audit(db, user=None, username="device-gateway", action="DEVICE_REGISTERED", target_type="device",
                 target_id=device.device_id, details={"serial_number": device.serial_number, "model": device.model,
                                                      "source": "gateway"})
    db.commit()
    return {"device_id": device.device_id, "model": device.model, "simulation_profile": device.simulation_profile,
            "connection_status": device.status.connection_status}


@router.post("/heartbeats")
def heartbeats(batch: HeartbeatBatch, db: Session = Depends(get_db)):
    ids = [r.device_id for r in batch.reports]
    devices = {d.device_id: d for d in db.execute(select(Device).where(Device.device_id.in_(ids))).unique().scalars()}
    s = get_settings_map(db)
    offline_alerts = s.get("offline_alerts_enabled", "true") == "true"
    cpu_alert, mem_alert = setting_float(s, "cpu_alert_threshold"), setting_float(s, "memory_alert_threshold")
    now = utcnow()
    processed = 0
    for r in batch.reports:
        device = devices.get(r.device_id)
        if device is None:
            continue
        processed += 1
        st: DeviceStatus = device.status
        prev = st.connection_status
        st.connection_status = r.connection_status
        if r.connection_status in ("ONLINE", "REBOOTING"):
            st.last_seen_at = now
        if r.boot_time:
            st.last_boot_at = r.boot_time
        if r.connection_status == "ONLINE":
            st.cpu_usage, st.memory_usage, st.storage_usage = r.cpu_usage, r.memory_usage, r.storage_usage
            st.temperature_c, st.network_type = r.temperature_c, r.network_type
            st.signal_strength_dbm = r.signal_strength_dbm if r.network_type == "WIFI" else None
            st.bandwidth_mbps, st.latency_ms, st.packet_loss_pct = r.bandwidth_mbps, r.latency_ms, r.packet_loss_pct
            st.health_status = _health(r, s)
            if r.record_telemetry:
                db.add(DeviceTelemetry(device_pk=device.id, recorded_at=now, cpu_usage=r.cpu_usage,
                                       memory_usage=r.memory_usage, storage_usage=r.storage_usage,
                                       temperature_c=r.temperature_c, latency_ms=r.latency_ms,
                                       bandwidth_mbps=r.bandwidth_mbps))
            if r.cpu_usage >= cpu_alert:
                raise_alert(db, device, "HIGH_CPU", "CRITICAL" if r.cpu_usage >= 97 else "WARNING", "High CPU usage",
                            f"CPU utilisation at {r.cpu_usage:.0f}% (threshold {cpu_alert:.0f}%)")
            elif r.cpu_usage < cpu_alert - 10:
                auto_resolve(db, device.id, "HIGH_CPU", f"Auto-resolved: CPU back to {r.cpu_usage:.0f}%")
            if r.memory_usage >= mem_alert:
                raise_alert(db, device, "HIGH_MEMORY", "CRITICAL" if r.memory_usage >= 97 else "WARNING",
                            "High memory usage", f"Memory utilisation at {r.memory_usage:.0f}% (threshold {mem_alert:.0f}%)")
            elif r.memory_usage < mem_alert - 10:
                auto_resolve(db, device.id, "HIGH_MEMORY", f"Auto-resolved: memory back to {r.memory_usage:.0f}%")
        if prev != "ONLINE" and r.connection_status == "ONLINE":
            st.last_connected_at = now
            db.add(DeviceEvent(device_pk=device.id, event_type="CONNECTED", severity="INFO", created_at=now,
                               description=f"Device connected via {r.network_type.lower()} ({device.ip_address})"))
            auto_resolve(db, device.id, "DEVICE_OFFLINE", "Auto-resolved: device reconnected")
            auto_resolve(db, device.id, "NETWORK_DISCONNECT", "Auto-resolved: network restored")
        elif prev != "OFFLINE" and r.connection_status == "OFFLINE":
            st.last_disconnected_at = now
            db.add(DeviceEvent(device_pk=device.id, event_type="DISCONNECTED", severity="WARNING", created_at=now,
                               description="Heartbeat lost - device disconnected"))
            if offline_alerts:
                raise_alert(db, device, "DEVICE_OFFLINE", "WARNING", "Device offline",
                            f"{device.device_id} ({device.model}) stopped sending heartbeats")
    db.commit()
    return {"processed": processed}


EVENT_ALERTS = {
    "APP_CRASH": ("APP_CRASH", "WARNING", "Application crash"),
    "CRITICAL_ERROR": ("CRITICAL_ERROR", "CRITICAL", "Device critical error"),
    "NETWORK_LOSS": ("NETWORK_DISCONNECT", "WARNING", "Network disconnection"),
}


@router.post("/events")
def events(batch: EventBatch, db: Session = Depends(get_db)):
    ids = {e.device_id for e in batch.events} | {str(l.get("device_id")) for l in batch.logs}
    devices = {d.device_id: d for d in db.execute(select(Device).where(Device.device_id.in_(ids))).unique().scalars()}
    now = utcnow()
    for e in batch.events:
        device = devices.get(e.device_id)
        if device is None:
            continue
        db.add(DeviceEvent(device_pk=device.id, event_type=e.event_type.upper(), severity=e.severity,
                           description=e.description, created_at=now))
        if e.log:
            db.add(DeviceLog(device_pk=device.id, created_at=now, **e.log.model_dump()))
        if e.event_type == "APP_CRASH" and e.package_id:
            ia = db.execute(
                select(InstalledApplication).join(Application, Application.id == InstalledApplication.application_id)
                .where(InstalledApplication.device_pk == device.id, Application.package_id == e.package_id)
            ).unique().scalar_one_or_none()
            if ia:
                ia.crash_count_7d += 1
        if e.event_type in EVENT_ALERTS:
            cat, sev, title = EVENT_ALERTS[e.event_type]
            raise_alert(db, device, cat, sev, title, e.description)
            if cat == "CRITICAL_ERROR":
                device.status.health_status = "CRITICAL"
    for raw in batch.logs:
        try:
            entry = LogEntry.model_validate(raw)
        except ValueError:
            continue
        device = devices.get(str(raw.get("device_id")))
        if device:
            db.add(DeviceLog(device_pk=device.id, created_at=now, **entry.model_dump()))
    db.commit()
    return {"accepted": len(batch.events), "logs": len(batch.logs)}


@router.get("/commands/pending")
def pending_commands(limit: int = Query(200, ge=1, le=1000), db: Session = Depends(get_db)):
    rows = db.execute(
        select(DeviceCommand).where(DeviceCommand.status == "QUEUED").order_by(DeviceCommand.created_at).limit(limit)
    ).unique().scalars().all()
    return [
        {"command_code": c.command_code, "device_id": c.device.device_id, "command_type": c.command_type,
         "parameters": c.parameters or {}, "expires_at": c.expires_at}
        for c in rows
    ]


@router.post("/commands/{command_code}/status")
def command_status(command_code: str, body: CommandStatusUpdate, db: Session = Depends(get_db)):
    cmd = db.execute(select(DeviceCommand).where(DeviceCommand.command_code == command_code)).unique().scalar_one_or_none()
    if cmd is None:
        raise HTTPException(404, "Command not found")
    transition(db, cmd, body.status, body.message)
    db.commit()
    return {"command_code": cmd.command_code, "status": cmd.status}


@router.get("/deployments/targets")
def deployment_targets(limit: int = Query(500, ge=1, le=2000), db: Session = Depends(get_db)):
    rows = db.execute(
        select(DeploymentTarget, FirmwareDeployment.deployment_code, Device.device_id, FirmwareVersion.version,
               FirmwareVersion.os_version)
        .join(FirmwareDeployment, FirmwareDeployment.id == DeploymentTarget.deployment_id)
        .join(Device, Device.id == DeploymentTarget.device_pk)
        .join(FirmwareVersion, FirmwareVersion.id == DeploymentTarget.target_firmware_version_id)
        .where(FirmwareDeployment.status == "IN_PROGRESS",
               DeploymentTarget.status.in_(["PENDING", "DOWNLOADING", "INSTALLING"]))
        .order_by(DeploymentTarget.id).limit(limit)
    ).unique().all()
    return [
        {"target_id": t.id, "deployment_code": code, "device_id": did, "status": t.status,
         "target_version": ver, "target_os_version": osv}
        for t, code, did, ver, osv in rows
    ]


@router.post("/deployments/targets/{target_id}/status")
def target_status(target_id: int, body: TargetStatusUpdate, db: Session = Depends(get_db)):
    t = db.get(DeploymentTarget, target_id)
    if t is None:
        raise HTTPException(404, "Deployment target not found")
    if t.status in ("SUCCESS", "FAILED"):
        raise HTTPException(409, f"Target already {t.status}")
    if t.deployment.status != "IN_PROGRESS":
        raise HTTPException(409, f"Deployment is {t.deployment.status}")
    t.status = body.status
    t.error_message = body.error_message
    t.updated_at = utcnow()
    fw = db.get(FirmwareVersion, t.target_firmware_version_id)
    device = t.device
    if body.status == "SUCCESS":
        old = device.firmware.version
        device.firmware_version_id = fw.id
        device.os_version = fw.os_version
        db.add(DeviceEvent(device_pk=device.id, event_type="FIRMWARE_UPDATED", severity="INFO",
                           description=f"Firmware updated {old} -> {fw.version} ({t.deployment.deployment_code})"))
        if fw.is_latest:
            auto_resolve(db, device.id, "FIRMWARE_UPDATE", f"Auto-resolved: updated to {fw.version}")
    elif body.status == "FAILED":
        db.add(DeviceEvent(device_pk=device.id, event_type="FIRMWARE_UPDATE_FAILED", severity="ERROR",
                           description=f"Firmware {fw.version} installation failed: {body.error_message or 'unknown'}"))
        db.add(DeviceLog(device_pk=device.id, severity="ERROR", category="FIRMWARE", component="fw-updater",
                         message=f"Update to {fw.version} failed: {body.error_message or 'unknown error'}"))
    db.flush()
    finalize_if_done(db, t.deployment)
    db.commit()
    return {"target_id": t.id, "status": t.status}
