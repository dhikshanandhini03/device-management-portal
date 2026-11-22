import hashlib
import secrets
from datetime import timezone

from fastapi import APIRouter, Depends, HTTPException, Query, Request
from sqlalchemy import func, select, update
from sqlalchemy.orm import Session

from app.api.deps import require
from app.core.database import get_db
from app.core.permissions import Permission
from app.models import DeploymentTarget, Device, DeviceStatus, FirmwareDeployment, FirmwareVersion, User
from app.models.base import utcnow
from app.schemas.common import Message, Page
from app.schemas.device import DeviceListItem
from app.schemas.ops import DeploymentCreate, DeploymentOut, DeploymentTargetOut, FirmwareCreate, FirmwareOut
from app.services.audit import record_audit
from app.services.deployments import serialize_deployment, target_counts
from app.services.devices import apply_device_filters, device_select, escape_like, serialize_device
from app.services.query import PageParams, paginate

router = APIRouter(prefix="/api/firmware", tags=["Firmware"])

ACTIVE_DEPLOYMENT_STATUSES = ("SCHEDULED", "IN_PROGRESS")


def _firmware_dict(fw: FirmwareVersion, count: int) -> dict:
    return {
        "id": fw.id, "version": fw.version, "model": fw.model, "os_version": fw.os_version,
        "release_date": fw.release_date, "release_notes": fw.release_notes, "file_size_mb": fw.file_size_mb,
        "checksum_sha256": fw.checksum_sha256, "status": fw.status, "is_latest": fw.is_latest, "device_count": count,
    }


def _device_counts(db: Session) -> dict[int, int]:
    return dict(db.execute(select(Device.firmware_version_id, func.count()).group_by(Device.firmware_version_id)).all())


@router.get("", response_model=list[FirmwareOut])
def list_firmware(
    search: str | None = Query(None, max_length=64),
    model: str | None = None,
    status: str | None = Query(None, pattern="^(ACTIVE|BETA|DEPRECATED)$"),
    latest_only: bool = False,
    db: Session = Depends(get_db),
    _: User = Depends(require(Permission.FIRMWARE_VIEW)),
):
    stmt = select(FirmwareVersion)
    if search:
        term = f"%{escape_like(search.strip())}%"
        stmt = stmt.where(FirmwareVersion.version.ilike(term, escape="\\") | FirmwareVersion.model.ilike(term, escape="\\"))
    if model:
        stmt = stmt.where(FirmwareVersion.model == model)
    if status:
        stmt = stmt.where(FirmwareVersion.status == status)
    if latest_only:
        stmt = stmt.where(FirmwareVersion.is_latest.is_(True))
    counts = _device_counts(db)
    rows = db.execute(stmt.order_by(FirmwareVersion.model, FirmwareVersion.release_date.desc())).scalars().all()
    return [_firmware_dict(fw, counts.get(fw.id, 0)) for fw in rows]


@router.post("", response_model=FirmwareOut, status_code=201)
def register_firmware(
    body: FirmwareCreate,
    request: Request,
    db: Session = Depends(get_db),
    user: User = Depends(require(Permission.FIRMWARE_MANAGE)),
):
    known_model = db.execute(select(FirmwareVersion.id).where(FirmwareVersion.model == body.model)).first()
    if not known_model:
        raise HTTPException(422, f"Unknown device model '{body.model}'")
    exists = db.execute(
        select(FirmwareVersion.id).where(FirmwareVersion.model == body.model, FirmwareVersion.version == body.version)
    ).first()
    if exists:
        raise HTTPException(409, f"Firmware {body.version} already exists for {body.model}")
    if body.mark_latest:
        db.execute(update(FirmwareVersion).where(FirmwareVersion.model == body.model).values(is_latest=False))
    fw = FirmwareVersion(
        version=body.version, model=body.model, os_version=body.os_version, release_date=utcnow(),
        release_notes=body.release_notes, file_size_mb=body.file_size_mb, status=body.status,
        is_latest=body.mark_latest,
        checksum_sha256=hashlib.sha256(f"{body.model}:{body.version}:{secrets.token_hex(8)}".encode()).hexdigest(),
    )
    db.add(fw)
    db.flush()
    record_audit(db, user=user, action="FIRMWARE_REGISTERED", target_type="firmware", target_id=f"{fw.model} {fw.version}",
                 request=request, details={"mark_latest": body.mark_latest})
    db.commit()
    return _firmware_dict(fw, 0)


@router.get("/distribution")
def firmware_distribution(db: Session = Depends(get_db), _: User = Depends(require(Permission.FIRMWARE_VIEW))):
    rows = db.execute(
        select(FirmwareVersion.version, FirmwareVersion.model, FirmwareVersion.is_latest, func.count(Device.id))
        .join(Device, Device.firmware_version_id == FirmwareVersion.id)
        .group_by(FirmwareVersion.version, FirmwareVersion.model, FirmwareVersion.is_latest)
        .order_by(func.count(Device.id).desc())
    ).all()
    return [{"version": v, "model": m, "is_latest": latest, "device_count": c} for v, m, latest, c in rows]


@router.get("/eligible-devices", response_model=Page[DeviceListItem])
def eligible_devices(
    firmware_version_id: int,
    search: str | None = Query(None, max_length=64),
    region: str | None = None,
    status: str | None = Query(None, pattern="^(ONLINE|OFFLINE)$"),
    params: PageParams = Depends(),
    db: Session = Depends(get_db),
    _: User = Depends(require(Permission.FIRMWARE_VIEW)),
):
    fw = db.get(FirmwareVersion, firmware_version_id)
    if fw is None:
        raise HTTPException(404, "Firmware version not found")
    stmt = apply_device_filters(device_select(), search=search, region=region, status=status, model=fw.model)
    stmt = stmt.where(Device.firmware_version_id != fw.id).order_by(Device.device_id)
    rows, meta = paginate(db, stmt, params, scalars=False)
    return {"items": [serialize_device(d, latest) for d, latest in rows], **meta}


@router.get("/deployments", response_model=Page[DeploymentOut])
def list_deployments(
    status: str | None = None,
    search: str | None = Query(None, max_length=64),
    params: PageParams = Depends(),
    db: Session = Depends(get_db),
    _: User = Depends(require(Permission.FIRMWARE_VIEW)),
):
    stmt = select(FirmwareDeployment).join(FirmwareVersion, FirmwareVersion.id == FirmwareDeployment.firmware_version_id)
    if status:
        stmt = stmt.where(FirmwareDeployment.status == status.upper())
    if search:
        term = f"%{escape_like(search.strip())}%"
        stmt = stmt.where(
            FirmwareDeployment.deployment_code.ilike(term, escape="\\")
            | FirmwareDeployment.name.ilike(term, escape="\\")
            | FirmwareVersion.version.ilike(term, escape="\\")
        )
    rows, meta = paginate(db, stmt.order_by(FirmwareDeployment.created_at.desc(), FirmwareDeployment.id.desc()), params)
    counts = target_counts(db, [d.id for d in rows])
    codes = _rollback_codes(db, rows)
    return {"items": [serialize_deployment(d, counts[d.id], codes.get(d.rollback_of_id)) for d in rows], **meta}


def _rollback_codes(db: Session, rows: list[FirmwareDeployment]) -> dict[int, str]:
    ids = [d.rollback_of_id for d in rows if d.rollback_of_id]
    if not ids:
        return {}
    return dict(db.execute(select(FirmwareDeployment.id, FirmwareDeployment.deployment_code)
                           .where(FirmwareDeployment.id.in_(ids))).all())


def _get_deployment(db: Session, code: str) -> FirmwareDeployment:
    d = db.execute(select(FirmwareDeployment).where(FirmwareDeployment.deployment_code == code)).unique().scalar_one_or_none()
    if d is None:
        raise HTTPException(404, f"Deployment '{code}' not found")
    return d


def _deployment_out(db: Session, d: FirmwareDeployment) -> dict:
    return serialize_deployment(d, target_counts(db, [d.id])[d.id], _rollback_codes(db, [d]).get(d.rollback_of_id))


def _next_code(db: Session) -> str:
    n = db.execute(select(func.count(FirmwareDeployment.id))).scalar_one() + 1
    while True:
        code = f"DEP-{n:05d}"
        if not db.execute(select(FirmwareDeployment.id).where(FirmwareDeployment.deployment_code == code)).first():
            return code
        n += 1


@router.post("/deployments", response_model=DeploymentOut, status_code=201)
def create_deployment(
    body: DeploymentCreate,
    request: Request,
    db: Session = Depends(get_db),
    user: User = Depends(require(Permission.FIRMWARE_MANAGE)),
):
    fw = db.get(FirmwareVersion, body.firmware_version_id)
    if fw is None:
        raise HTTPException(404, "Firmware version not found")
    if fw.status == "DEPRECATED":
        raise HTTPException(422, "Deprecated firmware cannot be deployed")
    ids = list(dict.fromkeys(body.device_ids))
    devices = db.execute(select(Device).where(Device.device_id.in_(ids))).unique().scalars().all()
    found = {d.device_id for d in devices}
    missing = [i for i in ids if i not in found]
    if missing:
        raise HTTPException(422, f"Unknown devices: {', '.join(missing[:10])}")
    wrong_model = [d.device_id for d in devices if d.model != fw.model]
    if wrong_model:
        raise HTTPException(422, f"Firmware {fw.version} is not compatible with: {', '.join(wrong_model[:10])}")
    busy = db.execute(
        select(Device.device_id)
        .join(DeploymentTarget, DeploymentTarget.device_pk == Device.id)
        .join(FirmwareDeployment, FirmwareDeployment.id == DeploymentTarget.deployment_id)
        .where(Device.device_id.in_(ids), FirmwareDeployment.status.in_(ACTIVE_DEPLOYMENT_STATUSES),
               DeploymentTarget.status.not_in(("SUCCESS", "FAILED")))
    ).scalars().all()
    if busy:
        raise HTTPException(409, f"Devices already in an active deployment: {', '.join(busy[:10])}")

    now = utcnow()
    scheduled = body.scheduled_at or now
    if scheduled.tzinfo is None:
        scheduled = scheduled.replace(tzinfo=timezone.utc)
    d = FirmwareDeployment(
        deployment_code=_next_code(db), name=body.name, firmware_version_id=fw.id, status="SCHEDULED",
        offline_policy=body.offline_policy, scheduled_at=scheduled, created_by_id=user.id,
    )
    db.add(d)
    db.flush()
    for dev in devices:
        db.add(DeploymentTarget(deployment_id=d.id, device_pk=dev.id, previous_firmware_version_id=dev.firmware_version_id,
                                target_firmware_version_id=fw.id, status="PENDING"))
    record_audit(db, user=user, action="FIRMWARE_DEPLOYMENT_CREATED", target_type="deployment",
                 target_id=d.deployment_code, request=request,
                 details={"firmware": fw.version, "model": fw.model, "targets": len(devices),
                          "scheduled_at": scheduled.isoformat(), "offline_policy": body.offline_policy})
    db.commit()
    return _deployment_out(db, d)


@router.get("/deployments/{code}", response_model=DeploymentOut)
def get_deployment(code: str, db: Session = Depends(get_db), _: User = Depends(require(Permission.FIRMWARE_VIEW))):
    return _deployment_out(db, _get_deployment(db, code))


@router.get("/deployments/{code}/targets", response_model=Page[DeploymentTargetOut])
def deployment_targets(
    code: str,
    status: str | None = None,
    params: PageParams = Depends(),
    db: Session = Depends(get_db),
    _: User = Depends(require(Permission.FIRMWARE_VIEW)),
):
    d = _get_deployment(db, code)
    stmt = select(DeploymentTarget).where(DeploymentTarget.deployment_id == d.id)
    if status:
        stmt = stmt.where(DeploymentTarget.status == status.upper())
    rows, meta = paginate(db, stmt.order_by(DeploymentTarget.id), params)
    fw_ids = {r.previous_firmware_version_id for r in rows} | {r.target_firmware_version_id for r in rows}
    versions = dict(db.execute(select(FirmwareVersion.id, FirmwareVersion.version).where(FirmwareVersion.id.in_(fw_ids))).all())
    statuses = dict(db.execute(select(DeviceStatus.device_pk, DeviceStatus.connection_status)
                               .where(DeviceStatus.device_pk.in_([r.device_pk for r in rows]))).all())
    items = [
        {"id": r.id, "device_id": r.device.device_id, "serial_number": r.device.serial_number, "region": r.device.region,
         "connection_status": statuses.get(r.device_pk, "UNKNOWN"),
         "previous_version": versions.get(r.previous_firmware_version_id),
         "target_version": versions.get(r.target_firmware_version_id, ""), "status": r.status,
         "error_message": r.error_message, "updated_at": r.updated_at}
        for r in rows
    ]
    return {"items": items, **meta}


@router.post("/deployments/{code}/cancel", response_model=DeploymentOut)
def cancel_deployment(
    code: str, request: Request, db: Session = Depends(get_db), user: User = Depends(require(Permission.FIRMWARE_MANAGE))
):
    d = _get_deployment(db, code)
    if d.status not in ACTIVE_DEPLOYMENT_STATUSES:
        raise HTTPException(409, f"Deployment is {d.status} and cannot be cancelled")
    db.execute(
        update(DeploymentTarget)
        .where(DeploymentTarget.deployment_id == d.id, DeploymentTarget.status == "PENDING")
        .values(status="FAILED", error_message="Cancelled by administrator", updated_at=utcnow())
    )
    d.status = "CANCELLED"
    d.completed_at = utcnow()
    record_audit(db, user=user, action="FIRMWARE_DEPLOYMENT_CANCELLED", target_type="deployment", target_id=code,
                 request=request)
    db.commit()
    return _deployment_out(db, d)


@router.post("/deployments/{code}/rollback", response_model=DeploymentOut, status_code=201)
def rollback_deployment(
    code: str, request: Request, db: Session = Depends(get_db), user: User = Depends(require(Permission.FIRMWARE_MANAGE))
):
    original = _get_deployment(db, code)
    if original.status not in ("COMPLETED", "COMPLETED_WITH_ERRORS", "CANCELLED"):
        raise HTTPException(409, f"Deployment is {original.status}; only finished deployments can be rolled back")
    targets = db.execute(
        select(DeploymentTarget).where(DeploymentTarget.deployment_id == original.id, DeploymentTarget.status == "SUCCESS",
                                       DeploymentTarget.previous_firmware_version_id.is_not(None))
    ).unique().scalars().all()
    if not targets:
        raise HTTPException(409, "No successfully updated devices to roll back")
    prev_ids = [t.previous_firmware_version_id for t in targets]
    main_prev = max(set(prev_ids), key=prev_ids.count)
    rb = FirmwareDeployment(
        deployment_code=_next_code(db), name=f"Rollback of {original.deployment_code}", firmware_version_id=main_prev,
        status="SCHEDULED", is_rollback=True, rollback_of_id=original.id, offline_policy="WAIT",
        scheduled_at=utcnow(), created_by_id=user.id,
    )
    db.add(rb)
    db.flush()
    for t in targets:
        db.add(DeploymentTarget(deployment_id=rb.id, device_pk=t.device_pk,
                                previous_firmware_version_id=t.device.firmware_version_id,
                                target_firmware_version_id=t.previous_firmware_version_id, status="PENDING"))
    original.status = "ROLLED_BACK"
    record_audit(db, user=user, action="FIRMWARE_ROLLBACK_CREATED", target_type="deployment",
                 target_id=rb.deployment_code, request=request,
                 details={"rollback_of": original.deployment_code, "targets": len(targets)})
    db.commit()
    return _deployment_out(db, rb)


@router.get("/{firmware_id}", response_model=FirmwareOut)
def get_firmware(firmware_id: int, db: Session = Depends(get_db), _: User = Depends(require(Permission.FIRMWARE_VIEW))):
    fw = db.get(FirmwareVersion, firmware_id)
    if fw is None:
        raise HTTPException(404, "Firmware version not found")
    return _firmware_dict(fw, _device_counts(db).get(fw.id, 0))


@router.post("/{firmware_id}/deprecate", response_model=Message)
def deprecate_firmware(
    firmware_id: int, request: Request, db: Session = Depends(get_db),
    user: User = Depends(require(Permission.FIRMWARE_MANAGE)),
):
    fw = db.get(FirmwareVersion, firmware_id)
    if fw is None:
        raise HTTPException(404, "Firmware version not found")
    if fw.is_latest:
        raise HTTPException(409, "The latest firmware for a model cannot be deprecated")
    fw.status = "DEPRECATED"
    record_audit(db, user=user, action="FIRMWARE_DEPRECATED", target_type="firmware",
                 target_id=f"{fw.model} {fw.version}", request=request)
    db.commit()
    return {"message": f"Firmware {fw.version} deprecated"}
