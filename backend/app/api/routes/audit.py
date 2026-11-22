from datetime import datetime

from fastapi import APIRouter, Depends, HTTPException, Query
from sqlalchemy import select
from sqlalchemy.orm import Session

from app.api.deps import require
from app.core.database import get_db
from app.core.permissions import Permission
from app.models import AuditLog, User
from app.schemas.common import Page
from app.schemas.ops import AuditLogOut
from app.services.devices import escape_like
from app.services.query import PageParams, csv_response, paginate

router = APIRouter(prefix="/api/audit-logs", tags=["Audit Logs"])


def _filtered(username, action, result, target, date_from, date_to):
    stmt = select(AuditLog)
    if username:
        stmt = stmt.where(AuditLog.username.ilike(f"%{escape_like(username.strip())}%", escape="\\"))
    if action:
        stmt = stmt.where(AuditLog.action.in_([a.strip().upper() for a in action.split(",") if a.strip()]))
    if result:
        stmt = stmt.where(AuditLog.result == result.upper())
    if target:
        stmt = stmt.where(AuditLog.target_id.ilike(f"%{escape_like(target.strip())}%", escape="\\"))
    if date_from:
        stmt = stmt.where(AuditLog.created_at >= date_from)
    if date_to:
        stmt = stmt.where(AuditLog.created_at <= date_to)
    return stmt.order_by(AuditLog.created_at.desc(), AuditLog.id.desc())


@router.get("", response_model=Page[AuditLogOut])
def list_audit_logs(
    username: str | None = Query(None, max_length=64),
    action: str | None = Query(None, max_length=256),
    result: str | None = Query(None, pattern="^(SUCCESS|FAILURE|DENIED)$"),
    target: str | None = Query(None, max_length=64),
    date_from: datetime | None = None,
    date_to: datetime | None = None,
    params: PageParams = Depends(),
    db: Session = Depends(get_db),
    _: User = Depends(require(Permission.AUDIT_VIEW)),
):
    rows, meta = paginate(db, _filtered(username, action, result, target, date_from, date_to), params)
    return {"items": rows, **meta}


@router.get("/actions", response_model=list[str])
def audit_actions(db: Session = Depends(get_db), _: User = Depends(require(Permission.AUDIT_VIEW))):
    return db.execute(select(AuditLog.action).distinct().order_by(AuditLog.action)).scalars().all()


@router.get("/export")
def export_audit_logs(
    username: str | None = Query(None, max_length=64),
    action: str | None = Query(None, max_length=256),
    result: str | None = Query(None, pattern="^(SUCCESS|FAILURE|DENIED)$"),
    target: str | None = Query(None, max_length=64),
    date_from: datetime | None = None,
    date_to: datetime | None = None,
    db: Session = Depends(get_db),
    _: User = Depends(require(Permission.AUDIT_VIEW)),
):
    rows = db.execute(_filtered(username, action, result, target, date_from, date_to).limit(50000)).scalars().all()
    return csv_response(
        "bell-stb-audit-log.csv",
        ["Event ID", "Timestamp", "Username", "Action", "Target Type", "Target", "Result", "IP Address"],
        ([a.id, a.created_at, a.username, a.action, a.target_type, a.target_id, a.result, a.ip_address] for a in rows),
    )


@router.get("/{event_id}", response_model=AuditLogOut)
def get_audit_log(event_id: int, db: Session = Depends(get_db), _: User = Depends(require(Permission.AUDIT_VIEW))):
    entry = db.get(AuditLog, event_id)
    if entry is None:
        raise HTTPException(404, "Audit event not found")
    return entry
