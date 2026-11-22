from datetime import datetime, timedelta, timezone

from fastapi import APIRouter, Depends, HTTPException, Query, Request
from sqlalchemy import case, func, select
from sqlalchemy.orm import Session

from app.api.deps import require
from app.core.database import get_db
from app.core.permissions import Permission
from app.models import (
    Application,
    Device,
    DeviceCommand,
    DeviceEvent,
    DeviceStatus,
    FirmwareVersion,
    FleetSnapshot,
    InstalledApplication,
    User,
)
from app.models.base import utcnow
from app.services.audit import record_audit
from app.services.query import csv_response

router = APIRouter(prefix="/api/analytics", tags=["Analytics & Reports"])

REPORTS = ("availability", "registrations", "firmware", "models", "uptime", "failures", "applications", "activity")


class DateRange:
    def __init__(self, date_from: datetime | None = None, date_to: datetime | None = None):
        if date_from and date_from.tzinfo is None:
            date_from = date_from.replace(tzinfo=timezone.utc)
        if date_to and date_to.tzinfo is None:
            date_to = date_to.replace(tzinfo=timezone.utc)
        self.date_to = date_to or utcnow()
        self.date_from = date_from or (self.date_to - timedelta(days=30))
        if self.date_from >= self.date_to:
            raise HTTPException(422, "date_from must be before date_to")
        if self.date_to - self.date_from > timedelta(days=366):
            raise HTTPException(422, "Date range cannot exceed 366 days")


def _availability(db: Session, r: DateRange) -> list[dict]:
    day = func.date_trunc("day", FleetSnapshot.captured_at)
    rows = db.execute(
        select(day.label("d"), func.avg(FleetSnapshot.online_devices), func.avg(FleetSnapshot.offline_devices),
               func.avg(FleetSnapshot.total_devices), func.avg(FleetSnapshot.warning_devices),
               func.avg(FleetSnapshot.critical_devices))
        .where(FleetSnapshot.captured_at >= r.date_from, FleetSnapshot.captured_at <= r.date_to)
        .group_by("d").order_by("d")
    ).all()
    return [
        {"date": d, "online": round(on or 0), "offline": round(off or 0), "total": round(t or 0),
         "warning": round(w or 0), "critical": round(c or 0),
         "availability_pct": round(100 * (on or 0) / t, 2) if t else 0}
        for d, on, off, t, w, c in rows
    ]


def _registrations(db: Session, r: DateRange) -> list[dict]:
    day = func.date_trunc("day", Device.registered_at)
    rows = db.execute(
        select(day.label("d"), func.count()).where(Device.registered_at >= r.date_from, Device.registered_at <= r.date_to)
        .group_by("d").order_by("d")
    ).all()
    return [{"date": d, "registrations": c} for d, c in rows]


def _firmware(db: Session) -> list[dict]:
    rows = db.execute(
        select(FirmwareVersion.version, FirmwareVersion.model, FirmwareVersion.is_latest, func.count(Device.id))
        .join(Device, Device.firmware_version_id == FirmwareVersion.id)
        .group_by(FirmwareVersion.version, FirmwareVersion.model, FirmwareVersion.is_latest)
        .order_by(func.count(Device.id).desc())
    ).all()
    return [{"version": v, "model": m, "is_latest": l, "devices": c} for v, m, l, c in rows]


def _models(db: Session) -> list[dict]:
    rows = db.execute(
        select(Device.model, func.count(),
               func.sum(case((DeviceStatus.connection_status == "ONLINE", 1), else_=0)),
               func.avg(DeviceStatus.cpu_usage), func.avg(DeviceStatus.memory_usage))
        .join(DeviceStatus, DeviceStatus.device_pk == Device.id)
        .group_by(Device.model).order_by(func.count().desc())
    ).all()
    return [{"model": m, "devices": c, "online": int(on or 0), "avg_cpu": round(cpu or 0, 1),
             "avg_memory": round(mem or 0, 1)} for m, c, on, cpu, mem in rows]


def _uptime(db: Session) -> dict:
    uptime_h = func.extract("epoch", func.now() - DeviceStatus.last_boot_at) / 3600
    bucket = case(
        (uptime_h < 24, "< 1 day"), (uptime_h < 168, "1-7 days"), (uptime_h < 720, "7-30 days"), else_="> 30 days"
    )
    dist = dict(db.execute(
        select(bucket.label("b"), func.count()).where(DeviceStatus.connection_status == "ONLINE",
                                                      DeviceStatus.last_boot_at.is_not(None)).group_by("b")
    ).all())
    by_model = db.execute(
        select(Device.model, func.avg(uptime_h))
        .join(DeviceStatus, DeviceStatus.device_pk == Device.id)
        .where(DeviceStatus.connection_status == "ONLINE", DeviceStatus.last_boot_at.is_not(None))
        .group_by(Device.model).order_by(Device.model)
    ).all()
    order = ["< 1 day", "1-7 days", "7-30 days", "> 30 days"]
    return {
        "distribution": [{"bucket": b, "devices": dist.get(b, 0)} for b in order],
        "by_model": [{"model": m, "avg_uptime_hours": round(h or 0, 1)} for m, h in by_model],
    }


def _failures(db: Session, r: DateRange) -> list[dict]:
    day = func.date_trunc("day", DeviceEvent.created_at)
    rows = db.execute(
        select(day.label("d"),
               func.sum(case((DeviceEvent.event_type == "APP_CRASH", 1), else_=0)),
               func.sum(case((DeviceEvent.event_type == "CRITICAL_ERROR", 1), else_=0)),
               func.sum(case((DeviceEvent.event_type == "DISCONNECTED", 1), else_=0)),
               func.sum(case((DeviceEvent.event_type.in_(["COMMAND_FAILED", "FIRMWARE_UPDATE_FAILED"]), 1), else_=0)))
        .where(DeviceEvent.created_at >= r.date_from, DeviceEvent.created_at <= r.date_to)
        .group_by("d").order_by("d")
    ).all()
    return [{"date": d, "app_crashes": int(a or 0), "critical_errors": int(c or 0), "disconnections": int(x or 0),
             "operation_failures": int(o or 0)} for d, a, c, x, o in rows]


def _applications(db: Session) -> list[dict]:
    rows = db.execute(
        select(Application.name, Application.package_id, func.count(InstalledApplication.id),
               func.coalesce(func.sum(InstalledApplication.usage_minutes_7d), 0),
               func.coalesce(func.sum(InstalledApplication.crash_count_7d), 0))
        .join(InstalledApplication, InstalledApplication.application_id == Application.id)
        .group_by(Application.name, Application.package_id)
        .order_by(func.sum(InstalledApplication.usage_minutes_7d).desc())
    ).all()
    return [{"application": n, "package_id": p, "installations": c, "usage_hours_7d": round(u / 60, 1),
             "crashes_7d": int(k)} for n, p, c, u, k in rows]


def _activity(db: Session, r: DateRange) -> list[dict]:
    day = func.date_trunc("day", DeviceEvent.created_at)
    rows = db.execute(
        select(day.label("d"), DeviceEvent.event_type, func.count())
        .where(DeviceEvent.created_at >= r.date_from, DeviceEvent.created_at <= r.date_to)
        .group_by("d", DeviceEvent.event_type).order_by("d")
    ).all()
    by_day: dict = {}
    for d, t, c in rows:
        row = by_day.setdefault(d, {"date": d, "total": 0})
        row[t] = c
        row["total"] += c
    return list(by_day.values())


@router.get("/report")
def full_report(r: DateRange = Depends(), db: Session = Depends(get_db),
                _: User = Depends(require(Permission.ANALYTICS_VIEW))):
    availability = _availability(db, r)
    cmd = db.execute(
        select(func.count(), func.sum(case((DeviceCommand.status == "SUCCESSFUL", 1), else_=0)))
        .where(DeviceCommand.created_at >= r.date_from, DeviceCommand.created_at <= r.date_to)
    ).one()
    failures = _failures(db, r)
    return {
        "date_from": r.date_from,
        "date_to": r.date_to,
        "summary": {
            "total_devices": db.execute(select(func.count(Device.id))).scalar_one(),
            "new_registrations": sum(x["registrations"] for x in _registrations(db, r)),
            "avg_availability_pct": round(sum(a["availability_pct"] for a in availability) / len(availability), 2)
            if availability else 0,
            "failure_events": sum(f["app_crashes"] + f["critical_errors"] + f["operation_failures"] for f in failures),
            "commands_executed": cmd[0] or 0,
            "command_success_pct": round(100 * (cmd[1] or 0) / cmd[0], 1) if cmd[0] else 0,
        },
        "availability": availability,
        "registrations": _registrations(db, r),
        "firmware": _firmware(db),
        "models": _models(db),
        "uptime": _uptime(db),
        "failures": failures,
        "applications": _applications(db),
        "activity": _activity(db, r),
    }


@router.get("/export")
def export_report(
    request: Request,
    report: str = Query(..., pattern="^(" + "|".join(REPORTS) + ")$"),
    r: DateRange = Depends(),
    db: Session = Depends(get_db),
    user: User = Depends(require(Permission.ANALYTICS_VIEW)),
):
    if report == "availability":
        data = _availability(db, r)
    elif report == "registrations":
        data = _registrations(db, r)
    elif report == "firmware":
        data = _firmware(db)
    elif report == "models":
        data = _models(db)
    elif report == "uptime":
        data = _uptime(db)["by_model"]
    elif report == "failures":
        data = _failures(db, r)
    elif report == "applications":
        data = _applications(db)
    else:
        data = _activity(db, r)
    headers = sorted({k for row in data for k in row}, key=lambda k: (k not in ("date", "model", "version", "application"), k))
    record_audit(db, user=user, action="REPORT_EXPORTED", target_type="report", target_id=report, request=request,
                 details={"rows": len(data), "date_from": r.date_from.isoformat(), "date_to": r.date_to.isoformat()})
    db.commit()
    return csv_response(
        f"bell-stb-{report}-report.csv", headers, ([row.get(h, 0) for h in headers] for row in data)
    )
