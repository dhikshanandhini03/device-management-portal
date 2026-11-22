"""Backend housekeeping loop: command dispatch/timeouts, deployment scheduling, telemetry roll-up, fleet snapshots."""

import asyncio
import logging
from datetime import timedelta

from sqlalchemy import delete, func, select, text, update

from app.core.config import settings
from app.core.database import SessionLocal
from app.models import DeploymentTarget, DeviceCommand, DeviceStatus, DeviceTelemetry, FirmwareDeployment, FleetSnapshot
from app.models.base import utcnow
from app.services.alerts import get_settings_map, setting_float
from app.services.commands import transition
from app.services.deployments import finalize_if_done

log = logging.getLogger("worker")

ROLLUP_SQL = text(
    """
    INSERT INTO device_telemetry_hourly
        (device_pk, bucket, avg_cpu, max_cpu, avg_memory, max_memory, avg_storage, avg_temperature, avg_latency, samples)
    SELECT device_pk, date_trunc('hour', recorded_at) AS bucket,
           avg(cpu_usage), max(cpu_usage), avg(memory_usage), max(memory_usage), avg(storage_usage),
           avg(temperature_c), avg(latency_ms), count(*)
    FROM device_telemetry
    WHERE recorded_at >= :since AND recorded_at < date_trunc('hour', now())
    GROUP BY device_pk, date_trunc('hour', recorded_at)
    ON CONFLICT (device_pk, bucket) DO UPDATE SET
        avg_cpu = EXCLUDED.avg_cpu, max_cpu = EXCLUDED.max_cpu, avg_memory = EXCLUDED.avg_memory,
        max_memory = EXCLUDED.max_memory, avg_storage = EXCLUDED.avg_storage,
        avg_temperature = EXCLUDED.avg_temperature, avg_latency = EXCLUDED.avg_latency, samples = EXCLUDED.samples
    """
)


def process_commands() -> None:
    with SessionLocal() as db:
        now = utcnow()
        for cmd in db.execute(select(DeviceCommand).where(DeviceCommand.status == "PENDING")).unique().scalars():
            transition(db, cmd, "QUEUED", "Validated and queued for delivery")
        expired = db.execute(
            select(DeviceCommand).where(
                DeviceCommand.status.in_(["QUEUED", "SENT", "ACKNOWLEDGED", "EXECUTING"]), DeviceCommand.expires_at < now
            )
        ).unique().scalars().all()
        for cmd in expired:
            stage = cmd.status
            transition(db, cmd, "TIMED_OUT", f"No response from device within {cmd.timeout_seconds}s (last stage: {stage})")
        db.commit()


def process_deployments() -> None:
    with SessionLocal() as db:
        now = utcnow()
        s = get_settings_map(db)
        window = timedelta(seconds=setting_float(s, "deployment_target_timeout_seconds"))
        for d in db.execute(
            select(FirmwareDeployment).where(FirmwareDeployment.status == "SCHEDULED", FirmwareDeployment.scheduled_at <= now)
        ).unique().scalars():
            d.status = "IN_PROGRESS"
            d.started_at = now
            if d.offline_policy == "SKIP":
                offline = select(DeviceStatus.device_pk).where(DeviceStatus.connection_status != "ONLINE")
                db.execute(
                    update(DeploymentTarget)
                    .where(DeploymentTarget.deployment_id == d.id, DeploymentTarget.status == "PENDING",
                           DeploymentTarget.device_pk.in_(offline))
                    .values(status="FAILED", error_message="Device offline at deployment start (skip policy)",
                            updated_at=now)
                )
        db.flush()
        for d in db.execute(select(FirmwareDeployment).where(FirmwareDeployment.status == "IN_PROGRESS")).unique().scalars():
            if d.started_at and now - d.started_at > window:
                db.execute(
                    update(DeploymentTarget)
                    .where(DeploymentTarget.deployment_id == d.id, DeploymentTarget.status == "PENDING")
                    .values(status="FAILED", error_message="Device unreachable during deployment window", updated_at=now)
                )
            stuck = now - timedelta(seconds=max(120.0, window.total_seconds() / 2))
            db.execute(
                update(DeploymentTarget)
                .where(DeploymentTarget.deployment_id == d.id,
                       DeploymentTarget.status.in_(["DOWNLOADING", "INSTALLING"]), DeploymentTarget.updated_at < stuck)
                .values(status="FAILED", error_message="Device stopped reporting update progress", updated_at=now)
            )
            db.flush()
            finalize_if_done(db, d)
        db.commit()


def rollup_telemetry() -> None:
    with SessionLocal() as db:
        s = get_settings_map(db)
        retention = timedelta(hours=setting_float(s, "telemetry_raw_retention_hours"))
        now = utcnow()
        db.execute(ROLLUP_SQL, {"since": now - timedelta(hours=3)})
        db.execute(delete(DeviceTelemetry).where(DeviceTelemetry.recorded_at < now - retention))
        db.commit()


def capture_snapshot() -> None:
    with SessionLocal() as db:
        bucket = utcnow().replace(minute=0, second=0, microsecond=0)
        counts = dict(db.execute(select(DeviceStatus.connection_status, func.count()).group_by(DeviceStatus.connection_status)).all())
        health = dict(db.execute(select(DeviceStatus.health_status, func.count()).group_by(DeviceStatus.health_status)).all())
        snap = db.execute(select(FleetSnapshot).where(FleetSnapshot.captured_at == bucket)).scalar_one_or_none()
        if snap is None:
            snap = FleetSnapshot(captured_at=bucket)
            db.add(snap)
        snap.total_devices = sum(counts.values())
        snap.online_devices = counts.get("ONLINE", 0)
        snap.offline_devices = counts.get("OFFLINE", 0) + counts.get("REBOOTING", 0)
        snap.warning_devices = health.get("WARNING", 0)
        snap.critical_devices = health.get("CRITICAL", 0)
        db.commit()


async def run_worker(stop: asyncio.Event) -> None:
    tick = 0
    interval = 1.0
    slow_every = max(1, int(settings.background_interval_seconds))
    while not stop.is_set():
        try:
            await asyncio.to_thread(process_commands)
            if tick % slow_every == 0:
                await asyncio.to_thread(process_deployments)
            if tick % 300 == 0:
                await asyncio.to_thread(rollup_telemetry)
            if tick % 60 == 0:
                await asyncio.to_thread(capture_snapshot)
        except Exception:  # keep the loop alive; errors are logged
            log.exception("Background worker iteration failed")
        tick += 1
        try:
            await asyncio.wait_for(stop.wait(), timeout=interval)
        except asyncio.TimeoutError:
            pass
