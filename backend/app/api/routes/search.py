from fastapi import APIRouter, Depends, Query
from sqlalchemy.orm import Session

from app.api.deps import require
from app.core.database import get_db
from app.core.permissions import Permission
from app.models import Device, User
from app.services.devices import apply_device_filters, device_select, serialize_device

router = APIRouter(prefix="/api/search", tags=["Search"])


@router.get("")
def global_search(
    q: str = Query(..., min_length=2, max_length=64),
    limit: int = Query(8, ge=1, le=25),
    db: Session = Depends(get_db),
    _: User = Depends(require(Permission.DEVICES_VIEW)),
):
    stmt = apply_device_filters(device_select(), search=q).order_by(Device.device_id).limit(limit)
    return [serialize_device(d, latest) for d, latest in db.execute(stmt).unique().all()]
