import asyncio
import logging
import random
from datetime import timedelta

from stb_simulator.config import SimConfig
from stb_simulator.device import SimDevice, utcnow
from stb_simulator.gateway import DeviceGateway

log = logging.getLogger("simulator")

MODELS = [
    ("VIP5662W", "AR5662", "2.3"),
    ("Fibe 4K Box (FTB-4K10)", "FB4K10", "B1"),
    ("Fibe TV App Box (ATV-200)", "ATV200", "R2"),
]
REGIONS = {"Ontario": ["Toronto", "Ottawa", "Mississauga"], "Quebec": ["Montreal", "Laval", "Quebec City"],
           "Atlantic": ["Halifax", "Moncton"], "Manitoba": ["Winnipeg"]}

INFO_LOGS = [
    ("SYSTEM", "sysmgr", "Heartbeat interval adjusted by headend policy"),
    ("NETWORK", "netd", "DHCP lease renewed"),
    ("SYSTEM", "epg-sync", "EPG delta synchronised"),
    ("APPLICATION", "appmgr", "Application ca.bell.fibetv resumed from standby"),
]
WARN_LOGS = [
    ("NETWORK", "netd", "Packet loss above 2% on uplink"),
    ("HARDWARE", "thermal", "SoC temperature elevated"),
    ("APPLICATION", "appmgr", "Application response time exceeded 3000 ms"),
]
ERROR_LOGS = [
    ("NETWORK", "multicast", "IGMP join failed for channel group"),
    ("SYSTEM", "drm", "DRM license renewal failed - retrying"),
]

COMMAND_DURATION = {"SYNC_CONFIG": 3.0, "REFRESH_INFO": 1.5, "RESTART_APP": 3.0, "CLEAR_APP_CACHE": 2.5}


class SimulatorEngine:
    def __init__(self, config: SimConfig, gateway: DeviceGateway, seed: int | None = None):
        self.cfg = config
        self.gw = gateway
        self.rng = random.Random(seed)
        self.devices: dict[str, SimDevice] = {}
        self.running = False
        self.tick = 0
        self.started_at = None
        self.stats = {"heartbeats": 0, "events": 0, "commands": 0, "firmware_updates": 0, "registrations": 0,
                      "errors": 0}
        self._tasks: list[asyncio.Task] = []
        self._inflight_commands: set[str] = set()
        self._inflight_targets: set[int] = set()
        self._pending_events: list[dict] = []
        self._pending_logs: list[dict] = []
        self._last_registration = utcnow()
        self._last_sync = utcnow()
        self._lock = asyncio.Lock()

    # ---------------------------------------------------------------- lifecycle
    async def start(self) -> None:
        async with self._lock:
            if self.running:
                return
            await self.sync_devices(full=True)
            self.running = True
            self.started_at = utcnow()
            self._tasks = [asyncio.create_task(self._loop(self._tick_loop, self.cfg.tick_seconds)),
                           asyncio.create_task(self._loop(self._command_loop, self.cfg.command_poll_seconds)),
                           asyncio.create_task(self._loop(self._deployment_loop, 2.0))]
            log.info("Simulator started with %d devices", len(self.devices))

    async def stop(self) -> None:
        async with self._lock:
            self.running = False
            for t in self._tasks:
                t.cancel()
            await asyncio.gather(*self._tasks, return_exceptions=True)
            self._tasks = []
            log.info("Simulator stopped")

    async def reset(self) -> None:
        """Reset all STANDARD devices to a fresh baseline state (87% online, normal load)."""
        was_running = self.running
        await self.stop()
        await self.sync_devices(full=True)
        now = utcnow()
        for d in self.devices.values():
            if d.profile != "STANDARD":
                continue
            d.status = "ONLINE" if self.rng.random() < 0.87 else "OFFLINE"
            d.base_cpu, d.base_memory = self.rng.uniform(8, 40), self.rng.uniform(30, 60)
            d.cpu, d.memory, d.spike_ticks = d.base_cpu, d.base_memory, 0
            d.boot_time = now - timedelta(hours=self.rng.uniform(0.5, 240))
            d.busy = False
        await self.gw.send_heartbeats([d.report(False, self.rng) for d in self.devices.values()])
        self.tick = 0
        log.info("Simulator reset (%d devices)", len(self.devices))
        if was_running:
            await self.start()

    def status(self) -> dict:
        online = sum(1 for d in self.devices.values() if d.status == "ONLINE")
        return {
            "running": self.running, "devices": len(self.devices), "online": online,
            "offline": sum(1 for d in self.devices.values() if d.status == "OFFLINE"),
            "rebooting": sum(1 for d in self.devices.values() if d.status == "REBOOTING"),
            "tick": self.tick, "started_at": self.started_at, "stats": self.stats,
            "inflight_commands": len(self._inflight_commands), "inflight_firmware_targets": len(self._inflight_targets),
            "mode": "SIMULATED",
        }

    async def _loop(self, fn, interval: float) -> None:
        while self.running:
            try:
                await fn()
            except asyncio.CancelledError:
                raise
            except Exception as exc:  # keep simulating; backend may be restarting
                self.stats["errors"] += 1
                log.warning("Simulator iteration %s failed: %s", fn.__name__, exc)
            await asyncio.sleep(interval)

    # ---------------------------------------------------------------- device sync
    async def sync_devices(self, full: bool = False) -> None:
        remote = await self.gw.list_devices()
        seen = set()
        for d in remote:
            seen.add(d["device_id"])
            local = self.devices.get(d["device_id"])
            if local is None or full:
                self.devices[d["device_id"]] = SimDevice.from_gateway(d, self.rng)
            else:
                local.profile = d.get("simulation_profile", local.profile)
                local.firmware_version = d.get("firmware_version", local.firmware_version)
                local.applications = d.get("applications", local.applications)
        for gone in set(self.devices) - seen:
            del self.devices[gone]

    # ---------------------------------------------------------------- main tick
    def _event(self, d: SimDevice, event_type: str, severity: str, description: str, log_entry=None, package_id=None):
        ev = {"device_id": d.device_id, "event_type": event_type, "severity": severity, "description": description}
        if log_entry:
            cat, comp, msg = log_entry
            ev["log"] = {"severity": severity if severity != "INFO" else "INFO", "category": cat, "component": comp,
                         "message": msg}
        if package_id:
            ev["package_id"] = package_id
        self._pending_events.append(ev)

    def _log(self, d: SimDevice, severity: str, entry) -> None:
        cat, comp, msg = entry
        self._pending_logs.append({"device_id": d.device_id, "severity": severity, "category": cat, "component": comp,
                                   "message": msg})

    async def _tick_loop(self) -> None:
        self.tick += 1
        rng = self.rng
        if self.tick % 6 == 0:
            await self.sync_devices()
        reports = []
        for i, d in enumerate(list(self.devices.values())):
            if d.busy:
                continue
            prev = d.status
            if d.profile == "STABLE_OFFLINE":
                d.status = "OFFLINE"
            elif d.profile == "STABLE_ONLINE":
                d.status = "ONLINE" if d.status != "REBOOTING" else d.status
            elif d.online and rng.random() < self.cfg.disconnect_probability:
                d.status = "OFFLINE"
                if d.network_type == "WIFI" and rng.random() < 0.5:
                    self._event(d, "NETWORK_LOSS", "WARNING", "Wi-Fi link lost for more than 60 seconds",
                                ("NETWORK", "wifi", "Wi-Fi association lost (reason 4: inactivity)"))
            elif d.status == "OFFLINE" and rng.random() < self.cfg.reconnect_probability:
                d.status = "ONLINE"
                d.boot_time = utcnow() - timedelta(seconds=rng.randint(30, 90))
                self._event(d, "REBOOT", "INFO", "Device powered on")
            d.drift(rng)
            if d.online and d.profile == "STANDARD":
                self._random_activity(d)
            changed = prev != d.status
            heartbeat_due = (self.tick + i) % self.cfg.heartbeat_every_ticks == 0
            telemetry_due = (self.tick + i) % self.cfg.telemetry_every_ticks == 0
            if changed or heartbeat_due or telemetry_due or d.dirty:
                reports.append(d.report(telemetry_due, rng))
                d.dirty = False
        if reports:
            await self.gw.send_heartbeats(reports)
            self.stats["heartbeats"] += len(reports)
        await self._flush_events()
        await self._maybe_register()

    def _random_activity(self, d: SimDevice) -> None:
        rng = self.rng
        r = rng.random()
        if r < 0.0004 and d.applications:
            pkg = rng.choice(d.applications)
            self._event(d, "APP_CRASH", "ERROR", f"Application {pkg} crashed (exit code {rng.choice([134, 139, 6])})",
                        ("APPLICATION", "appmgr", f"Application {pkg} terminated unexpectedly"), package_id=pkg)
        elif r < 0.00045:
            self._event(d, "CRITICAL_ERROR", "CRITICAL", "Kernel watchdog reset triggered",
                        ("SYSTEM", "kernel", "Kernel watchdog reset triggered"))
            d.spike_ticks = rng.randint(6, 18)
        elif r < 0.0012:
            d.spike_ticks = rng.randint(4, 24)
        elif r < 0.004:
            self._log(d, "INFO", rng.choice(INFO_LOGS))
        elif r < 0.0055:
            self._log(d, "WARNING", rng.choice(WARN_LOGS))
        elif r < 0.006:
            self._log(d, "ERROR", rng.choice(ERROR_LOGS))

    async def _flush_events(self) -> None:
        if not self._pending_events and not self._pending_logs:
            return
        events, logs = self._pending_events, self._pending_logs
        self._pending_events, self._pending_logs = [], []
        await self.gw.send_events(events, logs)
        self.stats["events"] += len(events)

    async def _maybe_register(self) -> None:
        interval = self.cfg.registration_interval_minutes
        if interval <= 0 or utcnow() - self._last_registration < timedelta(minutes=interval):
            return
        self._last_registration = utcnow()
        rng = self.rng
        model, prefix, hw = rng.choice(MODELS)
        region = rng.choice(list(REGIONS))
        serial = f"{prefix}26{rng.randint(800000, 999999)}"
        payload = {
            "serial_number": serial, "mac_address": "00:1E:46:" + ":".join(f"{rng.randint(0, 255):02X}" for _ in range(3)),
            "model": model, "hardware_version": hw,
            "ip_address": f"100.{rng.randint(64, 127)}.{rng.randint(0, 255)}.{rng.randint(1, 254)}",
            "customer_ref": f"BAN-{rng.randint(500000000, 599999999)}", "region": region,
            "city": rng.choice(REGIONS[region]), "simulation_profile": "STANDARD", "initial_status": "ONLINE",
        }
        created = await self.gw.register_device(payload)
        if created:
            self.stats["registrations"] += 1
            log.info("Registered new simulated device %s", created["device_id"])

    # ---------------------------------------------------------------- commands
    async def _sync_if_unknown(self, device_ids: list[str]) -> None:
        """Pick up newly registered devices immediately when they already have pending work."""
        if any(i not in self.devices for i in device_ids) and utcnow() - self._last_sync > timedelta(seconds=3):
            self._last_sync = utcnow()
            await self.sync_devices()

    async def _command_loop(self) -> None:
        pending = await self.gw.pending_commands()
        await self._sync_if_unknown([c["device_id"] for c in pending])
        for cmd in pending:
            code = cmd["command_code"]
            d = self.devices.get(cmd["device_id"])
            if code in self._inflight_commands or d is None or not d.online or d.busy:
                continue  # offline devices cannot receive commands; backend times them out
            self._inflight_commands.add(code)
            asyncio.create_task(self._execute_command(cmd, d))

    async def _execute_command(self, cmd: dict, d: SimDevice) -> None:
        code, ctype = cmd["command_code"], cmd["command_type"]
        params = cmd.get("parameters") or {}
        outcome = str(params.get("simulate_outcome", "")).upper()
        stage = self.cfg.command_stage_seconds
        try:
            await self.gw.update_command(code, "SENT", f"Delivered to {d.device_id}")
            await asyncio.sleep(stage)
            if outcome == "NO_RESPONSE":
                return  # device never acknowledges; backend will time the command out
            await self.gw.update_command(code, "ACKNOWLEDGED", "Device acknowledged command")
            await asyncio.sleep(stage)
            await self.gw.update_command(code, "EXECUTING", "Execution started on device")
            fail = outcome == "FAILURE" or (
                outcome == "" and d.profile == "STANDARD" and self.rng.random() < self.cfg.random_failure_rate)
            if ctype in ("REBOOT", "FACTORY_RESET"):
                await self._reboot(d, factory=ctype == "FACTORY_RESET", fail=fail)
                if fail:
                    await self.gw.update_command(code, "FAILED", "Device did not come back within the reboot window")
                else:
                    msg = "Factory reset completed; device re-provisioned and reconnected" if ctype == "FACTORY_RESET" \
                        else "Device rebooted and reconnected"
                    await self.gw.update_command(code, "SUCCESSFUL", msg)
            else:
                await asyncio.sleep(COMMAND_DURATION.get(ctype, 2.0))
                if fail:
                    await self.gw.update_command(code, "FAILED", self.rng.choice(
                        ["Device returned error code 0x21 (busy)", "Application not responding to lifecycle request"]))
                else:
                    await self.gw.update_command(code, "SUCCESSFUL", self._apply(d, ctype, params))
            self.stats["commands"] += 1
        except Exception as exc:
            self.stats["errors"] += 1
            log.warning("Command %s failed in simulator: %s", code, exc)
        finally:
            self._inflight_commands.discard(code)

    def _apply(self, d: SimDevice, ctype: str, params: dict) -> str:
        pkg = params.get("package_id", "")
        if ctype == "SYNC_CONFIG":
            self._event(d, "CONFIG_SYNC", "INFO", "Configuration synchronised with headend (remote request)")
            return "Configuration profile synchronised (revision applied)"
        if ctype == "REFRESH_INFO":
            d.dirty = True
            return "Device information refreshed"
        if ctype == "RESTART_APP":
            self._event(d, "APP_RESTART", "INFO", f"Application {pkg} restarted (remote request)")
            return f"Application {pkg} restarted"
        if ctype == "CLEAR_APP_CACHE":
            freed = round(self.rng.uniform(0.5, 3.0), 1)
            d.storage = max(5.0, d.storage - freed)
            d.dirty = True
            self._event(d, "APP_CACHE_CLEARED", "INFO", f"Cache cleared for {pkg}")
            return f"Cache cleared for {pkg} ({freed}% storage reclaimed)"
        return "Completed"

    async def _reboot(self, d: SimDevice, factory: bool = False, fail: bool = False) -> None:
        d.busy = True
        try:
            d.status = "REBOOTING"
            self._event(d, "FACTORY_RESET" if factory else "REBOOT", "WARNING" if factory else "INFO",
                        "Factory reset initiated (remote request)" if factory else "Reboot initiated (remote request)")
            await self.gw.send_heartbeats([d.report(False, self.rng)])
            await self._flush_events()
            await asyncio.sleep(self.cfg.reboot_seconds * (1.6 if factory else 1.0))
            if fail:
                d.status = "OFFLINE"
            else:
                d.status = "ONLINE"
                d.boot_time = utcnow()
                d.cpu, d.memory, d.spike_ticks = d.base_cpu + 15, d.base_memory * 0.8, 0
                if factory:
                    d.storage = self.rng.uniform(12, 20)
            await self.gw.send_heartbeats([d.report(True, self.rng)])
        finally:
            d.busy = False

    # ---------------------------------------------------------------- firmware
    async def _deployment_loop(self) -> None:
        targets = await self.gw.deployment_targets()
        await self._sync_if_unknown([t["device_id"] for t in targets])
        for t in targets:
            tid = t["target_id"]
            d = self.devices.get(t["device_id"])
            if tid in self._inflight_targets or d is None or not d.online or d.busy:
                continue
            if len(self._inflight_targets) >= self.cfg.deployment_concurrency:
                break
            self._inflight_targets.add(tid)
            asyncio.create_task(self._install_firmware(t, d))

    async def _install_firmware(self, t: dict, d: SimDevice) -> None:
        tid = t["target_id"]
        rng = self.rng
        try:
            await self.gw.update_target(tid, "DOWNLOADING")
            await asyncio.sleep(rng.uniform(2, 5))
            if d.profile == "STANDARD" and rng.random() < 0.04:
                await self.gw.update_target(tid, "FAILED", rng.choice(["Checksum verification failed",
                                                                        "Insufficient storage for update package"]))
                return
            await self.gw.update_target(tid, "INSTALLING")
            await asyncio.sleep(rng.uniform(2, 4))
            await self._reboot(d)
            d.firmware_version = t["target_version"]
            await self.gw.update_target(tid, "SUCCESS")
            self.stats["firmware_updates"] += 1
        except Exception as exc:
            self.stats["errors"] += 1
            log.warning("Firmware target %s failed in simulator: %s", tid, exc)
        finally:
            self._inflight_targets.discard(tid)
