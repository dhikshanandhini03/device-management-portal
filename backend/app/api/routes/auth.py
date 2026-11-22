import threading
import time
from collections import defaultdict, deque

from fastapi import APIRouter, Depends, HTTPException, Request, status
from sqlalchemy import func, or_, select
from sqlalchemy.orm import Session

from app.api.deps import get_current_user
from app.core.database import get_db
from app.core.permissions import ROLE_PERMISSIONS
from app.core.security import create_access_token, hash_password, verify_password
from app.models import User
from app.models.base import utcnow
from app.schemas.auth import ChangePasswordRequest, CurrentUser, LoginRequest, TokenResponse, UserOut
from app.schemas.common import Message
from app.services.audit import client_ip, record_audit

router = APIRouter(prefix="/api/auth", tags=["Authentication"])

MAX_FAILED_ATTEMPTS = 10
LOCKOUT_WINDOW_SECONDS = 300
_failed: dict[str, deque] = defaultdict(deque)
_failed_lock = threading.Lock()


def _attempt_key(username: str, request: Request) -> str:
    return f"{username.lower()}|{client_ip(request)}"


def _is_locked(key: str) -> bool:
    with _failed_lock:
        q = _failed[key]
        cutoff = time.monotonic() - LOCKOUT_WINDOW_SECONDS
        while q and q[0] < cutoff:
            q.popleft()
        return len(q) >= MAX_FAILED_ATTEMPTS


def _register_failure(key: str) -> None:
    with _failed_lock:
        _failed[key].append(time.monotonic())


def current_user_payload(user: User) -> dict:
    data = UserOut.model_validate(user).model_dump()
    data["permissions"] = sorted(p.value for p in ROLE_PERMISSIONS.get(user.role.name, set()))
    return data


@router.post("/login", response_model=TokenResponse)
def login(body: LoginRequest, request: Request, db: Session = Depends(get_db)):
    key = _attempt_key(body.username, request)
    if _is_locked(key):
        raise HTTPException(status.HTTP_429_TOO_MANY_REQUESTS, "Too many failed attempts. Try again later.")
    ident = body.username.strip().lower()
    user = db.execute(
        select(User).where(or_(func.lower(User.username) == ident, func.lower(User.email) == ident))
    ).unique().scalar_one_or_none()
    if user is None or not verify_password(body.password, user.hashed_password):
        _register_failure(key)
        record_audit(
            db,
            user=user,
            username=body.username[:64],
            action="LOGIN_FAILED",
            result="FAILURE",
            target_type="session",
            details={"reason": "invalid_credentials"},
            request=request,
        )
        db.commit()
        raise HTTPException(status.HTTP_401_UNAUTHORIZED, "Invalid username or password")
    if not user.is_active:
        record_audit(
            db, user=user, action="LOGIN_FAILED", result="DENIED", target_type="session",
            details={"reason": "account_deactivated"}, request=request,
        )
        db.commit()
        raise HTTPException(status.HTTP_403_FORBIDDEN, "Account is deactivated. Contact your administrator.")

    with _failed_lock:
        _failed.pop(key, None)
    user.last_login_at = utcnow()
    record_audit(db, user=user, action="LOGIN", target_type="session", request=request,
                 details={"user_agent": request.headers.get("user-agent", "")[:200]})
    db.commit()
    token, expires = create_access_token(str(user.id), user.role.name)
    return {"access_token": token, "token_type": "bearer", "expires_at": expires, "user": current_user_payload(user)}


@router.post("/logout", response_model=Message)
def logout(request: Request, user: User = Depends(get_current_user), db: Session = Depends(get_db)):
    record_audit(db, user=user, action="LOGOUT", target_type="session", request=request)
    db.commit()
    return {"message": "Logged out"}


@router.get("/me", response_model=CurrentUser)
def me(user: User = Depends(get_current_user)):
    return current_user_payload(user)


@router.post("/change-password", response_model=Message)
def change_password(
    body: ChangePasswordRequest,
    request: Request,
    user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    if not verify_password(body.current_password, user.hashed_password):
        raise HTTPException(400, "Current password is incorrect")
    user.hashed_password = hash_password(body.new_password)
    record_audit(db, user=user, action="PASSWORD_CHANGED", target_type="user", target_id=user.username, request=request)
    db.commit()
    return {"message": "Password updated"}
