from datetime import datetime

from fastapi import APIRouter, Depends, HTTPException, Query, Request
from sqlalchemy import func, select
from sqlalchemy.orm import Session

from app.api.deps import require
from app.core.database import get_db
from app.core.permissions import Permission
from app.models import Alert, Device, User
from app.models.base import utcnow
from app.schemas.common import Page
from app.schemas.ops import AlertOut, AlertResolve
from app.services.alerts import serialize_alert
from app.services.audit import record_audit
from app.services.devices import escape_like
from app.services.query import PageParams, csv_response, paginate

router = APIRouter(prefix="/api/alerts", tags=["Alerts"])

CATEGORIES = ["DEVICE_OFFLINE", "HIGH_CPU", "HIGH_MEMORY", "FIRMWARE_UPDATE", "APP_CRASH", "NETWORK_DISCONNECT",
              "CRITICAL_ERROR"]


def _filtered(severity, status, category, search, date_from, date_to):
    stmt = select(Alert).join(Device, Device.id == Alert.device_pk)
    if severity:
        stmt = stmt.where(Alert.severity == severity)
    if status:
        statuses = [s.strip().upper() for s in status.split(",") if s.strip()]
        stmt = stmt.where(Alert.status.in_(statuses))
    if category:
        stmt = stmt.where(Alert.category == category)
    if search:
        term = f"%{escape_like(search.strip())}%"
        stmt = stmt.where(
            Device.device_id.ilike(term, escape="\\")
            | Device.serial_number.ilike(term, escape="\\")
            | Alert.alert_code.ilike(term, escape="\\")
        )
    if date_from:
        stmt = stmt.where(Alert.created_at >= date_from)
    if date_to:
        stmt = stmt.where(Alert.created_at <= date_to)
    return stmt.order_by(Alert.created_at.desc(), Alert.id.desc())


@router.get("", response_model=Page[AlertOut])
def list_alerts(
    severity: str | None = Query(None, pattern="^(INFO|WARNING|CRITICAL)$"),
    status: str | None = None,
    category: str | None = None,
    search: str | None = Query(None, max_length=64),
    date_from: datetime | None = None,
    date_to: datetime | None = None,
    params: PageParams = Depends(),
    db: Session = Depends(get_db),
    _: User = Depends(require(Permission.ALERTS_VIEW)),
):
    rows, meta = paginate(db, _filtered(severity, status, category, search, date_from, date_to), params)
    return {"items": [serialize_alert(a) for a in rows], **meta}


@router.get("/summary")
def alert_summary(db: Session = Depends(get_db), _: User = Depends(require(Permission.ALERTS_VIEW))):
    by_status = dict(db.execute(select(Alert.status, func.count()).group_by(Alert.status)).all())
    open_by_sev = dict(
        db.execute(select(Alert.severity, func.count()).where(Alert.status != "RESOLVED").group_by(Alert.severity)).all()
    )
    open_by_cat = dict(
        db.execute(select(Alert.category, func.count()).where(Alert.status != "RESOLVED").group_by(Alert.category)).all()
    )
    return {
        "open": by_status.get("OPEN", 0),
        "acknowledged": by_status.get("ACKNOWLEDGED", 0),
        "resolved": by_status.get("RESOLVED", 0),
        "critical_active": open_by_sev.get("CRITICAL", 0),
        "warning_active": open_by_sev.get("WARNING", 0),
        "info_active": open_by_sev.get("INFO", 0),
        "by_category": [{"category": c, "count": open_by_cat.get(c, 0)} for c in CATEGORIES],
    }


@router.get("/export")
def export_alerts(
    request: Request,
    severity: str | None = Query(None, pattern="^(INFO|WARNING|CRITICAL)$"),
    status: str | None = None,
    category: str | None = None,
    search: str | None = Query(None, max_length=64),
    db: Session = Depends(get_db),
    _: User = Depends(require(Permission.ALERTS_VIEW)),
):
    rows = db.execute(_filtered(severity, status, category, search, None, None).limit(10000)).unique().scalars().all()
    return csv_response(
        "bell-stb-alerts.csv",
        ["Alert ID", "Device ID", "Serial Number", "Category", "Severity", "Title", "Status", "Created", "Resolved"],
        ([a.alert_code, a.device.device_id, a.device.serial_number, a.category, a.severity, a.title, a.status,
          a.created_at, a.resolved_at] for a in rows),
    )


def _get(db: Session, code: str) -> Alert:
    alert = db.execute(select(Alert).where(Alert.alert_code == code)).unique().scalar_one_or_none()
    if alert is None:
        raise HTTPException(404, f"Alert '{code}' not found")
    return alert


@router.get("/{alert_code}", response_model=AlertOut)
def get_alert(alert_code: str, db: Session = Depends(get_db), _: User = Depends(require(Permission.ALERTS_VIEW))):
    return serialize_alert(_get(db, alert_code))


@router.post("/{alert_code}/acknowledge", response_model=AlertOut)
def acknowledge_alert(
    alert_code: str, request: Request, db: Session = Depends(get_db),
    user: User = Depends(require(Permission.ALERTS_MANAGE)),
):
    alert = _get(db, alert_code)
    if alert.status != "OPEN":
        raise HTTPException(409, f"Alert is {alert.status} and cannot be acknowledged")
    alert.status = "ACKNOWLEDGED"
    alert.acknowledged_at = utcnow()
    alert.acknowledged_by_id = user.id
    record_audit(db, user=user, action="ALERT_ACKNOWLEDGED", target_type="alert", target_id=alert_code, request=request,
                 details={"device_id": alert.device.device_id, "category": alert.category})
    db.commit()
    db.refresh(alert)
    return serialize_alert(alert)


@router.post("/{alert_code}/resolve", response_model=AlertOut)
def resolve_alert(
    alert_code: str, request: Request, body: AlertResolve | None = None, db: Session = Depends(get_db),
    user: User = Depends(require(Permission.ALERTS_MANAGE)),
):
    alert = _get(db, alert_code)
    if alert.status == "RESOLVED":
        raise HTTPException(409, "Alert is already resolved")
    now = utcnow()
    if alert.status == "OPEN":
        alert.acknowledged_at = now
        alert.acknowledged_by_id = user.id
    alert.status = "RESOLVED"
    alert.resolved_at = now
    alert.resolved_by_id = user.id
    alert.resolution_note = (body.note if body else None) or None
    record_audit(db, user=user, action="ALERT_RESOLVED", target_type="alert", target_id=alert_code, request=request,
                 details={"device_id": alert.device.device_id, "note": alert.resolution_note})
    db.commit()
    db.refresh(alert)
    return serialize_alert(alert)
