import ipaddress
import random
from datetime import datetime, timezone

from fastapi import HTTPException
from sqlalchemy import Select, and_, func, or_, select
from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import Session, aliased, contains_eager

from app.models import (
    Alert,
    Application,
    Device,
    DeviceEvent,
    DeviceStatus,
    FirmwareVersion,
    InstalledApplication,
)
from app.models.base import utcnow
from app.schemas.device import DeviceCreate

DEVICE_SORT_COLUMNS = {
    "device_id": Device.device_id,
    "serial_number": Device.serial_number,
    "mac_address": Device.mac_address,
    "model": Device.model,
    "hardware_version": Device.hardware_version,
    "firmware_version": FirmwareVersion.version,
    "ip_address": Device.ip_address,
    "connection_status": DeviceStatus.connection_status,
    "health_status": DeviceStatus.health_status,
    "last_seen_at": DeviceStatus.last_seen_at,
    "customer_ref": Device.customer_ref,
    "region": Device.region,
    "registered_at": Device.registered_at,
}

LatestFirmware = aliased(FirmwareVersion, name="latest_fw")


def escape_like(value: str) -> str:
    return value.replace("\\", "\\\\").replace("%", "\\%").replace("_", "\\_")


def device_select() -> Select:
    return (
        select(Device, LatestFirmware)
        .join(Device.status)
        .join(Device.firmware)
        .outerjoin(LatestFirmware, and_(LatestFirmware.model == Device.model, LatestFirmware.is_latest.is_(True)))
        .options(contains_eager(Device.status), contains_eager(Device.firmware))
    )


def apply_device_filters(
    stmt: Select,
    *,
    search: str | None = None,
    status: str | None = None,
    model: str | None = None,
    firmware: str | None = None,
    region: str | None = None,
    health: str | None = None,
    update_available: bool | None = None,
) -> Select:
    if search:
        term = f"%{escape_like(search.strip())}%"
        stmt = stmt.where(
            or_(
                Device.device_id.ilike(term, escape="\\"),
                Device.serial_number.ilike(term, escape="\\"),
                Device.mac_address.ilike(term, escape="\\"),
                Device.customer_ref.ilike(term, escape="\\"),
                Device.ip_address.ilike(term, escape="\\"),
            )
        )
    if status:
        stmt = stmt.where(DeviceStatus.connection_status == status.upper())
    if model:
        stmt = stmt.where(Device.model == model)
    if firmware:
        stmt = stmt.where(FirmwareVersion.version == firmware)
    if region:
        stmt = stmt.where(Device.region == region)
    if health:
        stmt = stmt.where(DeviceStatus.health_status == health.upper())
    if update_available is True:
        stmt = stmt.where(LatestFirmware.id.is_not(None), LatestFirmware.id != Device.firmware_version_id)
    elif update_available is False:
        stmt = stmt.where(or_(LatestFirmware.id.is_(None), LatestFirmware.id == Device.firmware_version_id))
    return stmt


def serialize_device(device: Device, latest: FirmwareVersion | None) -> dict:
    s = device.status
    return {
        "id": device.id,
        "device_id": device.device_id,
        "serial_number": device.serial_number,
        "mac_address": device.mac_address,
        "model": device.model,
        "hardware_version": device.hardware_version,
        "firmware_version": device.firmware.version,
        "os_version": device.os_version,
        "ip_address": device.ip_address,
        "connection_status": s.connection_status,
        "health_status": s.health_status,
        "last_seen_at": s.last_seen_at,
        "customer_ref": device.customer_ref,
        "region": device.region,
        "city": device.city,
        "simulation_profile": device.simulation_profile,
        "registered_at": device.registered_at,
        "update_available": bool(latest and latest.id != device.firmware_version_id),
        "latest_firmware_version": latest.version if latest else None,
    }


def serialize_device_detail(db: Session, device: Device, latest: FirmwareVersion | None) -> dict:
    s = device.status
    data = serialize_device(device, latest)
    uptime = None
    if s.connection_status == "ONLINE" and s.last_boot_at:
        uptime = int((datetime.now(timezone.utc) - s.last_boot_at).total_seconds())
    open_alerts = db.execute(
        select(func.count(Alert.id)).where(Alert.device_pk == device.id, Alert.status != "RESOLVED")
    ).scalar_one()
    data.update(
        firmware_release_date=device.firmware.release_date,
        last_boot_at=s.last_boot_at,
        uptime_seconds=uptime,
        last_connected_at=s.last_connected_at,
        last_disconnected_at=s.last_disconnected_at,
        cpu_usage=s.cpu_usage,
        memory_usage=s.memory_usage,
        storage_usage=s.storage_usage,
        temperature_c=s.temperature_c,
        network_type=s.network_type,
        signal_strength_dbm=s.signal_strength_dbm,
        bandwidth_mbps=s.bandwidth_mbps,
        latency_ms=s.latency_ms,
        packet_loss_pct=s.packet_loss_pct,
        open_alerts=open_alerts,
    )
    return data


def get_device_row(db: Session, device_id: str) -> tuple[Device, FirmwareVersion | None]:
    row = db.execute(device_select().where(Device.device_id == device_id)).unique().first()
    if row is None:
        raise HTTPException(404, f"Device '{device_id}' not found")
    return row[0], row[1]


def get_device(db: Session, device_id: str) -> Device:
    device = db.execute(select(Device).where(Device.device_id == device_id)).unique().scalar_one_or_none()
    if device is None:
        raise HTTPException(404, f"Device '{device_id}' not found")
    return device


def provision_device(db: Session, body: DeviceCreate, description: str) -> Device:
    """Create a device with its status row and default application bundle (flushes, does not commit)."""
    try:
        ipaddress.ip_address(body.ip_address)
    except ValueError:
        raise HTTPException(422, "Invalid IP address")
    firmware = db.execute(
        select(FirmwareVersion).where(FirmwareVersion.model == body.model, FirmwareVersion.is_latest.is_(True))
    ).scalar_one_or_none()
    if firmware is None:
        raise HTTPException(422, f"Unknown device model '{body.model}'")
    now = utcnow()
    online = body.initial_status == "ONLINE"
    device = Device(
        device_id=f"STB-{body.serial_number[-8:]}", serial_number=body.serial_number, mac_address=body.mac_address,
        model=body.model, hardware_version=body.hardware_version, firmware_version_id=firmware.id,
        os_version=firmware.os_version, ip_address=body.ip_address, customer_ref=body.customer_ref,
        region=body.region, city=body.city, simulation_profile=body.simulation_profile, registered_at=now,
    )
    device.status = DeviceStatus(
        connection_status=body.initial_status, health_status="HEALTHY",
        last_seen_at=now if online else None, last_boot_at=now if online else None,
        last_connected_at=now if online else None,
        cpu_usage=round(random.uniform(8, 25), 1) if online else 0,
        memory_usage=round(random.uniform(30, 50), 1) if online else 0,
        storage_usage=round(random.uniform(20, 40), 1), temperature_c=round(random.uniform(40, 50), 1),
        network_type="ETHERNET", bandwidth_mbps=round(random.uniform(80, 300), 1) if online else 0,
        latency_ms=round(random.uniform(8, 20), 1) if online else 0,
    )
    db.add(device)
    try:
        db.flush()
    except IntegrityError:
        db.rollback()
        raise HTTPException(409, "A device with this serial number, MAC address or device ID already exists")
    for app in db.execute(select(Application).where(Application.category.in_(["Live TV", "System"]))).scalars():
        db.add(InstalledApplication(device_pk=device.id, application_id=app.id, version=app.latest_version,
                                    status="INSTALLED", installed_at=now))
    db.add(DeviceEvent(device_pk=device.id, event_type="REGISTERED", severity="INFO", description=description,
                       created_at=now))
    return device
