from collections import defaultdict

from sqlalchemy import func, select
from sqlalchemy.orm import Session

from app.models import DeploymentTarget, FirmwareDeployment
from app.models.base import utcnow

IN_PROGRESS_TARGET_STATUSES = ("DOWNLOADING", "INSTALLING")


def target_counts(db: Session, deployment_ids: list[int]) -> dict[int, dict[str, int]]:
    counts: dict[int, dict[str, int]] = defaultdict(lambda: defaultdict(int))
    if not deployment_ids:
        return counts
    rows = db.execute(
        select(DeploymentTarget.deployment_id, DeploymentTarget.status, func.count())
        .where(DeploymentTarget.deployment_id.in_(deployment_ids))
        .group_by(DeploymentTarget.deployment_id, DeploymentTarget.status)
    ).all()
    for dep_id, status, n in rows:
        counts[dep_id][status] = n
    return counts


def serialize_deployment(d: FirmwareDeployment, counts: dict[str, int], rollback_code: str | None = None) -> dict:
    total = sum(counts.values())
    success = counts.get("SUCCESS", 0)
    failed = counts.get("FAILED", 0)
    in_progress = sum(counts.get(s, 0) for s in IN_PROGRESS_TARGET_STATUSES)
    pending = counts.get("PENDING", 0)
    return {
        "id": d.id,
        "deployment_code": d.deployment_code,
        "name": d.name,
        "firmware_version_id": d.firmware_version_id,
        "firmware_version": d.firmware.version,
        "model": d.firmware.model,
        "status": d.status,
        "is_rollback": d.is_rollback,
        "rollback_of": rollback_code,
        "offline_policy": d.offline_policy,
        "target_count": total,
        "successful_count": success,
        "failed_count": failed,
        "pending_count": pending,
        "in_progress_count": in_progress,
        "progress_pct": round(100 * (success + failed) / total, 1) if total else 0.0,
        "scheduled_at": d.scheduled_at,
        "started_at": d.started_at,
        "completed_at": d.completed_at,
        "created_by": d.created_by.username if d.created_by else None,
        "created_at": d.created_at,
    }


def finalize_if_done(db: Session, d: FirmwareDeployment) -> None:
    if d.status != "IN_PROGRESS":
        return
    counts = target_counts(db, [d.id])[d.id]
    open_targets = counts.get("PENDING", 0) + sum(counts.get(s, 0) for s in IN_PROGRESS_TARGET_STATUSES)
    if open_targets:
        return
    success, failed = counts.get("SUCCESS", 0), counts.get("FAILED", 0)
    if failed == 0:
        d.status = "COMPLETED"
    elif success == 0:
        d.status = "FAILED"
    else:
        d.status = "COMPLETED_WITH_ERRORS"
    d.completed_at = utcnow()
