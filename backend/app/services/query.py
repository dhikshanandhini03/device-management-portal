import csv
import io
import math
from collections.abc import Iterable
from datetime import datetime

from fastapi import HTTPException, Query
from fastapi.responses import StreamingResponse
from sqlalchemy import Select, func, select
from sqlalchemy.orm import Session


class PageParams:
    def __init__(
        self,
        page: int = Query(1, ge=1, le=100000),
        page_size: int = Query(25, ge=1, le=500),
    ):
        self.page = page
        self.page_size = page_size


def paginate(db: Session, stmt: Select, params: PageParams, scalars: bool = True):
    total = db.execute(select(func.count()).select_from(stmt.order_by(None).subquery())).scalar_one()
    result = db.execute(stmt.limit(params.page_size).offset((params.page - 1) * params.page_size))
    rows = result.unique().scalars().all() if scalars else result.unique().all()
    return rows, {
        "total": total,
        "page": params.page,
        "page_size": params.page_size,
        "pages": max(1, math.ceil(total / params.page_size)),
    }


def apply_sort(stmt: Select, sort_by: str | None, sort_dir: str, columns: dict, default):
    column = columns.get(sort_by or "", default)
    return stmt.order_by(column.desc() if sort_dir == "desc" else column.asc())


def validate_sort(sort_by: str | None, allowed: Iterable[str]) -> None:
    if sort_by and sort_by not in allowed:
        raise HTTPException(422, f"Invalid sort field '{sort_by}'. Allowed: {', '.join(sorted(allowed))}")


def _csv_safe(value) -> str:
    if value is None:
        return ""
    if isinstance(value, datetime):
        return value.isoformat()
    if isinstance(value, (int, float)):
        return str(value)
    text = str(value)
    # Neutralise spreadsheet formula injection.
    if text and text[0] in "=+-@\t\r":
        return "'" + text
    return text


def csv_response(filename: str, headers: list[str], rows: Iterable[Iterable]) -> StreamingResponse:
    buffer = io.StringIO()
    writer = csv.writer(buffer)
    writer.writerow(headers)
    for row in rows:
        writer.writerow([_csv_safe(v) for v in row])
    buffer.seek(0)
    return StreamingResponse(
        iter([buffer.getvalue()]),
        media_type="text/csv",
        headers={"Content-Disposition": f'attachment; filename="{filename}"'},
    )
