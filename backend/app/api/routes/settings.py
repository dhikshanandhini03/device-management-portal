import httpx
from fastapi import APIRouter, Depends, HTTPException, Request
from sqlalchemy import select
from sqlalchemy.orm import Session

from app.api.deps import get_current_user, require
from app.core.config import settings
from app.core.database import get_db
from app.core.permissions import Permission
from app.models import SystemSetting, User
from app.models.base import utcnow
from app.schemas.ops import SettingsUpdate
from app.services.alerts import DEFAULT_SETTINGS, get_settings_map
from app.services.audit import record_audit

router = APIRouter(tags=["Settings & Simulator"])

BOOL_KEYS = {"offline_alerts_enabled"}
LIMITS = {
    "cpu_alert_threshold": (50, 100), "memory_alert_threshold": (50, 100), "cpu_warning_threshold": (30, 100),
    "memory_warning_threshold": (30, 100), "storage_warning_threshold": (50, 100),
    "temperature_critical_threshold": (50, 110), "command_default_timeout_seconds": (10, 3600),
    "deployment_target_timeout_seconds": (30, 86400), "telemetry_raw_retention_hours": (1, 168),
}


@router.get("/api/settings")
def get_settings(db: Session = Depends(get_db), _: User = Depends(get_current_user)):
    values = get_settings_map(db)
    stored = {s.key: s for s in db.execute(select(SystemSetting)).scalars()}
    return [
        {"key": k, "value": values[k], "description": desc,
         "updated_at": stored[k].updated_at if k in stored else None,
         "type": "boolean" if k in BOOL_KEYS else "number", "min": LIMITS.get(k, (None, None))[0],
         "max": LIMITS.get(k, (None, None))[1]}
        for k, (_default, desc) in DEFAULT_SETTINGS.items()
    ]


@router.put("/api/settings")
def update_settings(body: SettingsUpdate, request: Request, db: Session = Depends(get_db),
                    user: User = Depends(require(Permission.SETTINGS_MANAGE))):
    current = get_settings_map(db)
    changes = {}
    for key, raw in body.values.items():
        if key not in DEFAULT_SETTINGS:
            raise HTTPException(422, f"Unknown setting '{key}'")
        value = str(raw).strip().lower() if key in BOOL_KEYS else str(raw).strip()
        if key in BOOL_KEYS:
            if value not in ("true", "false"):
                raise HTTPException(422, f"'{key}' must be true or false")
        else:
            try:
                num = float(value)
            except ValueError:
                raise HTTPException(422, f"'{key}' must be numeric")
            lo, hi = LIMITS[key]
            if not lo <= num <= hi:
                raise HTTPException(422, f"'{key}' must be between {lo} and {hi}")
        if current.get(key) != value:
            changes[key] = {"from": current.get(key), "to": value}
            row = db.get(SystemSetting, key)
            if row is None:
                db.add(SystemSetting(key=key, value=value, description=DEFAULT_SETTINGS[key][1], updated_at=utcnow()))
            else:
                row.value = value
    if changes:
        record_audit(db, user=user, action="CONFIGURATION_CHANGED", target_type="settings", target_id="system",
                     request=request, details=changes)
    db.commit()
    return get_settings(db, user)


async def _simulator(method: str, path: str) -> dict:
    try:
        async with httpx.AsyncClient(timeout=10) as client:
            resp = await client.request(method, f"{settings.simulator_url}{path}")
            resp.raise_for_status()
            return resp.json()
    except httpx.HTTPError as exc:
        raise HTTPException(503, f"Device simulator unavailable: {exc.__class__.__name__}")


@router.get("/api/simulator/status")
async def simulator_status(_: User = Depends(require(Permission.DASHBOARD_VIEW))):
    return await _simulator("GET", "/status")


@router.post("/api/simulator/{action}")
async def simulator_action(action: str, request: Request, db: Session = Depends(get_db),
                           user: User = Depends(require(Permission.SETTINGS_MANAGE))):
    if action not in ("start", "stop", "reset"):
        raise HTTPException(404, "Unknown simulator action")
    try:
        result = await _simulator("POST", f"/{action}")
        outcome = "SUCCESS"
    except HTTPException:
        result, outcome = None, "FAILURE"
    record_audit(db, user=user, action=f"SIMULATOR_{action.upper()}", target_type="simulator", target_id="stb-simulator",
                 result=outcome, request=request)
    db.commit()
    if result is None:
        raise HTTPException(503, "Device simulator unavailable")
    return result
