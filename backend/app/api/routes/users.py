from fastapi import APIRouter, Depends, HTTPException, Query, Request
from sqlalchemy import func, or_, select
from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import Session

from app.api.deps import require
from app.core.database import get_db
from app.core.permissions import ROLE_PERMISSIONS, Permission
from app.core.security import hash_password
from app.models import AuditLog, Role, User
from app.schemas.auth import RoleOut, UserCreate, UserOut, UserUpdate
from app.schemas.common import Page
from app.schemas.ops import AuditLogOut
from app.services.audit import record_audit
from app.services.devices import escape_like
from app.services.query import PageParams, apply_sort, paginate, validate_sort

router = APIRouter(prefix="/api/users", tags=["User Management"])

USER_SORT = {
    "username": User.username, "full_name": User.full_name, "email": User.email,
    "last_login_at": User.last_login_at, "created_at": User.created_at,
}


def _role(db: Session, name: str) -> Role:
    role = db.execute(select(Role).where(Role.name == name)).scalar_one_or_none()
    if role is None:
        raise HTTPException(422, f"Unknown role '{name}'")
    return role


def _user(db: Session, user_id: int) -> User:
    user = db.get(User, user_id)
    if user is None:
        raise HTTPException(404, "User not found")
    return user


@router.get("/roles", response_model=list[RoleOut])
def roles(db: Session = Depends(get_db), _: User = Depends(require(Permission.USERS_MANAGE))):
    return [
        {"id": r.id, "name": r.name, "description": r.description,
         "permissions": sorted(p.value for p in ROLE_PERMISSIONS.get(r.name, set()))}
        for r in db.execute(select(Role).order_by(Role.id)).scalars()
    ]


@router.get("", response_model=Page[UserOut])
def list_users(
    search: str | None = Query(None, max_length=64),
    role: str | None = None,
    is_active: bool | None = None,
    sort_by: str | None = None,
    sort_dir: str = Query("asc", pattern="^(asc|desc)$"),
    params: PageParams = Depends(),
    db: Session = Depends(get_db),
    _: User = Depends(require(Permission.USERS_MANAGE)),
):
    validate_sort(sort_by, USER_SORT)
    stmt = select(User).join(Role, Role.id == User.role_id)
    if search:
        term = f"%{escape_like(search.strip())}%"
        stmt = stmt.where(or_(User.username.ilike(term, escape="\\"), User.full_name.ilike(term, escape="\\"),
                              User.email.ilike(term, escape="\\")))
    if role:
        stmt = stmt.where(Role.name == role)
    if is_active is not None:
        stmt = stmt.where(User.is_active.is_(is_active))
    stmt = apply_sort(stmt, sort_by, sort_dir, USER_SORT, User.username)
    rows, meta = paginate(db, stmt, params)
    return {"items": rows, **meta}


@router.post("", response_model=UserOut, status_code=201)
def create_user(body: UserCreate, request: Request, db: Session = Depends(get_db),
                admin: User = Depends(require(Permission.USERS_MANAGE))):
    role = _role(db, body.role)
    exists = db.execute(
        select(User.id).where(or_(func.lower(User.username) == body.username, func.lower(User.email) == body.email.lower()))
    ).first()
    if exists:
        raise HTTPException(409, "A user with this username or email already exists")
    user = User(username=body.username, email=body.email.lower(), full_name=body.full_name, role_id=role.id,
                hashed_password=hash_password(body.password), is_active=body.is_active)
    db.add(user)
    try:
        db.flush()
    except IntegrityError:
        db.rollback()
        raise HTTPException(409, "A user with this username or email already exists")
    record_audit(db, user=admin, action="USER_CREATED", target_type="user", target_id=user.username, request=request,
                 details={"role": role.name, "email": user.email})
    db.commit()
    db.refresh(user)
    return user


@router.get("/{user_id}", response_model=UserOut)
def get_user(user_id: int, db: Session = Depends(get_db), _: User = Depends(require(Permission.USERS_MANAGE))):
    return _user(db, user_id)


@router.patch("/{user_id}", response_model=UserOut)
def update_user(user_id: int, body: UserUpdate, request: Request, db: Session = Depends(get_db),
                admin: User = Depends(require(Permission.USERS_MANAGE))):
    user = _user(db, user_id)
    changes = body.model_dump(exclude_unset=True, exclude_none=True)
    details: dict = {}
    if user.id == admin.id and (changes.get("is_active") is False or ("role" in changes and changes["role"] != user.role.name)):
        raise HTTPException(409, "You cannot deactivate or change the role of your own account")
    if "email" in changes and changes["email"].lower() != user.email:
        clash = db.execute(select(User.id).where(func.lower(User.email) == changes["email"].lower(), User.id != user.id)).first()
        if clash:
            raise HTTPException(409, "Email already in use")
        details["email"] = {"from": user.email, "to": changes["email"].lower()}
        user.email = changes["email"].lower()
    if "full_name" in changes and changes["full_name"] != user.full_name:
        details["full_name"] = {"from": user.full_name, "to": changes["full_name"]}
        user.full_name = changes["full_name"]
    if "role" in changes and changes["role"] != user.role.name:
        role = _role(db, changes["role"])
        details["role"] = {"from": user.role.name, "to": role.name}
        user.role_id = role.id
        user.role = role
    if "is_active" in changes and changes["is_active"] != user.is_active:
        details["is_active"] = {"from": user.is_active, "to": changes["is_active"]}
        user.is_active = changes["is_active"]
    if changes.get("password"):
        user.hashed_password = hash_password(changes["password"])
        details["password"] = "reset"
    if details:
        action = "USER_ROLE_CHANGED" if set(details) == {"role"} else "USER_UPDATED"
        record_audit(db, user=admin, action=action, target_type="user", target_id=user.username, request=request,
                     details=details)
    db.commit()
    db.refresh(user)
    return user


def _set_active(db: Session, request: Request, admin: User, user_id: int, active: bool) -> User:
    user = _user(db, user_id)
    if user.id == admin.id:
        raise HTTPException(409, "You cannot change the status of your own account")
    if user.is_active != active:
        user.is_active = active
        record_audit(db, user=admin, action="USER_ACTIVATED" if active else "USER_DEACTIVATED", target_type="user",
                     target_id=user.username, request=request)
        db.commit()
        db.refresh(user)
    return user


@router.post("/{user_id}/activate", response_model=UserOut)
def activate_user(user_id: int, request: Request, db: Session = Depends(get_db),
                  admin: User = Depends(require(Permission.USERS_MANAGE))):
    return _set_active(db, request, admin, user_id, True)


@router.post("/{user_id}/deactivate", response_model=UserOut)
def deactivate_user(user_id: int, request: Request, db: Session = Depends(get_db),
                    admin: User = Depends(require(Permission.USERS_MANAGE))):
    return _set_active(db, request, admin, user_id, False)


@router.get("/{user_id}/login-history", response_model=Page[AuditLogOut])
def login_history(user_id: int, params: PageParams = Depends(), db: Session = Depends(get_db),
                  _: User = Depends(require(Permission.USERS_MANAGE))):
    user = _user(db, user_id)
    stmt = (
        select(AuditLog)
        .where(or_(AuditLog.user_id == user.id, AuditLog.username == user.username),
               AuditLog.action.in_(["LOGIN", "LOGOUT", "LOGIN_FAILED"]))
        .order_by(AuditLog.created_at.desc(), AuditLog.id.desc())
    )
    rows, meta = paginate(db, stmt, params)
    return {"items": rows, **meta}


@router.get("/{user_id}/activity", response_model=Page[AuditLogOut])
def user_activity(user_id: int, params: PageParams = Depends(), db: Session = Depends(get_db),
                  _: User = Depends(require(Permission.USERS_MANAGE))):
    user = _user(db, user_id)
    stmt = (
        select(AuditLog)
        .where(AuditLog.user_id == user.id, AuditLog.action.not_in(["LOGIN", "LOGOUT", "LOGIN_FAILED"]))
        .order_by(AuditLog.created_at.desc(), AuditLog.id.desc())
    )
    rows, meta = paginate(db, stmt, params)
    return {"items": rows, **meta}
