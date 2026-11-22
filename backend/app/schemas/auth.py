import re
from datetime import datetime

import email_validator
from pydantic import BaseModel, EmailStr, Field, field_validator

from app.schemas.common import ORMModel

# Corporate directories commonly use internal ".local" domains; allow them for portal accounts.
email_validator.SPECIAL_USE_DOMAIN_NAMES = [d for d in email_validator.SPECIAL_USE_DOMAIN_NAMES if d != "local"]

USERNAME_RE = re.compile(r"^[a-zA-Z0-9._-]{3,64}$")


def validate_password_strength(value: str) -> str:
    if len(value) < 8:
        raise ValueError("Password must be at least 8 characters")
    checks = [r"[A-Z]", r"[a-z]", r"[0-9]", r"[^A-Za-z0-9]"]
    if not all(re.search(c, value) for c in checks):
        raise ValueError("Password must contain upper and lower case letters, a digit and a special character")
    return value


class LoginRequest(BaseModel):
    username: str = Field(min_length=1, max_length=255)
    password: str = Field(min_length=1, max_length=128)


class UserOut(ORMModel):
    id: int
    username: str
    email: str
    full_name: str
    role: str
    is_active: bool
    last_login_at: datetime | None
    created_at: datetime
    updated_at: datetime

    @field_validator("role", mode="before")
    @classmethod
    def role_name(cls, v):
        return getattr(v, "name", v)


class CurrentUser(UserOut):
    permissions: list[str]


class TokenResponse(BaseModel):
    access_token: str
    token_type: str = "bearer"
    expires_at: datetime
    user: CurrentUser


class ChangePasswordRequest(BaseModel):
    current_password: str = Field(min_length=1, max_length=128)
    new_password: str = Field(max_length=128)

    _strength = field_validator("new_password")(validate_password_strength)


class UserCreate(BaseModel):
    username: str = Field(max_length=64)
    email: EmailStr
    full_name: str = Field(min_length=2, max_length=128)
    role: str
    password: str = Field(max_length=128)
    is_active: bool = True

    _strength = field_validator("password")(validate_password_strength)

    @field_validator("username")
    @classmethod
    def username_format(cls, v: str) -> str:
        if not USERNAME_RE.match(v):
            raise ValueError("Username must be 3-64 characters: letters, digits, '.', '_' or '-'")
        return v.lower()


class UserUpdate(BaseModel):
    email: EmailStr | None = None
    full_name: str | None = Field(default=None, min_length=2, max_length=128)
    role: str | None = None
    is_active: bool | None = None
    password: str | None = Field(default=None, max_length=128)

    @field_validator("password")
    @classmethod
    def password_strength(cls, v: str | None) -> str | None:
        return validate_password_strength(v) if v else v


class RoleOut(ORMModel):
    id: int
    name: str
    description: str
    permissions: list[str] = []
