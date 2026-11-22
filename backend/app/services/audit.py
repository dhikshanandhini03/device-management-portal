from fastapi import Request
from sqlalchemy.orm import Session

from app.core.database import SessionLocal
from app.models import AuditLog, User


def client_ip(request: Request | None) -> str | None:
    if request is None:
        return None
    forwarded = request.headers.get("x-forwarded-for")
    if forwarded:
        return forwarded.split(",")[0].strip()[:45]
    return request.client.host if request.client else None


def record_audit(
    db: Session,
    *,
    user: User | None,
    action: str,
    result: str = "SUCCESS",
    target_type: str | None = None,
    target_id: str | None = None,
    details: dict | None = None,
    request: Request | None = None,
    username: str | None = None,
) -> AuditLog:
    entry = AuditLog(
        user_id=user.id if user else None,
        username=user.username if user else (username or "system"),
        action=action,
        target_type=target_type,
        target_id=target_id,
        details=details or {},
        result=result,
        ip_address=client_ip(request),
    )
    db.add(entry)
    return entry


def record_audit_isolated(**kwargs) -> None:
    """Write an audit entry in its own transaction (used when the main transaction is aborted)."""
    db = SessionLocal()
    try:
        record_audit(db, **kwargs)
        db.commit()
    finally:
        db.close()
