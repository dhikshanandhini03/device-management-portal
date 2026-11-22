import { Device, HOUR, MIN, REGIONS, markDirty, store } from "./data";
import { Rng } from "./rng";
import {
  Heartbeat, TERMINAL, applyDeviceEvent, applyHeartbeat, addLog, createDevice, devByPk, finalizeIfDone, iso, round1,
  settingFloat, transition, updateTarget,
} from "./logic";

const rng = new Rng(Date.now() >>> 0);
const CFG = {
  tickMs: 5000, heartbeatEvery: 6, stageMs: 1500, rebootMs: 6000, concurrency: 40,
  disconnectP: 0.0012, reconnectP: 0.012, registrationMin: 30, failureRate: 0.03,
};
const COMMAND_MS: Record<string, number> = { SYNC_CONFIG: 3000, REFRESH_INFO: 1500, RESTART_APP: 3000, CLEAR_APP_CACHE: 2500 };
const INFO_LOGS: [string, string, string][] = [
  ["SYSTEM", "sysmgr", "Heartbeat interval adjusted by headend policy"],
  ["NETWORK", "netd", "DHCP lease renewed"],
  ["SYSTEM", "epg-sync", "EPG delta synchronised"],
  ["APPLICATION", "appmgr", "Application ca.bell.fibetv resumed from standby"],
];
const WARN_LOGS: [string, string, string][] = [
  ["NETWORK", "netd", "Packet loss above 2% on uplink"],
  ["HARDWARE", "thermal", "SoC temperature elevated"],
  ["APPLICATION", "appmgr", "Application response time exceeded 3000 ms"],
];
const ERROR_LOGS: [string, string, string][] = [
  ["NETWORK", "multicast", "IGMP join failed for channel group"],
  ["SYSTEM", "drm", "DRM license renewal failed - retrying"],
];
const NEW_MODELS: [string, string, string][] = [
  ["VIP5662W", "AR5662", "2.3"],
  ["Fibe 4K Box (FTB-4K10)", "FB4K10", "B1"],
  ["Fibe TV App Box (ATV-200)", "ATV200", "R2"],
];

const clamp = (v: number, lo: number, hi: number) => Math.max(lo, Math.min(hi, v));
const busy = (d: Device) => d.sim.busy_until !== 0;
const stat = (key: string) => (store.s.sim.stats[key] = (store.s.sim.stats[key] ?? 0) + 1);

let lastFleetTick = 0;
let lastHousekeeping = 0;

function report(d: Device, status: string): Heartbeat {
  const st = d.st;
  const wifi = st.network_type === "WIFI";
  const online = status === "ONLINE";
  const weak = wifi && (st.signal_strength_dbm ?? -60) < -75;
  return {
    connection_status: status,
    cpu_usage: online ? round1(st.cpu_usage) : 0,
    memory_usage: online ? round1(st.memory_usage) : 0,
    storage_usage: round1(st.storage_usage),
    temperature_c: st.temperature_c === null ? null : round1(st.temperature_c),
    network_type: st.network_type,
    signal_strength_dbm: wifi ? Math.round(st.signal_strength_dbm ?? -60) : null,
    bandwidth_mbps: online ? round1(wifi ? rng.uniform(20, 90) : rng.uniform(150, 940)) : 0,
    latency_ms: online ? round1(wifi ? rng.uniform(15, weak ? 60 : 35) : rng.uniform(4, 16)) : 0,
    packet_loss_pct: online ? rng.pick([0, 0, 0, 0.1, 0.4, ...(weak ? [3.5, 6.2] : [])]) : 0,
    boot_time: st.last_boot_at,
  };
}

/** Random-walk resource metrics with occasional load spikes (simulator SimDevice.drift). */
function drift(d: Device): void {
  const st = d.st;
  let targetCpu: number;
  let targetMem: number;
  if (d.sim.spike > 0) {
    d.sim.spike -= 1;
    targetCpu = rng.uniform(86, 99);
    targetMem = rng.uniform(75, 96);
  } else {
    const h = new Date().getUTCHours();
    targetCpu = d.sim.base_cpu * (h >= 22 || h <= 4 ? 1.25 : 1);
    targetMem = d.sim.base_mem;
  }
  st.cpu_usage = clamp(st.cpu_usage + (targetCpu - st.cpu_usage) * 0.3 + rng.gauss(0, 3), 1, 100);
  st.memory_usage = clamp(st.memory_usage + (targetMem - st.memory_usage) * 0.2 + rng.gauss(0, 1.5), 10, 100);
  st.storage_usage = clamp(st.storage_usage + rng.uniform(-0.02, 0.05), 5, 99);
  st.temperature_c = clamp(40 + st.cpu_usage * 0.28 + rng.gauss(0, 1), 30, 95);
  if (st.network_type === "WIFI") st.signal_strength_dbm = clamp((st.signal_strength_dbm ?? -60) + rng.gauss(0, 1.5), -88, -32);
}

function startReboot(d: Device, factory: boolean, failReboot: boolean, now: number): void {
  d.sim.busy_until = now + CFG.rebootMs * (factory ? 1.6 : 1);
  d.sim.reboot = { factory, fail: failReboot };
  applyDeviceEvent(d, factory ? "FACTORY_RESET" : "REBOOT", factory ? "WARNING" : "INFO",
    factory ? "Factory reset initiated (remote request)" : "Reboot initiated (remote request)");
  applyHeartbeat(d, report(d, "REBOOTING"));
}

function finishReboots(now: number): boolean {
  let changed = false;
  for (const d of store.s.devices) {
    if (d.sim.busy_until === 0 || d.sim.busy_until > now) continue;
    const r = d.sim.reboot ?? { factory: false, fail: false };
    if (r.fail) {
      applyHeartbeat(d, report(d, "OFFLINE"));
    } else {
      d.st.last_boot_at = now;
      d.st.cpu_usage = clamp(d.sim.base_cpu + 15, 1, 100);
      d.st.memory_usage = clamp(d.sim.base_mem * 0.8, 10, 100);
      d.sim.spike = 0;
      if (r.factory) d.st.storage_usage = rng.uniform(12, 20);
      applyHeartbeat(d, report(d, "ONLINE"));
    }
    d.sim.busy_until = 0;
    d.sim.reboot = undefined;
    changed = true;
  }
  return changed;
}

// ------------------------------------------------------------------ backend worker
function workerCommands(now: number): boolean {
  let changed = false;
  for (const c of store.s.commands) {
    if (c.status === "PENDING") {
      transition(c, "QUEUED", "Validated and queued for delivery");
      changed = true;
    } else if (["QUEUED", "SENT", "ACKNOWLEDGED", "EXECUTING"].includes(c.status) && c.expires_at < now) {
      const stage = c.status;
      transition(c, "TIMED_OUT", `No response from device within ${c.timeout_seconds}s (last stage: ${stage})`);
      changed = true;
    }
  }
  return changed;
}

function workerDeployments(now: number): boolean {
  let changed = false;
  const window = settingFloat("deployment_target_timeout_seconds") * 1000;
  for (const dep of store.s.deployments) {
    if (dep.status === "SCHEDULED" && dep.scheduled_at <= now) {
      dep.status = "IN_PROGRESS";
      dep.started_at = now;
      changed = true;
      if (dep.offline_policy === "SKIP") {
        for (const t of store.s.targets) {
          if (t.dep_id === dep.id && t.status === "PENDING" && devByPk(t.pk)?.st.connection_status !== "ONLINE") {
            Object.assign(t, { status: "FAILED", error: "Device offline at deployment start (skip policy)", updated_at: now });
          }
        }
      }
    }
    if (dep.status !== "IN_PROGRESS") continue;
    const stuck = now - Math.max(120_000, window / 2);
    for (const t of store.s.targets) {
      if (t.dep_id !== dep.id) continue;
      if (t.status === "PENDING" && dep.started_at !== null && now - dep.started_at > window) {
        Object.assign(t, { status: "FAILED", error: "Device unreachable during deployment window", updated_at: now });
        changed = true;
      } else if ((t.status === "DOWNLOADING" || t.status === "INSTALLING") && t.updated_at < stuck) {
        Object.assign(t, { status: "FAILED", error: "Device stopped reporting update progress", updated_at: now });
        changed = true;
      }
    }
    const before = dep.status;
    finalizeIfDone(dep);
    changed = changed || before !== dep.status;
  }
  return changed;
}

function housekeeping(now: number): void {
  const s = store.s;
  const bucket = Math.floor(now / HOUR) * HOUR;
  const total = s.devices.length;
  const online = s.devices.filter((d) => d.st.connection_status === "ONLINE").length;
  const warning = s.devices.filter((d) => d.st.health_status === "WARNING").length;
  const critical = s.devices.filter((d) => d.st.health_status === "CRITICAL").length;
  const row = [bucket, total, online, warning, critical];
  const last = s.snapshots[s.snapshots.length - 1];
  if (last && last[0] === bucket) s.snapshots[s.snapshots.length - 1] = row;
  else s.snapshots.push(row);
  const trim = <T,>(arr: T[], max: number) => arr.length > max && arr.splice(0, arr.length - max);
  trim(s.events, 12000);
  trim(s.logs, 15000);
  trim(s.audit, 4000);
  trim(s.snapshots, 90 * 24);
  trim(s.commands, 1500);
}

// ------------------------------------------------------------------ simulator
function simCommands(now: number): boolean {
  let changed = false;
  for (const c of store.s.commands) {
    if (c.status === "PENDING" || TERMINAL.includes(c.status)) continue;
    const d = devByPk(c.pk);
    if (!d) continue;
    const outcome = String(c.params?.simulate_outcome ?? "").toUpperCase();
    if (c.status === "QUEUED") {
      if (d.st.connection_status !== "ONLINE" || busy(d)) continue;
      transition(c, "SENT", `Delivered to ${d.device_id}`);
      c.next_at = now + CFG.stageMs;
      changed = true;
      continue;
    }
    if (c.next_at === undefined || now < c.next_at) continue;
    if (c.status === "SENT") {
      if (outcome === "NO_RESPONSE") continue;
      transition(c, "ACKNOWLEDGED", "Device acknowledged command");
      c.next_at = now + CFG.stageMs;
    } else if (c.status === "ACKNOWLEDGED") {
      transition(c, "EXECUTING", "Execution started on device");
      c.fail = outcome === "FAILURE" || (outcome === "" && d.profile === "STANDARD" && rng.next() < CFG.failureRate);
      if (c.type === "REBOOT" || c.type === "FACTORY_RESET") {
        startReboot(d, c.type === "FACTORY_RESET", !!c.fail, now);
        c.next_at = d.sim.busy_until;
      } else {
        c.next_at = now + (COMMAND_MS[c.type] ?? 2000);
      }
    } else if (c.status === "EXECUTING") {
      if (c.type === "REBOOT" || c.type === "FACTORY_RESET") {
        if (d.sim.busy_until !== 0) continue;
        if (c.fail) transition(c, "FAILED", "Device did not come back within the reboot window");
        else transition(c, "SUCCESSFUL", c.type === "FACTORY_RESET" ? "Factory reset completed; device re-provisioned and reconnected" : "Device rebooted and reconnected");
      } else if (c.fail) {
        transition(c, "FAILED", rng.pick(["Device returned error code 0x21 (busy)", "Application not responding to lifecycle request"]));
      } else {
        transition(c, "SUCCESSFUL", applyCommand(d, c.type, String(c.params?.package_id ?? "")));
      }
      stat("commands");
    }
    changed = true;
  }
  return changed;
}

function applyCommand(d: Device, type: string, pkg: string): string {
  if (type === "SYNC_CONFIG") {
    applyDeviceEvent(d, "CONFIG_SYNC", "INFO", "Configuration synchronised with headend (remote request)");
    return "Configuration profile synchronised (revision applied)";
  }
  if (type === "REFRESH_INFO") {
    applyHeartbeat(d, report(d, d.st.connection_status));
    return "Device information refreshed";
  }
  if (type === "RESTART_APP") {
    applyDeviceEvent(d, "APP_RESTART", "INFO", `Application ${pkg} restarted (remote request)`);
    return `Application ${pkg} restarted`;
  }
  if (type === "CLEAR_APP_CACHE") {
    const freed = round1(rng.uniform(0.5, 3.0));
    d.st.storage_usage = Math.max(5, round1(d.st.storage_usage - freed));
    applyDeviceEvent(d, "APP_CACHE_CLEARED", "INFO", `Cache cleared for ${pkg}`);
    return `Cache cleared for ${pkg} (${freed}% storage reclaimed)`;
  }
  return "Completed";
}

function simDeployments(now: number): boolean {
  const active = new Set(store.s.deployments.filter((d) => d.status === "IN_PROGRESS").map((d) => d.id));
  if (!active.size) return false;
  let changed = false;
  let inflight = store.s.targets.filter((t) => active.has(t.dep_id) && (t.status === "DOWNLOADING" || t.status === "INSTALLING")).length;
  for (const t of store.s.targets) {
    if (!active.has(t.dep_id) || !["PENDING", "DOWNLOADING", "INSTALLING"].includes(t.status)) continue;
    const d = devByPk(t.pk);
    if (!d) continue;
    if (t.status === "PENDING") {
      if (d.st.connection_status !== "ONLINE" || busy(d) || inflight >= CFG.concurrency) continue;
      updateTarget(t, "DOWNLOADING");
      t.next_at = now + rng.uniform(2000, 5000);
      inflight += 1;
    } else if (t.next_at === undefined || now < t.next_at) {
      continue;
    } else if (t.status === "DOWNLOADING") {
      if (d.profile === "STANDARD" && rng.next() < 0.04) {
        updateTarget(t, "FAILED", rng.pick(["Checksum verification failed", "Insufficient storage for update package"]));
      } else {
        updateTarget(t, "INSTALLING");
        t.next_at = now + rng.uniform(2000, 4000);
      }
    } else if (!t.rebooting) {
      if (busy(d)) continue;
      startReboot(d, false, false, now);
      t.rebooting = true;
      t.next_at = d.sim.busy_until;
    } else {
      if (d.sim.busy_until !== 0) continue;
      t.rebooting = false;
      updateTarget(t, "SUCCESS");
      stat("firmware_updates");
    }
    changed = true;
  }
  return changed;
}

function randomActivity(d: Device): void {
  const r = rng.next();
  const pkgs = d.apps.map((a) => store.s.apps.find((x) => x.id === a.app_id)?.package_id ?? "");
  if (r < 0.0004 && pkgs.length) {
    const pkg = rng.pick(pkgs);
    applyDeviceEvent(d, "APP_CRASH", "ERROR", `Application ${pkg} crashed (exit code ${rng.pick([134, 139, 6])})`, ["APPLICATION", "appmgr", `Application ${pkg} terminated unexpectedly`], pkg);
  } else if (r < 0.00045) {
    applyDeviceEvent(d, "CRITICAL_ERROR", "CRITICAL", "Kernel watchdog reset triggered", ["SYSTEM", "kernel", "Kernel watchdog reset triggered"]);
    d.sim.spike = rng.int(6, 18);
  } else if (r < 0.0012) {
    d.sim.spike = rng.int(4, 24);
  } else if (r < 0.004) {
    addLog(d.id, "INFO", ...rng.pick(INFO_LOGS));
  } else if (r < 0.0055) {
    addLog(d.id, "WARNING", ...rng.pick(WARN_LOGS));
  } else if (r < 0.006) {
    addLog(d.id, "ERROR", ...rng.pick(ERROR_LOGS));
  }
}

function fleetTick(now: number): void {
  const sim = store.s.sim;
  sim.tick += 1;
  store.s.devices.forEach((d, i) => {
    if (busy(d)) return;
    const prev = d.st.connection_status;
    let status = prev === "REBOOTING" ? "ONLINE" : prev;
    if (d.profile === "STABLE_OFFLINE") status = "OFFLINE";
    else if (d.profile === "STABLE_ONLINE") status = "ONLINE";
    else if (status === "ONLINE" && rng.next() < CFG.disconnectP) {
      status = "OFFLINE";
      if (d.st.network_type === "WIFI" && rng.next() < 0.5) {
        applyDeviceEvent(d, "NETWORK_LOSS", "WARNING", "Wi-Fi link lost for more than 60 seconds", ["NETWORK", "wifi", "Wi-Fi association lost (reason 4: inactivity)"]);
      }
    } else if (status === "OFFLINE" && rng.next() < CFG.reconnectP) {
      status = "ONLINE";
      d.st.last_boot_at = now - rng.int(30, 90) * 1000;
      applyDeviceEvent(d, "REBOOT", "INFO", "Device powered on");
    }
    if (status === "ONLINE" && d.profile === "STANDARD") randomActivity(d);
    if (prev !== status || (sim.tick + i) % CFG.heartbeatEvery === 0) {
      if (status === "ONLINE") drift(d);
      applyHeartbeat(d, report(d, status));
      stat("heartbeats");
    }
  });
  if (CFG.registrationMin > 0 && now - sim.last_registration >= CFG.registrationMin * MIN) {
    sim.last_registration = now;
    const [model, prefix, hw] = rng.pick(NEW_MODELS);
    const region = rng.pick(Object.keys(REGIONS));
    try {
      createDevice({
        serial_number: `${prefix}26${rng.int(800000, 999999)}`,
        mac_address: "00:1E:46:" + [0, 0, 0].map(() => rng.int(0, 255).toString(16).toUpperCase().padStart(2, "0")).join(":"),
        model, hardware_version: hw, ip_address: `100.${rng.int(64, 127)}.${rng.int(0, 255)}.${rng.int(1, 254)}`,
        customer_ref: `BAN-${rng.int(500000000, 599999999)}`, region, city: rng.pick(REGIONS[region]),
        simulation_profile: "STANDARD", initial_status: "ONLINE",
      }, "Device self-registered through the device gateway");
      stat("registrations");
    } catch {
      stat("errors");
    }
  }
}

/** One engine step; called every second. */
export function tick(): void {
  const now = Date.now();
  let changed = workerCommands(now);
  changed = workerDeployments(now) || changed;
  changed = finishReboots(now) || changed;
  if (store.s.sim.running) {
    changed = simCommands(now) || changed;
    changed = simDeployments(now) || changed;
    if (now - lastFleetTick >= CFG.tickMs) {
      lastFleetTick = now;
      fleetTick(now);
      changed = true;
    }
  }
  if (now - lastHousekeeping >= MIN) {
    lastHousekeeping = now;
    housekeeping(now);
    changed = true;
  }
  if (changed) markDirty();
}

export function simulatorStatus() {
  const s = store.s;
  const count = (status: string) => s.devices.filter((d) => d.st.connection_status === status).length;
  return {
    running: s.sim.running, devices: s.devices.length, online: count("ONLINE"), offline: count("OFFLINE"), rebooting: count("REBOOTING"),
    tick: s.sim.tick, started_at: iso(s.sim.started_at), stats: s.sim.stats,
    inflight_commands: s.commands.filter((c) => ["SENT", "ACKNOWLEDGED", "EXECUTING"].includes(c.status)).length,
    inflight_firmware_targets: s.targets.filter((t) => t.status === "DOWNLOADING" || t.status === "INSTALLING").length,
    mode: "SIMULATED",
  };
}

export function simulatorAction(action: string) {
  const sim = store.s.sim;
  const now = Date.now();
  if (action === "start" && !sim.running) {
    sim.running = true;
    sim.started_at = now;
  } else if (action === "stop") {
    sim.running = false;
  } else if (action === "reset") {
    for (const d of store.s.devices) {
      if (d.profile !== "STANDARD") continue;
      d.sim.base_cpu = rng.uniform(8, 40);
      d.sim.base_mem = rng.uniform(30, 60);
      d.sim.spike = 0;
      d.sim.busy_until = 0;
      d.sim.reboot = undefined;
      d.st.cpu_usage = d.sim.base_cpu;
      d.st.memory_usage = d.sim.base_mem;
      d.st.last_boot_at = now - rng.uniform(0.5, 240) * HOUR;
      applyHeartbeat(d, report(d, rng.next() < 0.87 ? "ONLINE" : "OFFLINE"));
    }
    sim.tick = 0;
  }
  markDirty();
  return simulatorStatus();
}
