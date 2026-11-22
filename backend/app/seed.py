"""Seed the database with roles, demo users and a simulated fleet of Bell STB devices.

All device data generated here is SIMULATED and fictional. Run: python -m app.seed
"""

import hashlib
import logging
import random
from datetime import datetime, timedelta, timezone

from sqlalchemy import func, insert, select, text
from sqlalchemy.orm import Session

from app.core.config import settings
from app.core.database import SessionLocal
from app.core.logging import configure_logging
from app.core.security import hash_password
from app.models import (
    Alert,
    Application,
    AuditLog,
    DeploymentTarget,
    Device,
    DeviceCommand,
    DeviceCommandHistory,
    DeviceEvent,
    DeviceLog,
    DeviceStatus,
    DeviceTelemetry,
    DeviceTelemetryHourly,
    FirmwareDeployment,
    FirmwareVersion,
    FleetSnapshot,
    InstalledApplication,
    Role,
    SystemSetting,
    User,
)
from app.services.alerts import DEFAULT_SETTINGS

log = logging.getLogger("seed")
rng = random.Random(20261122)

ROLES = [
    ("ADMIN", "Full access: users, firmware deployments, remote commands, audit logs, settings"),
    ("SUPPORT_ENGINEER", "Device inspection, diagnostics, authorised remote commands and alert handling"),
    ("READ_ONLY", "View-only access to dashboards, inventory, device details and reports"),
]

# (model, serial prefix, hardware revisions, OS family, versions oldest -> newest, Android-based)
MODELS = [
    ("VIP2262", "CS2262", ["1.0", "1.2"], "MediaroomOS", ["3.8.12", "3.9.4", "3.10.2", "3.11.0"], False),
    ("VIP5662W", "AR5662", ["2.0", "2.1", "2.3"], "MediaroomOS", ["4.2.7", "4.3.1", "4.4.0", "4.5.2"], False),
    ("VIP4302", "CS4302", ["1.1", "1.4"], "MediaroomOS", ["3.10.5", "3.11.2", "3.12.0"], False),
    ("Fibe 4K Box (FTB-4K10)", "FB4K10", ["A1", "A2", "B1"], "Android TV 11", ["11.2.3", "11.3.0", "11.4.1", "11.5.0"], True),
    ("Fibe TV App Box (ATV-200)", "ATV200", ["R1", "R2"], "Android TV 12", ["12.0.8", "12.1.2", "12.2.0"], True),
]
MODEL_WEIGHTS = [0.18, 0.27, 0.12, 0.28, 0.15]

REGIONS = {
    "Ontario": ["Toronto", "Ottawa", "Mississauga", "Hamilton", "London", "Kingston", "Barrie", "Sudbury"],
    "Quebec": ["Montreal", "Quebec City", "Laval", "Gatineau", "Sherbrooke", "Trois-Rivieres"],
    "Atlantic": ["Halifax", "Moncton", "Saint John", "St. John's", "Fredericton", "Charlottetown"],
    "Manitoba": ["Winnipeg", "Brandon", "Steinbach"],
}
REGION_WEIGHTS = [0.48, 0.32, 0.13, 0.07]

APPLICATIONS = [
    ("Fibe TV", "ca.bell.fibetv", "Live TV", "Bell Canada", ["8.4.1", "8.5.0", "8.6.2"], "system"),
    ("Fibe Guide", "ca.bell.fibe.guide", "Live TV", "Bell Canada", ["5.1.0", "5.2.3"], "system"),
    ("STB Diagnostics Agent", "ca.bell.stb.diagnostics", "System", "Bell Canada", ["2.0.4", "2.1.0", "2.2.1"], "system"),
    ("Fibe PVR", "ca.bell.fibe.pvr", "Live TV", "Bell Canada", ["3.3.0", "3.4.1"], "system"),
    ("Crave", "ca.bell.crave", "Streaming", "Bell Media", ["6.9.0", "7.0.2", "7.1.0"], "android"),
    ("Netflix", "com.netflix.ninja", "Streaming", "Netflix", ["9.12.0", "9.14.1", "9.15.0"], "android"),
    ("YouTube", "com.google.android.youtube.tv", "Streaming", "Google", ["4.40.3", "4.41.0"], "android"),
    ("Prime Video", "com.amazon.amazonvideo.livingroom", "Streaming", "Amazon", ["6.15.1", "6.16.0"], "android"),
    ("Disney+", "com.disney.disneyplus", "Streaming", "Disney", ["2.24.0", "2.25.1"], "android"),
    ("TSN", "ca.bell.tsn", "Sports", "Bell Media", ["4.2.0", "4.3.0"], "optional"),
    ("CTV", "ca.bell.ctv", "Entertainment", "Bell Media", ["3.8.2", "3.9.0"], "optional"),
    ("RDS", "ca.bell.rds", "Sports", "Bell Media", ["4.1.1", "4.2.0"], "optional"),
    ("Spotify", "com.spotify.tv.android", "Music", "Spotify", ["1.80.0", "1.82.3"], "android"),
]

LOG_TEMPLATES = {
    "INFO": [
        ("SYSTEM", "sysmgr", "Scheduled maintenance window completed"),
        ("NETWORK", "netd", "DHCP lease renewed for {ip}"),
        ("APPLICATION", "appmgr", "Application ca.bell.fibetv resumed from standby"),
        ("FIRMWARE", "fw-updater", "Firmware integrity check passed"),
        ("SYSTEM", "epg-sync", "EPG data synchronised (14 days, 412 channels)"),
    ],
    "WARNING": [
        ("NETWORK", "netd", "Packet loss of {loss}% detected on uplink"),
        ("HARDWARE", "thermal", "SoC temperature elevated: {temp} C"),
        ("APPLICATION", "appmgr", "Application response time exceeded 3000 ms"),
        ("SYSTEM", "storage", "Recording partition usage above 85%"),
        ("NETWORK", "wifi", "Wi-Fi signal degraded to {signal} dBm"),
    ],
    "ERROR": [
        ("APPLICATION", "appmgr", "Application com.netflix.ninja terminated unexpectedly (SIGSEGV)"),
        ("NETWORK", "multicast", "IGMP join failed for channel group 239.1.1.{n}"),
        ("SYSTEM", "drm", "DRM license acquisition failed (code 0x8004C{n})"),
        ("FIRMWARE", "fw-updater", "Delta package download interrupted"),
    ],
    "CRITICAL": [
        ("HARDWARE", "storage", "Filesystem error detected on /data - remounted read-only"),
        ("SYSTEM", "kernel", "Kernel watchdog reset triggered"),
        ("HARDWARE", "thermal", "Thermal shutdown threshold reached"),
    ],
}

EVENT_TYPES = [
    ("CONNECTED", "INFO", "Device connected"),
    ("DISCONNECTED", "WARNING", "Heartbeat lost - device disconnected"),
    ("REBOOT", "INFO", "Device rebooted (scheduled maintenance)"),
    ("APP_CRASH", "ERROR", "Application crash detected"),
    ("CONFIG_SYNC", "INFO", "Configuration synchronised with headend"),
    ("NETWORK_CHANGE", "INFO", "Network interface changed"),
    ("CRITICAL_ERROR", "CRITICAL", "Critical system error reported"),
]
EVENT_WEIGHTS = [0.26, 0.2, 0.18, 0.12, 0.14, 0.07, 0.03]


def _now() -> datetime:
    return datetime.now(timezone.utc).replace(microsecond=0)


def _mac(used: set[str]) -> str:
    while True:
        mac = "00:1E:46:" + ":".join(f"{rng.randint(0, 255):02X}" for _ in range(3))
        if mac not in used:
            used.add(mac)
            return mac


def seed_roles_and_users(db: Session) -> dict[str, User]:
    roles = {name: Role(name=name, description=desc) for name, desc in ROLES}
    db.add_all(roles.values())
    db.flush()
    people = [
        ("admin", "admin@bellstb.local", "Alex Morgan", "ADMIN", settings.seed_admin_password, True),
        ("support", "support@bellstb.local", "Samira Haddad", "SUPPORT_ENGINEER", settings.seed_support_password, True),
        ("readonly", "readonly@bellstb.local", "Ryan Leblanc", "READ_ONLY", settings.seed_readonly_password, True),
        ("m.gagnon", "m.gagnon@bellstb.local", "Marie Gagnon", "SUPPORT_ENGINEER", settings.seed_support_password, True),
        ("d.okafor", "d.okafor@bellstb.local", "David Okafor", "ADMIN", settings.seed_admin_password, True),
        ("p.nguyen", "p.nguyen@bellstb.local", "Paul Nguyen", "READ_ONLY", settings.seed_readonly_password, True),
        ("j.tremblay", "j.tremblay@bellstb.local", "Julie Tremblay", "SUPPORT_ENGINEER", settings.seed_support_password, False),
    ]
    users = {}
    hashes: dict[str, str] = {}
    for username, email, name, role, pwd, active in people:
        hashes.setdefault(pwd, hash_password(pwd))
        u = User(username=username, email=email, full_name=name, role_id=roles[role].id, hashed_password=hashes[pwd],
                 is_active=active)
        db.add(u)
        users[username] = u
    db.flush()
    return users


def seed_firmware(db: Session) -> dict[str, list[FirmwareVersion]]:
    out: dict[str, list[FirmwareVersion]] = {}
    now = _now()
    for model, _prefix, _hw, os_family, versions, _android in MODELS:
        out[model] = []
        n = len(versions)
        for i, v in enumerate(versions):
            age_days = (n - 1 - i) * 75 + rng.randint(5, 30)
            fw = FirmwareVersion(
                version=v, model=model, os_version=f"{os_family} ({v.rsplit('.', 1)[0]})",
                release_date=now - timedelta(days=age_days),
                release_notes=rng.choice([
                    "Security patches, improved channel change time and EPG stability fixes.",
                    "Adds HDR10+ passthrough, fixes HDMI-CEC wake issues and reduces memory footprint.",
                    "Improves Wi-Fi roaming, updates DRM components and resolves PVR playback stutter.",
                    "Performance improvements for 4K streaming apps and updated diagnostics agent hooks.",
                ]),
                file_size_mb=round(rng.uniform(180, 920), 1),
                checksum_sha256=hashlib.sha256(f"{model}:{v}".encode()).hexdigest(),
                status="DEPRECATED" if i == 0 and n > 3 else "ACTIVE",
                is_latest=i == n - 1,
            )
            db.add(fw)
            out[model].append(fw)
        beta = versions[-1].split(".")
        beta_ver = f"{beta[0]}.{int(beta[1]) + 1}.0-beta"
        fw = FirmwareVersion(
            version=beta_ver, model=model, os_version=f"{os_family} ({beta[0]}.{int(beta[1]) + 1})",
            release_date=now - timedelta(days=rng.randint(2, 10)),
            release_notes="Beta build for lab validation. Not for general deployment.",
            file_size_mb=round(rng.uniform(200, 950), 1),
            checksum_sha256=hashlib.sha256(f"{model}:{beta_ver}".encode()).hexdigest(),
            status="BETA", is_latest=False,
        )
        db.add(fw)
        out[model].append(fw)
    db.flush()
    return out


def seed_applications(db: Session) -> list[tuple[Application, list[str], str]]:
    apps = []
    for name, pkg, cat, pub, versions, kind in APPLICATIONS:
        a = Application(name=name, package_id=pkg, category=cat, publisher=pub, latest_version=versions[-1],
                        description=f"{name} application for Bell set-top boxes ({pub}).")
        db.add(a)
        apps.append((a, versions, kind))
    db.flush()
    return apps


def seed_devices(db: Session, firmware: dict[str, list[FirmwareVersion]], apps) -> list[dict]:
    now = _now()
    n = settings.seed_device_count
    macs: set[str] = set()
    devices, statuses, installs = [], [], []
    seq = 104_000
    for i in range(1, n + 1):
        model, prefix, hw, _os, _versions, android = rng.choices(MODELS, weights=MODEL_WEIGHTS)[0]
        region = rng.choices(list(REGIONS), weights=REGION_WEIGHTS)[0]
        seq += rng.randint(1, 37)
        year = rng.choice([23, 24, 25, 26])
        serial = f"{prefix}{year}{seq:06d}"
        fw_list = [f for f in firmware[model] if f.status != "BETA"]
        weights = [0.05] * (len(fw_list) - 2) + [0.25, 0.6] if len(fw_list) > 2 else [0.3, 0.7]
        weights = weights[-len(fw_list):]
        fw = rng.choices(fw_list, weights=weights)[0]
        registered = now - timedelta(days=min(1080, int(rng.expovariate(1 / 300))), hours=rng.randint(0, 23))
        profile = "STABLE_ONLINE" if i <= 10 else ("STABLE_OFFLINE" if i <= 15 else "STANDARD")
        online = profile == "STABLE_ONLINE" or (profile == "STANDARD" and rng.random() < 0.87)
        wifi = rng.random() < 0.3
        r = rng.random()
        if r < 0.015:
            cpu, mem = rng.uniform(95, 99), rng.uniform(85, 97)
        elif r < 0.08:
            cpu, mem = rng.uniform(80, 92), rng.uniform(70, 89)
        else:
            cpu, mem = rng.uniform(6, 55), rng.uniform(28, 68)
        storage = rng.uniform(15, 88) if rng.random() > 0.03 else rng.uniform(90, 97)
        temp = rng.uniform(42, 62) + (cpu / 10)
        if not online:
            health = rng.choices(["HEALTHY", "WARNING"], weights=[0.85, 0.15])[0]
        elif cpu >= 95 or mem >= 95:
            health = "CRITICAL"
        elif cpu >= 80 or mem >= 80 or storage >= 90:
            health = "WARNING"
        else:
            health = "HEALTHY"
        boot = now - timedelta(hours=rng.uniform(1, 24 * 45))
        last_seen = now - timedelta(seconds=rng.randint(5, 60)) if online else now - timedelta(hours=rng.uniform(0.3, 24 * 9))
        devices.append({
            "id": i, "device_id": f"STB-{serial[-8:]}", "serial_number": serial, "mac_address": _mac(macs),
            "model": model, "hardware_version": rng.choice(hw), "firmware_version_id": fw.id, "os_version": fw.os_version,
            "ip_address": f"100.{rng.randint(64, 127)}.{rng.randint(0, 255)}.{rng.randint(1, 254)}",
            "customer_ref": f"BAN-{rng.randint(500000000, 599999999)}", "region": region,
            "city": rng.choice(REGIONS[region]), "simulation_profile": profile, "registered_at": registered,
            "created_at": registered, "updated_at": now,
        })
        statuses.append({
            "device_pk": i, "connection_status": "ONLINE" if online else "OFFLINE", "health_status": health,
            "last_seen_at": last_seen, "last_boot_at": boot if online else boot - timedelta(days=2),
            "last_connected_at": boot + timedelta(seconds=40) if online else last_seen - timedelta(days=rng.randint(1, 20)),
            "last_disconnected_at": None if (online and rng.random() < 0.4) else (
                last_seen if not online else boot - timedelta(minutes=rng.randint(1, 30))),
            "cpu_usage": round(cpu if online else 0, 1), "memory_usage": round(mem if online else 0, 1),
            "storage_usage": round(storage, 1), "temperature_c": round(temp, 1),
            "network_type": "WIFI" if wifi else "ETHERNET",
            "signal_strength_dbm": round(rng.uniform(-78, -38), 0) if wifi else None,
            "bandwidth_mbps": round(rng.uniform(25, 95) if wifi else rng.uniform(80, 940), 1) if online else 0,
            "latency_ms": round(rng.uniform(12, 45) if wifi else rng.uniform(4, 18), 1) if online else 0,
            "packet_loss_pct": round(rng.choice([0, 0, 0, 0.1, 0.3, 0.8, 2.4]), 1) if online else 0,
            "updated_at": now,
        })
        for app, versions, kind in apps:
            if kind == "android" and not android:
                continue
            if kind == "optional" and rng.random() > 0.55:
                continue
            if kind == "android" and rng.random() > 0.8:
                continue
            vw = [0.1] * (len(versions) - 1) + [0.7]
            version = rng.choices(versions, weights=vw)[0]
            status = "INSTALLED"
            if version != versions[-1]:
                status = "UPDATE_AVAILABLE"
            if rng.random() < 0.01:
                status = "INSTALL_FAILED"
            installs.append({
                "device_pk": i, "application_id": app.id, "version": version, "status": status,
                "installed_at": registered + timedelta(days=rng.randint(0, 30)),
                "last_used_at": now - timedelta(hours=rng.uniform(0.2, 240)) if rng.random() < 0.85 else None,
                "usage_minutes_7d": int(rng.expovariate(1 / (600 if app.category in ("Live TV", "Streaming") else 120))),
                "crash_count_7d": rng.choices([0, 1, 2, 4], weights=[0.86, 0.09, 0.04, 0.01])[0],
            })
    db.execute(insert(Device), devices)
    db.execute(insert(DeviceStatus), statuses)
    db.execute(insert(InstalledApplication), installs)
    db.execute(text("SELECT setval(pg_get_serial_sequence('devices', 'id'), (SELECT max(id) FROM devices))"))
    return [{**d, **s} for d, s in zip(devices, statuses)]


def seed_telemetry(db: Session, fleet: list[dict]) -> None:
    now = _now()
    hour0 = now.replace(minute=0, second=0)
    hourly, raw = [], []
    for d in fleet:
        base_cpu = max(5.0, d["cpu_usage"] or rng.uniform(10, 40))
        base_mem = max(20.0, d["memory_usage"] or rng.uniform(30, 60))
        for h in range(7 * 24, 0, -1):
            bucket = hour0 - timedelta(hours=h)
            if d["connection_status"] == "OFFLINE" and bucket > d["last_seen_at"]:
                continue
            diurnal = 1 + 0.35 * (1 if 18 <= bucket.hour <= 23 else (-0.4 if 2 <= bucket.hour <= 6 else 0))
            cpu = min(99.0, max(2.0, rng.gauss(base_cpu * 0.8 * diurnal, 6)))
            mem = min(99.0, max(15.0, rng.gauss(base_mem * 0.95, 4)))
            hourly.append({
                "device_pk": d["id"], "bucket": bucket, "avg_cpu": round(cpu, 1), "max_cpu": round(min(100, cpu + rng.uniform(5, 25)), 1),
                "avg_memory": round(mem, 1), "max_memory": round(min(100, mem + rng.uniform(2, 10)), 1),
                "avg_storage": d["storage_usage"], "avg_temperature": round((d["temperature_c"] or 50) + rng.uniform(-3, 3), 1),
                "avg_latency": round(max(2, rng.gauss(d["latency_ms"] or 15, 3)), 1), "samples": 60,
            })
        if d["connection_status"] == "ONLINE":
            for m in range(120, -1, -5):
                ts = now - timedelta(minutes=m)
                raw.append({
                    "device_pk": d["id"], "recorded_at": ts,
                    "cpu_usage": round(min(99.0, max(2.0, rng.gauss(d["cpu_usage"], 5))), 1),
                    "memory_usage": round(min(99.0, max(10.0, rng.gauss(d["memory_usage"], 3))), 1),
                    "storage_usage": d["storage_usage"], "temperature_c": round(d["temperature_c"] + rng.uniform(-2, 2), 1),
                    "latency_ms": round(max(1, rng.gauss(d["latency_ms"], 2)), 1), "bandwidth_mbps": d["bandwidth_mbps"],
                })
        if len(hourly) > 20000:
            db.execute(insert(DeviceTelemetryHourly), hourly)
            hourly = []
    if hourly:
        db.execute(insert(DeviceTelemetryHourly), hourly)
    for i in range(0, len(raw), 20000):
        db.execute(insert(DeviceTelemetry), raw[i:i + 20000])


def seed_snapshots(db: Session, total: int) -> None:
    now = _now().replace(minute=0, second=0)
    rows = []
    for h in range(90 * 24, 0, -1):
        ts = now - timedelta(hours=h)
        size = int(total * (0.9 + 0.1 * (1 - h / (90 * 24))))
        evening = 18 <= ts.hour <= 23
        online_pct = min(0.97, max(0.78, rng.gauss(0.9 if evening else 0.86, 0.025)))
        online = int(size * online_pct)
        rows.append({"captured_at": ts, "total_devices": size, "online_devices": online, "offline_devices": size - online,
                     "warning_devices": int(size * rng.uniform(0.04, 0.09)),
                     "critical_devices": int(size * rng.uniform(0.005, 0.02))})
    db.execute(insert(FleetSnapshot), rows)


def _log_message(template: str, d: dict) -> str:
    return template.format(ip=d["ip_address"], loss=rng.choice([2.1, 3.4, 5.8]), temp=rng.randint(71, 79),
                           signal=rng.randint(-82, -74), n=rng.randint(10, 99))


def seed_events_and_logs(db: Session, fleet: list[dict], apps) -> None:
    now = _now()
    events, logs = [], []
    app_pkgs = [a.package_id for a, _, _ in apps]
    for d in fleet:
        events.append({"device_pk": d["id"], "event_type": "REGISTERED", "severity": "INFO",
                       "description": "Device registered and provisioned", "created_at": d["registered_at"]})
        for _ in range(rng.randint(8, 22)):
            et, sev, desc = rng.choices(EVENT_TYPES, weights=EVENT_WEIGHTS)[0]
            if et == "APP_CRASH":
                desc = f"Application {rng.choice(app_pkgs)} crashed (exit code {rng.choice([134, 139, 6])})"
            elif et == "NETWORK_CHANGE":
                desc = rng.choice(["Switched from Wi-Fi to Ethernet", "Switched from Ethernet to Wi-Fi",
                                   "IP address renewed"])
            elif et == "CONNECTED":
                desc = f"Device connected ({d['ip_address']})"
            events.append({"device_pk": d["id"], "event_type": et, "severity": sev, "description": desc,
                           "created_at": now - timedelta(minutes=rng.randint(10, 30 * 24 * 60))})
        for _ in range(rng.randint(15, 40)):
            sev = rng.choices(["INFO", "WARNING", "ERROR", "CRITICAL"], weights=[0.62, 0.24, 0.11, 0.03])[0]
            cat, comp, msg = rng.choice(LOG_TEMPLATES[sev])
            logs.append({"device_pk": d["id"], "severity": sev, "category": cat, "component": comp,
                         "message": _log_message(msg, d), "created_at": now - timedelta(minutes=rng.randint(1, 7 * 24 * 60))})
    for i in range(0, len(events), 20000):
        db.execute(insert(DeviceEvent), events[i:i + 20000])
    for i in range(0, len(logs), 20000):
        db.execute(insert(DeviceLog), logs[i:i + 20000])


def seed_alerts(db: Session, fleet: list[dict], firmware: dict[str, list[FirmwareVersion]], users: dict[str, User]) -> None:
    now = _now()
    rows = []
    latest = {m: next(f for f in fws if f.is_latest) for m, fws in firmware.items()}
    counter = 0

    def add(d, cat, sev, title, desc, status, created):
        nonlocal counter
        counter += 1
        row = {"alert_code": f"ALR-{0x5A000 + counter:05X}", "device_pk": d["id"], "category": cat, "severity": sev,
               "title": title, "description": desc, "status": status, "created_at": created,
               "acknowledged_at": None, "acknowledged_by_id": None, "resolved_at": None, "resolved_by_id": None,
               "resolution_note": None}
        if status in ("ACKNOWLEDGED", "RESOLVED"):
            row["acknowledged_at"] = created + timedelta(minutes=rng.randint(3, 90))
            row["acknowledged_by_id"] = rng.choice([users["support"].id, users["m.gagnon"].id, users["admin"].id])
        if status == "RESOLVED":
            row["resolved_at"] = row["acknowledged_at"] + timedelta(minutes=rng.randint(5, 600))
            row["resolved_by_id"] = row["acknowledged_by_id"]
            row["resolution_note"] = rng.choice(["Remote reboot cleared the issue", "Customer power-cycled the device",
                                                 "Resolved after configuration sync", "Transient - no action required"])
        rows.append(row)

    for d in fleet:
        if d["connection_status"] == "OFFLINE":
            add(d, "DEVICE_OFFLINE", "WARNING", "Device offline", f"{d['device_id']} ({d['model']}) stopped sending heartbeats",
                rng.choice(["OPEN", "OPEN", "ACKNOWLEDGED"]), d["last_seen_at"] + timedelta(minutes=2))
        elif d["cpu_usage"] >= 90:
            add(d, "HIGH_CPU", "CRITICAL" if d["cpu_usage"] >= 97 else "WARNING", "High CPU usage",
                f"CPU utilisation at {d['cpu_usage']:.0f}% (threshold 90%)", "OPEN", now - timedelta(minutes=rng.randint(5, 600)))
        if d["connection_status"] == "ONLINE" and d["memory_usage"] >= 90:
            add(d, "HIGH_MEMORY", "WARNING", "High memory usage", f"Memory utilisation at {d['memory_usage']:.0f}% (threshold 90%)",
                "OPEN", now - timedelta(minutes=rng.randint(5, 600)))
        if d["health_status"] == "CRITICAL" and rng.random() < 0.6:
            add(d, "CRITICAL_ERROR", "CRITICAL", "Device critical error", "Kernel watchdog reset triggered",
                rng.choice(["OPEN", "ACKNOWLEDGED"]), now - timedelta(minutes=rng.randint(5, 300)))
        if d["firmware_version_id"] != latest[d["model"]].id and rng.random() < 0.08:
            add(d, "FIRMWARE_UPDATE", "INFO", "Firmware update available",
                f"Firmware {latest[d['model']].version} is available for {d['model']}", "OPEN",
                now - timedelta(days=rng.randint(1, 20)))
        if rng.random() < 0.05:
            add(d, "APP_CRASH", "WARNING", "Application crash", "Application com.netflix.ninja terminated unexpectedly",
                rng.choice(["OPEN", "ACKNOWLEDGED"]), now - timedelta(hours=rng.uniform(1, 48)))
        if d["network_type"] == "WIFI" and rng.random() < 0.04:
            add(d, "NETWORK_DISCONNECT", "WARNING", "Network disconnection", "Wi-Fi link lost for more than 60 seconds",
                "OPEN" if d["connection_status"] == "OFFLINE" else "RESOLVED", now - timedelta(hours=rng.uniform(1, 72)))
    cats = [("HIGH_CPU", "WARNING", "High CPU usage"), ("APP_CRASH", "WARNING", "Application crash"),
            ("DEVICE_OFFLINE", "WARNING", "Device offline"), ("NETWORK_DISCONNECT", "WARNING", "Network disconnection"),
            ("CRITICAL_ERROR", "CRITICAL", "Device critical error"), ("HIGH_MEMORY", "WARNING", "High memory usage")]
    for _ in range(260):
        d = rng.choice(fleet)
        cat, sev, title = rng.choice(cats)
        add(d, cat, sev, title, f"Historical {title.lower()} event", "RESOLVED", now - timedelta(hours=rng.uniform(12, 24 * 60)))
    db.execute(insert(Alert), rows)


def seed_commands(db: Session, fleet: list[dict], users: dict[str, User]) -> None:
    now = _now()
    types = ["REBOOT", "SYNC_CONFIG", "REFRESH_INFO", "RESTART_APP", "CLEAR_APP_CACHE", "FACTORY_RESET"]
    weights = [0.38, 0.22, 0.2, 0.1, 0.07, 0.03]
    for n in range(160):
        d = rng.choice(fleet)
        ctype = rng.choices(types, weights=weights)[0]
        requester = users["admin"] if ctype == "FACTORY_RESET" else rng.choice([users["support"], users["m.gagnon"], users["admin"]])
        created = now - timedelta(minutes=rng.randint(30, 30 * 24 * 60))
        outcome = rng.choices(["SUCCESSFUL", "FAILED", "TIMED_OUT"], weights=[0.86, 0.07, 0.07])[0]
        params = {"package_id": "ca.bell.fibetv"} if ctype in ("RESTART_APP", "CLEAR_APP_CACHE") else {}
        stages = [("PENDING", 0, "Command created"), ("QUEUED", 1, "Validated and queued for delivery")]
        if outcome == "TIMED_OUT":
            stages.append(("TIMED_OUT", 121, "No response from device within 120s (last stage: QUEUED)"))
        else:
            stages += [("SENT", 2, "Delivered to device"), ("ACKNOWLEDGED", 3, "Device acknowledged command"),
                       ("EXECUTING", 4, "Execution started")]
            stages.append(("SUCCESSFUL", rng.randint(8, 60), "Command completed successfully") if outcome == "SUCCESSFUL"
                          else ("FAILED", rng.randint(8, 40), rng.choice(["Device returned error code 0x21 (busy)",
                                                                           "Application not responding"])))
        ts = {s: created + timedelta(seconds=o) for s, o, _ in stages}
        cmd = DeviceCommand(
            command_code=f"CMD-{0x3C000000 + n * 7919:08X}", device_pk=d["id"], command_type=ctype, status=outcome,
            parameters=params, result_message=stages[-1][2], requested_by_id=requester.id, timeout_seconds=120,
            queued_at=ts.get("QUEUED"), sent_at=ts.get("SENT"), acknowledged_at=ts.get("ACKNOWLEDGED"),
            started_at=ts.get("EXECUTING"), completed_at=ts[outcome], expires_at=created + timedelta(seconds=120),
            created_at=created, updated_at=ts[outcome],
        )
        db.add(cmd)
        db.flush()
        db.add_all([DeviceCommandHistory(command_id=cmd.id, status=s, message=m, created_at=ts[s]) for s, _, m in stages])
        db.add(AuditLog(user_id=requester.id, username=requester.username, action=f"COMMAND_{ctype}", target_type="device",
                        target_id=d["device_id"], details={"command_code": cmd.command_code, "parameters": params},
                        result="SUCCESS", ip_address=f"10.20.{rng.randint(1, 30)}.{rng.randint(2, 250)}", created_at=created))


def seed_deployments(db: Session, fleet: list[dict], firmware: dict[str, list[FirmwareVersion]], users: dict[str, User]) -> None:
    now = _now()
    n = 0
    for model, fws in firmware.items():
        released = [f for f in fws if f.status != "BETA"]
        for fw in released[-2:]:
            n += 1
            prev = released[released.index(fw) - 1] if released.index(fw) > 0 else None
            on_target = [d for d in fleet if d["model"] == model and d["firmware_version_id"] == fw.id]
            sample = rng.sample(on_target, min(len(on_target), rng.randint(12, 40)))
            failed_extra = [d for d in fleet if d["model"] == model and d["firmware_version_id"] != fw.id][: rng.randint(0, 3)]
            created = fw.release_date + timedelta(days=rng.randint(1, 5))
            dep = FirmwareDeployment(
                deployment_code=f"DEP-{n:05d}", name=f"{model} {fw.version} rollout wave {rng.randint(1, 3)}",
                firmware_version_id=fw.id, status="COMPLETED_WITH_ERRORS" if failed_extra else "COMPLETED",
                offline_policy="WAIT", scheduled_at=created, started_at=created + timedelta(minutes=1),
                completed_at=created + timedelta(hours=rng.randint(1, 8)), created_by_id=users["admin"].id,
                created_at=created, updated_at=created,
            )
            db.add(dep)
            db.flush()
            for d in sample:
                db.add(DeploymentTarget(deployment_id=dep.id, device_pk=d["id"], status="SUCCESS",
                                        previous_firmware_version_id=prev.id if prev else None,
                                        target_firmware_version_id=fw.id, updated_at=dep.completed_at))
            for d in failed_extra:
                db.add(DeploymentTarget(deployment_id=dep.id, device_pk=d["id"], status="FAILED",
                                        previous_firmware_version_id=d["firmware_version_id"], target_firmware_version_id=fw.id,
                                        error_message=rng.choice(["Checksum verification failed", "Insufficient storage",
                                                                  "Device unreachable during deployment window"]),
                                        updated_at=dep.completed_at))
            db.add(AuditLog(user_id=users["admin"].id, username="admin", action="FIRMWARE_DEPLOYMENT_CREATED",
                            target_type="deployment", target_id=dep.deployment_code,
                            details={"firmware": fw.version, "model": model, "targets": len(sample) + len(failed_extra)},
                            result="SUCCESS", ip_address="10.20.1.15", created_at=created))


def seed_audit(db: Session, users: dict[str, User]) -> None:
    now = _now()
    rows = []
    actives = [u for u in users.values() if u.is_active]
    for _ in range(420):
        u = rng.choice(actives)
        t = now - timedelta(minutes=rng.randint(60, 30 * 24 * 60))
        ip = f"10.20.{rng.randint(1, 30)}.{rng.randint(2, 250)}"
        rows.append({"user_id": u.id, "username": u.username, "action": "LOGIN", "target_type": "session",
                     "target_id": None, "details": {}, "result": "SUCCESS", "ip_address": ip, "created_at": t})
        if rng.random() < 0.7:
            rows.append({"user_id": u.id, "username": u.username, "action": "LOGOUT", "target_type": "session",
                         "target_id": None, "details": {}, "result": "SUCCESS", "ip_address": ip,
                         "created_at": t + timedelta(minutes=rng.randint(5, 400))})
    for _ in range(25):
        u = rng.choice(list(users.values()))
        rows.append({"user_id": u.id, "username": u.username, "action": "LOGIN_FAILED", "target_type": "session",
                     "target_id": None, "details": {"reason": "invalid_credentials"}, "result": "FAILURE",
                     "ip_address": f"10.20.{rng.randint(1, 30)}.{rng.randint(2, 250)}",
                     "created_at": now - timedelta(minutes=rng.randint(60, 30 * 24 * 60))})
    rows.append({"user_id": users["admin"].id, "username": "admin", "action": "USER_DEACTIVATED", "target_type": "user",
                 "target_id": "j.tremblay", "details": {}, "result": "SUCCESS", "ip_address": "10.20.1.15",
                 "created_at": now - timedelta(days=12)})
    rows.append({"user_id": users["admin"].id, "username": "admin", "action": "CONFIGURATION_CHANGED",
                 "target_type": "settings", "target_id": "system",
                 "details": {"cpu_alert_threshold": {"from": "85", "to": "90"}}, "result": "SUCCESS",
                 "ip_address": "10.20.1.15", "created_at": now - timedelta(days=20)})
    db.execute(insert(AuditLog), rows)


def run() -> None:
    configure_logging()
    with SessionLocal() as db:
        if db.execute(select(func.count(User.id))).scalar_one() > 0:
            log.info("Database already seeded - skipping")
            return
        log.info("Seeding database with %d simulated devices", settings.seed_device_count)
        for key, (value, desc) in DEFAULT_SETTINGS.items():
            db.add(SystemSetting(key=key, value=value, description=desc))
        users = seed_roles_and_users(db)
        firmware = seed_firmware(db)
        apps = seed_applications(db)
        fleet = seed_devices(db, firmware, apps)
        seed_telemetry(db, fleet)
        seed_snapshots(db, len(fleet))
        seed_events_and_logs(db, fleet, apps)
        seed_alerts(db, fleet, firmware, users)
        seed_commands(db, fleet, users)
        seed_deployments(db, fleet, firmware, users)
        seed_audit(db, users)
        db.commit()
        log.info("Seed complete")


if __name__ == "__main__":
    run()
