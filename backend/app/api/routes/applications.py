from fastapi import APIRouter, Depends, HTTPException, Query
from sqlalchemy import case, func, select
from sqlalchemy.orm import Session

from app.api.deps import require
from app.core.database import get_db
from app.core.permissions import Permission
from app.models import Application, Device, InstalledApplication, User
from app.schemas.common import Page
from app.schemas.ops import AppInstallationOut, ApplicationDetail, ApplicationOut
from app.services.devices import escape_like
from app.services.query import PageParams, paginate

router = APIRouter(prefix="/api/applications", tags=["Applications"])


def _stats_stmt():
    ia = InstalledApplication
    return (
        select(
            Application,
            func.count(ia.id).label("device_count"),
            func.count(func.distinct(ia.version)).label("version_count"),
            func.sum(case((ia.version == Application.latest_version, 1), else_=0)).label("latest_count"),
            func.sum(case((ia.version != Application.latest_version, 1), else_=0)).label("update_count"),
            func.sum(case((ia.status == "INSTALL_FAILED", 1), else_=0)).label("failed_count"),
            func.coalesce(func.sum(ia.usage_minutes_7d), 0).label("usage"),
            func.coalesce(func.sum(ia.crash_count_7d), 0).label("crashes"),
        )
        .outerjoin(ia, ia.application_id == Application.id)
        .group_by(Application.id)
    )


def _app_dict(row) -> dict:
    app = row[0]
    return {
        "id": app.id, "name": app.name, "package_id": app.package_id, "category": app.category,
        "publisher": app.publisher, "latest_version": app.latest_version, "description": app.description,
        "device_count": row.device_count or 0, "version_count": row.version_count or 0,
        "latest_count": int(row.latest_count or 0), "update_available_count": int(row.update_count or 0),
        "failed_count": int(row.failed_count or 0),
    }


@router.get("", response_model=list[ApplicationOut])
def list_applications(
    search: str | None = Query(None, max_length=64),
    category: str | None = None,
    update_available: bool | None = None,
    db: Session = Depends(get_db),
    _: User = Depends(require(Permission.APPLICATIONS_VIEW)),
):
    stmt = _stats_stmt()
    if search:
        term = f"%{escape_like(search.strip())}%"
        stmt = stmt.where(Application.name.ilike(term, escape="\\") | Application.package_id.ilike(term, escape="\\"))
    if category:
        stmt = stmt.where(Application.category == category)
    items = [_app_dict(r) for r in db.execute(stmt.order_by(Application.name)).all()]
    if update_available is not None:
        items = [i for i in items if (i["update_available_count"] > 0) == update_available]
    return items


@router.get("/{app_id}", response_model=ApplicationDetail)
def application_detail(app_id: int, db: Session = Depends(get_db), _: User = Depends(require(Permission.APPLICATIONS_VIEW))):
    row = db.execute(_stats_stmt().where(Application.id == app_id)).first()
    if row is None:
        raise HTTPException(404, "Application not found")
    data = _app_dict(row)
    total = data["device_count"] or 1
    versions = db.execute(
        select(InstalledApplication.version, func.count())
        .where(InstalledApplication.application_id == app_id)
        .group_by(InstalledApplication.version)
        .order_by(func.count().desc())
    ).all()
    statuses = db.execute(
        select(InstalledApplication.status, func.count())
        .where(InstalledApplication.application_id == app_id)
        .group_by(InstalledApplication.status)
    ).all()
    data.update(
        versions=[{"version": v, "device_count": c, "is_latest": v == data["latest_version"],
                   "percentage": round(100 * c / total, 1)} for v, c in versions],
        statuses=[{"status": s, "device_count": c} for s, c in statuses],
        usage_minutes_7d=int(row.usage),
        crash_count_7d=int(row.crashes),
    )
    return data


@router.get("/{app_id}/installations", response_model=Page[AppInstallationOut])
def application_installations(
    app_id: int,
    version: str | None = None,
    search: str | None = Query(None, max_length=64),
    params: PageParams = Depends(),
    db: Session = Depends(get_db),
    _: User = Depends(require(Permission.APPLICATIONS_VIEW)),
):
    if db.get(Application, app_id) is None:
        raise HTTPException(404, "Application not found")
    stmt = (
        select(InstalledApplication, Device.device_id, Device.serial_number, Device.model, Device.region)
        .join(Device, Device.id == InstalledApplication.device_pk)
        .where(InstalledApplication.application_id == app_id)
    )
    if version:
        stmt = stmt.where(InstalledApplication.version == version)
    if search:
        term = f"%{escape_like(search.strip())}%"
        stmt = stmt.where(Device.device_id.ilike(term, escape="\\") | Device.serial_number.ilike(term, escape="\\"))
    rows, meta = paginate(db, stmt.order_by(Device.device_id), params, scalars=False)
    items = [
        {"device_id": did, "serial_number": sn, "model": model, "region": region, "version": ia.version,
         "status": ia.status, "installed_at": ia.installed_at, "last_used_at": ia.last_used_at}
        for ia, did, sn, model, region in rows
    ]
    return {"items": items, **meta}
