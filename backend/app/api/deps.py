import secrets
from collections.abc import Callable

import jwt
from fastapi import Depends, Header, HTTPException, Request, status
from fastapi.security import HTTPAuthorizationCredentials, HTTPBearer
from sqlalchemy.orm import Session

from app.core.config import settings
from app.core.database import get_db
from app.core.permissions import Permission, has_permission
from app.core.security import decode_access_token
from app.models import User
from app.services.audit import record_audit_isolated

bearer = HTTPBearer(auto_error=False)


def get_current_user(
    credentials: HTTPAuthorizationCredentials | None = Depends(bearer),
    db: Session = Depends(get_db),
) -> User:
    if credentials is None:
        raise HTTPException(status.HTTP_401_UNAUTHORIZED, "Not authenticated", headers={"WWW-Authenticate": "Bearer"})
    try:
        payload = decode_access_token(credentials.credentials)
    except jwt.ExpiredSignatureError:
        raise HTTPException(status.HTTP_401_UNAUTHORIZED, "Session expired", headers={"WWW-Authenticate": "Bearer"})
    except jwt.PyJWTError:
        raise HTTPException(status.HTTP_401_UNAUTHORIZED, "Invalid token", headers={"WWW-Authenticate": "Bearer"})
    user = db.get(User, int(payload.get("sub", 0)))
    if user is None or not user.is_active:
        raise HTTPException(status.HTTP_401_UNAUTHORIZED, "User inactive or not found")
    return user


def require(permission: Permission) -> Callable[..., User]:
    def dependency(request: Request, user: User = Depends(get_current_user)) -> User:
        if not has_permission(user.role.name, permission):
            record_audit_isolated(
                user=user,
                action="ACCESS_DENIED",
                result="DENIED",
                target_type="endpoint",
                target_id=f"{request.method} {request.url.path}"[:64],
                details={"required_permission": permission.value},
                request=request,
            )
            raise HTTPException(status.HTTP_403_FORBIDDEN, f"Permission '{permission.value}' required")
        return user

    return dependency


def require_gateway_key(x_gateway_key: str = Header(default="")) -> None:
    if not secrets.compare_digest(x_gateway_key.encode(), settings.gateway_api_key.encode()):
        raise HTTPException(status.HTTP_401_UNAUTHORIZED, "Invalid gateway key")
