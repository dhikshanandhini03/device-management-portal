from fastapi import APIRouter, Depends, HTTPException, Query, Request
from sqlalchemy import select
from sqlalchemy.orm import Session

from app.api.deps import require
from app.core.database import get_db
from app.core.permissions import Permission, has_permission
from app.models import Application, Device, DeviceCommand, DeviceCommandHistory, InstalledApplication, User
from app.schemas.common import Page
from app.schemas.ops import COMMAND_STATUSES, TERMINAL_COMMAND_STATUSES, CommandCreate, CommandOut
from app.services.alerts import get_settings_map, new_code
from app.services.audit import record_audit, record_audit_isolated
from app.services.commands import COMMAND_LABELS, compute_expiry, serialize_command
from app.services.devices import escape_like, get_device
from app.services.query import PageParams, paginate

router = APIRouter(prefix="/api/commands", tags=["Remote Commands"])

APP_COMMANDS = {"RESTART_APP", "CLEAR_APP_CACHE"}


@router.get("/types")
def command_types(_: User = Depends(require(Permission.COMMANDS_VIEW))):
    return [
        {"type": k, "label": v, "requires_admin": k == "FACTORY_RESET", "requires_application": k in APP_COMMANDS}
        for k, v in COMMAND_LABELS.items()
    ]


@router.post("", response_model=CommandOut, status_code=201)
def create_command(
    body: CommandCreate,
    request: Request,
    db: Session = Depends(get_db),
    user: User = Depends(require(Permission.COMMANDS_EXECUTE)),
):
    device = get_device(db, body.device_id)
    audit_base = dict(user=user, target_type="device", target_id=device.device_id, request=request)
    action = f"COMMAND_{body.command_type}"

    if body.command_type == "FACTORY_RESET":
        if not has_permission(user.role.name, Permission.COMMANDS_FACTORY_RESET):
            record_audit_isolated(**audit_base, action=action, result="DENIED",
                                  details={"reason": "factory reset requires administrator role"})
            raise HTTPException(403, "Factory reset requires the ADMIN role")
        if (body.confirmation or "").strip().upper() != device.serial_number.upper():
            raise HTTPException(422, "Factory reset requires confirmation with the device serial number")

    params = dict(body.parameters or {})
    if body.command_type in APP_COMMANDS:
        package_id = str(params.get("package_id", ""))
        installed = db.execute(
            select(InstalledApplication.id)
            .join(Application, Application.id == InstalledApplication.application_id)
            .where(InstalledApplication.device_pk == device.id, Application.package_id == package_id)
        ).first()
        if not installed:
            raise HTTPException(422, f"Application '{package_id}' is not installed on {device.device_id}")
    else:
        params.pop("package_id", None)

    active = db.execute(
        select(DeviceCommand.command_code).where(
            DeviceCommand.device_pk == device.id,
            DeviceCommand.command_type == body.command_type,
            DeviceCommand.status.not_in(TERMINAL_COMMAND_STATUSES),
        )
    ).first()
    if active:
        raise HTTPException(409, f"Command {active[0]} of the same type is already in progress for this device")

    timeout = body.timeout_seconds or int(float(get_settings_map(db)["command_default_timeout_seconds"]))
    cmd = DeviceCommand(
        command_code=new_code("CMD"),
        device_pk=device.id,
        command_type=body.command_type,
        status="PENDING",
        parameters=params,
        requested_by_id=user.id,
        timeout_seconds=timeout,
        expires_at=compute_expiry(timeout),
    )
    db.add(cmd)
    db.flush()
    note = "Command created"
    if device.status.connection_status != "ONLINE":
        note += f"; device is {device.status.connection_status} - delivery will wait until it reconnects"
    db.add(DeviceCommandHistory(command_id=cmd.id, status="PENDING", message=note))
    record_audit(db, **audit_base, action=action, details={"command_code": cmd.command_code, "parameters": params,
                                                           "timeout_seconds": timeout})
    db.commit()
    db.refresh(cmd)
    return serialize_command(cmd, include_history=True)


@router.get("", response_model=Page[CommandOut])
def list_commands(
    device_id: str | None = Query(None, max_length=64),
    status: str | None = Query(None, pattern="^(" + "|".join(COMMAND_STATUSES) + ")$"),
    command_type: str | None = None,
    requested_by: str | None = None,
    params: PageParams = Depends(),
    db: Session = Depends(get_db),
    _: User = Depends(require(Permission.COMMANDS_VIEW)),
):
    stmt = select(DeviceCommand).join(Device, Device.id == DeviceCommand.device_pk)
    if device_id:
        term = f"%{escape_like(device_id.strip())}%"
        stmt = stmt.where(Device.device_id.ilike(term, escape="\\") | Device.serial_number.ilike(term, escape="\\"))
    if status:
        stmt = stmt.where(DeviceCommand.status == status)
    if command_type:
        stmt = stmt.where(DeviceCommand.command_type == command_type.upper())
    if requested_by:
        stmt = stmt.join(User, User.id == DeviceCommand.requested_by_id).where(User.username == requested_by)
    rows, meta = paginate(db, stmt.order_by(DeviceCommand.created_at.desc(), DeviceCommand.id.desc()), params)
    return {"items": [serialize_command(c) for c in rows], **meta}


@router.get("/{command_code}", response_model=CommandOut)
def get_command(command_code: str, db: Session = Depends(get_db), _: User = Depends(require(Permission.COMMANDS_VIEW))):
    cmd = db.execute(select(DeviceCommand).where(DeviceCommand.command_code == command_code)).unique().scalar_one_or_none()
    if cmd is None:
        raise HTTPException(404, f"Command '{command_code}' not found")
    return serialize_command(cmd, include_history=True)
