import {
  AlertRec, AuditRec, Cmd, DEFAULT_SETTINGS, Dep, Device, DUser, Firmware, RoleName, Target, nextId, store,
} from "./data";
import { randomHex } from "./rng";

export class HttpError {
  constructor(public status: number, public detail: unknown) {}
}

export function fail(status: number, detail: unknown): never {
  throw new HttpError(status, detail);
}

/** FastAPI/pydantic style 422 for a single body field. */
export function invalid(field: string, msg: string): never {
  throw new HttpError(422, [{ type: "value_error", loc: ["body", field], msg: `Value error, ${msg}` }]);
}

export const iso = (ms: number | null | undefined): string | null => (ms === null || ms === undefined ? null : new Date(ms).toISOString());
export const round1 = (v: number) => Math.round(v * 10) / 10;
export const round2 = (v: number) => Math.round(v * 100) / 100;
export const contains = (value: string | null | undefined, term: string) => (value ?? "").toLowerCase().includes(term.trim().toLowerCase());

// ------------------------------------------------------------------ permissions
const READ = ["dashboard:view", "devices:view", "commands:view", "firmware:view", "applications:view", "monitoring:view", "alerts:view", "analytics:view"];
const ALL = [...READ, "devices:manage", "commands:execute", "commands:factory_reset", "firmware:manage", "alerts:manage", "users:manage", "audit:view", "settings:manage"];
export const ROLE_PERMISSIONS: Record<RoleName, string[]> = {
  ADMIN: [...ALL].sort(),
  SUPPORT_ENGINEER: [...READ, "commands:execute", "alerts:manage"].sort(),
  READ_ONLY: [...READ].sort(),
};
export const ROLE_DESCRIPTIONS: Record<RoleName, string> = {
  ADMIN: "Full access: users, firmware deployments, remote commands, audit logs, settings",
  SUPPORT_ENGINEER: "Device inspection, diagnostics, authorised remote commands and alert handling",
  READ_ONLY: "View-only access to dashboards, inventory, device details and reports",
};
export const hasPermission = (role: RoleName, perm: string) => ROLE_PERMISSIONS[role]?.includes(perm) ?? false;

// ------------------------------------------------------------------ lookups
let deviceIndex: Map<number, Device> | null = null;
export const invalidateDeviceIndex = () => (deviceIndex = null);

export function devByPk(pk: number): Device | undefined {
  if (!deviceIndex) deviceIndex = new Map(store.s.devices.map((d) => [d.id, d]));
  return deviceIndex.get(pk);
}

export function getDevice(deviceId: string): Device {
  const d = store.s.devices.find((x) => x.device_id === deviceId);
  if (!d) fail(404, `Device '${deviceId}' not found`);
  return d;
}

export const fwById = (id: number | null): Firmware | undefined => (id === null ? undefined : store.s.firmware.find((f) => f.id === id));
export const latestFw = (model: string): Firmware | undefined => store.s.firmware.find((f) => f.model === model && f.is_latest);
export const userById = (id: number | null): DUser | undefined => (id === null ? undefined : store.s.users.find((u) => u.id === id));

export function settingsMap(): Record<string, string> {
  const out: Record<string, string> = {};
  for (const k of Object.keys(DEFAULT_SETTINGS)) out[k] = store.s.settings[k]?.value ?? DEFAULT_SETTINGS[k][0];
  return out;
}

export function settingFloat(key: string): number {
  const v = Number(settingsMap()[key]);
  return Number.isFinite(v) ? v : Number(DEFAULT_SETTINGS[key][0]);
}

export const newCode = (prefix: string) => `${prefix}-${randomHex(4)}`;

// ------------------------------------------------------------------ serializers
export function serializeDevice(d: Device) {
  const latest = latestFw(d.model);
  const s = d.st;
  return {
    id: d.id, device_id: d.device_id, serial_number: d.serial_number, mac_address: d.mac_address, model: d.model,
    hardware_version: d.hardware_version, firmware_version: fwById(d.fw_id)?.version ?? "", os_version: d.os_version,
    ip_address: d.ip_address, connection_status: s.connection_status, health_status: s.health_status, last_seen_at: iso(s.last_seen_at),
    customer_ref: d.customer_ref, region: d.region, city: d.city, simulation_profile: d.profile, registered_at: iso(d.registered_at),
    update_available: !!latest && latest.id !== d.fw_id, latest_firmware_version: latest ? latest.version : null,
  };
}

export function serializeDeviceDetail(d: Device) {
  const s = d.st;
  return {
    ...serializeDevice(d),
    firmware_release_date: iso(fwById(d.fw_id)?.release_date),
    last_boot_at: iso(s.last_boot_at),
    uptime_seconds: s.connection_status === "ONLINE" && s.last_boot_at ? Math.floor((Date.now() - s.last_boot_at) / 1000) : null,
    last_connected_at: iso(s.last_connected_at),
    last_disconnected_at: iso(s.last_disconnected_at),
    cpu_usage: s.cpu_usage, memory_usage: s.memory_usage, storage_usage: s.storage_usage, temperature_c: s.temperature_c,
    network_type: s.network_type, signal_strength_dbm: s.signal_strength_dbm, bandwidth_mbps: s.bandwidth_mbps,
    latency_ms: s.latency_ms, packet_loss_pct: s.packet_loss_pct,
    open_alerts: store.s.alerts.filter((a) => a.pk === d.id && a.status !== "RESOLVED").length,
  };
}

export function serializeCommand(c: Cmd, includeHistory = false) {
  const d = devByPk(c.pk);
  return {
    id: c.id, command_code: c.code, device_id: d?.device_id ?? "", serial_number: d?.serial_number ?? "", device_model: d?.model ?? "",
    command_type: c.type, status: c.status, parameters: c.params ?? {}, result_message: c.result_message,
    requested_by: userById(c.requested_by)?.username ?? null, timeout_seconds: c.timeout_seconds,
    created_at: iso(c.created_at), queued_at: iso(c.queued_at), sent_at: iso(c.sent_at), acknowledged_at: iso(c.acknowledged_at),
    started_at: iso(c.started_at), completed_at: iso(c.completed_at), expires_at: iso(c.expires_at),
    history: includeHistory ? c.history.map((h) => ({ status: h.status, message: h.message, created_at: iso(h.created_at) })) : [],
  };
}

export function serializeAlert(a: AlertRec) {
  const d = devByPk(a.pk);
  return {
    id: a.id, alert_code: a.code, device_id: d?.device_id ?? "", serial_number: d?.serial_number ?? "", category: a.category,
    severity: a.severity, title: a.title, description: a.description, status: a.status, created_at: iso(a.created_at),
    acknowledged_at: iso(a.ack_at), acknowledged_by: userById(a.ack_by)?.username ?? null, resolved_at: iso(a.res_at),
    resolved_by: userById(a.res_by)?.username ?? (a.res_at ? "system" : null), resolution_note: a.note,
  };
}

export function serializeAudit(a: AuditRec) {
  return {
    id: a.id, user_id: a.user_id, username: a.username, action: a.action, target_type: a.target_type, target_id: a.target_id,
    details: a.details, result: a.result, ip_address: a.ip_address, created_at: iso(a.created_at),
  };
}

export function serializeUser(u: DUser) {
  return {
    id: u.id, username: u.username, email: u.email, full_name: u.full_name, role: u.role, is_active: u.is_active,
    last_login_at: iso(u.last_login_at), created_at: iso(u.created_at), updated_at: iso(u.updated_at),
  };
}

export const currentUserPayload = (u: DUser) => ({ ...serializeUser(u), permissions: ROLE_PERMISSIONS[u.role] });

export function targetCounts(depId: number): Record<string, number> {
  const counts: Record<string, number> = {};
  for (const t of store.s.targets) if (t.dep_id === depId) counts[t.status] = (counts[t.status] ?? 0) + 1;
  return counts;
}

export function serializeDeployment(d: Dep) {
  const counts = targetCounts(d.id);
  const total = Object.values(counts).reduce((a, b) => a + b, 0);
  const success = counts.SUCCESS ?? 0;
  const failed = counts.FAILED ?? 0;
  const fw = fwById(d.fw_id);
  return {
    id: d.id, deployment_code: d.code, name: d.name, firmware_version_id: d.fw_id, firmware_version: fw?.version ?? "", model: fw?.model ?? "",
    status: d.status, is_rollback: d.is_rollback, rollback_of: store.s.deployments.find((x) => x.id === d.rollback_of)?.code ?? null,
    offline_policy: d.offline_policy, target_count: total, successful_count: success, failed_count: failed,
    pending_count: counts.PENDING ?? 0, in_progress_count: (counts.DOWNLOADING ?? 0) + (counts.INSTALLING ?? 0),
    progress_pct: total ? round1((100 * (success + failed)) / total) : 0,
    scheduled_at: iso(d.scheduled_at), started_at: iso(d.started_at), completed_at: iso(d.completed_at),
    created_by: userById(d.created_by)?.username ?? null, created_at: iso(d.created_at),
  };
}

// ------------------------------------------------------------------ mutations
export function recordAudit(opts: {
  user: DUser | null; username?: string; action: string; target_type?: string | null; target_id?: string | null;
  details?: Record<string, unknown>; result?: string;
}): void {
  store.s.audit.push({
    id: nextId("audit"), user_id: opts.user?.id ?? null, username: opts.username ?? opts.user?.username ?? "anonymous",
    action: opts.action, target_type: opts.target_type ?? null, target_id: opts.target_id ?? null, details: opts.details ?? {},
    result: opts.result ?? "SUCCESS", ip_address: "127.0.0.1", created_at: Date.now(),
  });
}

export function addEvent(pk: number, type: string, sev: string, desc: string): void {
  store.s.events.push({ id: nextId("events"), pk, type, sev, desc, at: Date.now() });
  store.s.sim.stats.events = (store.s.sim.stats.events ?? 0) + 1;
}

export function addLog(pk: number, sev: string, cat: string, comp: string, msg: string): void {
  store.s.logs.push({ id: nextId("logs"), pk, sev, cat, comp, msg, at: Date.now() });
}

export function raiseAlert(d: Device, category: string, severity: string, title: string, description: string): void {
  if (store.s.alerts.some((a) => a.pk === d.id && a.category === category && a.status !== "RESOLVED")) return;
  store.s.alerts.push({
    id: nextId("alerts"), code: newCode("ALR"), pk: d.id, category, severity, title, description, status: "OPEN",
    created_at: Date.now(), ack_at: null, ack_by: null, res_at: null, res_by: null, note: null,
  });
}

export function autoResolve(pk: number, category: string, note: string): void {
  for (const a of store.s.alerts) {
    if (a.pk === pk && a.category === category && a.status !== "RESOLVED") {
      a.status = "RESOLVED";
      a.res_at = Date.now();
      a.note = note;
    }
  }
}

export const COMMAND_LABELS: Record<string, string> = {
  REBOOT: "Reboot Device",
  FACTORY_RESET: "Factory Reset",
  SYNC_CONFIG: "Synchronize Configuration",
  REFRESH_INFO: "Refresh Device Information",
  RESTART_APP: "Restart Application",
  CLEAR_APP_CACHE: "Clear Application Cache",
};
export const TERMINAL = ["SUCCESSFUL", "FAILED", "TIMED_OUT"];
const ALLOWED: Record<string, string[]> = {
  PENDING: ["QUEUED", "FAILED"],
  QUEUED: ["SENT", "TIMED_OUT", "FAILED"],
  SENT: ["ACKNOWLEDGED", "FAILED", "TIMED_OUT"],
  ACKNOWLEDGED: ["EXECUTING", "FAILED", "TIMED_OUT"],
  EXECUTING: ["SUCCESSFUL", "FAILED", "TIMED_OUT"],
};
const STAMP: Record<string, "queued_at" | "sent_at" | "acknowledged_at" | "started_at" | "completed_at"> = {
  QUEUED: "queued_at", SENT: "sent_at", ACKNOWLEDGED: "acknowledged_at", EXECUTING: "started_at",
  SUCCESSFUL: "completed_at", FAILED: "completed_at", TIMED_OUT: "completed_at",
};

export function transition(c: Cmd, status: string, message: string | null = null): void {
  if (!(ALLOWED[c.status] ?? []).includes(status)) return;
  const now = Date.now();
  c.status = status;
  c[STAMP[status]] = now;
  if (message) c.result_message = message;
  c.history.push({ status, message, created_at: now });
  if (TERMINAL.includes(status)) {
    const sev = { SUCCESSFUL: "INFO", FAILED: "ERROR", TIMED_OUT: "WARNING" }[status] as string;
    addEvent(c.pk, `COMMAND_${status}`, sev,
      `${COMMAND_LABELS[c.type] ?? c.type} (${c.code}) ${status.replace("_", " ").toLowerCase()}${message ? `: ${message}` : ""}`);
  }
}

export function finalizeIfDone(d: Dep): void {
  if (d.status !== "IN_PROGRESS") return;
  const counts = targetCounts(d.id);
  if ((counts.PENDING ?? 0) + (counts.DOWNLOADING ?? 0) + (counts.INSTALLING ?? 0) > 0) return;
  const success = counts.SUCCESS ?? 0;
  const failed = counts.FAILED ?? 0;
  d.status = failed === 0 ? "COMPLETED" : success === 0 ? "FAILED" : "COMPLETED_WITH_ERRORS";
  d.completed_at = Date.now();
}

export interface Heartbeat {
  connection_status: string;
  cpu_usage: number;
  memory_usage: number;
  storage_usage: number;
  temperature_c: number | null;
  network_type: string;
  signal_strength_dbm: number | null;
  bandwidth_mbps: number;
  latency_ms: number;
  packet_loss_pct: number;
  boot_time: number | null;
}

/** Port of POST /api/gateway/heartbeats for a single device report. */
export function applyHeartbeat(d: Device, r: Heartbeat): void {
  const st = d.st;
  const now = Date.now();
  const prev = st.connection_status;
  st.connection_status = r.connection_status;
  if (r.connection_status !== "OFFLINE") st.last_seen_at = now;
  if (r.boot_time) st.last_boot_at = r.boot_time;
  if (r.connection_status === "ONLINE") {
    Object.assign(st, {
      cpu_usage: r.cpu_usage, memory_usage: r.memory_usage, storage_usage: r.storage_usage, temperature_c: r.temperature_c,
      network_type: r.network_type, signal_strength_dbm: r.network_type === "WIFI" ? r.signal_strength_dbm : null,
      bandwidth_mbps: r.bandwidth_mbps, latency_ms: r.latency_ms, packet_loss_pct: r.packet_loss_pct,
    });
    if (r.cpu_usage >= 95 || r.memory_usage >= 95 || (r.temperature_c ?? 0) >= settingFloat("temperature_critical_threshold")) st.health_status = "CRITICAL";
    else if (
      r.cpu_usage >= settingFloat("cpu_warning_threshold") || r.memory_usage >= settingFloat("memory_warning_threshold") ||
      r.storage_usage >= settingFloat("storage_warning_threshold") || r.packet_loss_pct >= 5
    ) st.health_status = "WARNING";
    else st.health_status = "HEALTHY";
    const cpuAlert = settingFloat("cpu_alert_threshold");
    const memAlert = settingFloat("memory_alert_threshold");
    if (r.cpu_usage >= cpuAlert) {
      raiseAlert(d, "HIGH_CPU", r.cpu_usage >= 97 ? "CRITICAL" : "WARNING", "High CPU usage", `CPU utilisation at ${Math.round(r.cpu_usage)}% (threshold ${Math.round(cpuAlert)}%)`);
    } else if (r.cpu_usage < cpuAlert - 10) autoResolve(d.id, "HIGH_CPU", `Auto-resolved: CPU back to ${Math.round(r.cpu_usage)}%`);
    if (r.memory_usage >= memAlert) {
      raiseAlert(d, "HIGH_MEMORY", r.memory_usage >= 97 ? "CRITICAL" : "WARNING", "High memory usage", `Memory utilisation at ${Math.round(r.memory_usage)}% (threshold ${Math.round(memAlert)}%)`);
    } else if (r.memory_usage < memAlert - 10) autoResolve(d.id, "HIGH_MEMORY", `Auto-resolved: memory back to ${Math.round(r.memory_usage)}%`);
  }
  if (prev !== "ONLINE" && r.connection_status === "ONLINE") {
    st.last_connected_at = now;
    addEvent(d.id, "CONNECTED", "INFO", `Device connected via ${r.network_type.toLowerCase()} (${d.ip_address})`);
    autoResolve(d.id, "DEVICE_OFFLINE", "Auto-resolved: device reconnected");
    autoResolve(d.id, "NETWORK_DISCONNECT", "Auto-resolved: network restored");
  } else if (prev !== "OFFLINE" && r.connection_status === "OFFLINE") {
    st.last_disconnected_at = now;
    addEvent(d.id, "DISCONNECTED", "WARNING", "Heartbeat lost - device disconnected");
    if (settingsMap().offline_alerts_enabled === "true") {
      raiseAlert(d, "DEVICE_OFFLINE", "WARNING", "Device offline", `${d.device_id} (${d.model}) stopped sending heartbeats`);
    }
  }
}

const EVENT_ALERTS: Record<string, [string, string, string]> = {
  APP_CRASH: ["APP_CRASH", "WARNING", "Application crash"],
  CRITICAL_ERROR: ["CRITICAL_ERROR", "CRITICAL", "Device critical error"],
  NETWORK_LOSS: ["NETWORK_DISCONNECT", "WARNING", "Network disconnection"],
};

/** Port of POST /api/gateway/events for a single device event. */
export function applyDeviceEvent(d: Device, type: string, sev: string, desc: string, log?: [string, string, string], packageId?: string): void {
  addEvent(d.id, type, sev, desc);
  if (log) addLog(d.id, sev, log[0], log[1], log[2]);
  if (type === "APP_CRASH" && packageId) {
    const app = store.s.apps.find((a) => a.package_id === packageId);
    const ia = app && d.apps.find((x) => x.app_id === app.id);
    if (ia) ia.crashes += 1;
  }
  const alert = EVENT_ALERTS[type];
  if (alert) {
    raiseAlert(d, alert[0], alert[1], alert[2], desc);
    if (alert[0] === "CRITICAL_ERROR") d.st.health_status = "CRITICAL";
  }
}

/** Port of POST /api/gateway/deployments/targets/{id}/status. */
export function updateTarget(t: Target, status: string, error: string | null = null): void {
  const dep = store.s.deployments.find((x) => x.id === t.dep_id);
  if (!dep || dep.status !== "IN_PROGRESS" || t.status === "SUCCESS" || t.status === "FAILED") return;
  t.status = status;
  t.error = error;
  t.updated_at = Date.now();
  const fw = fwById(t.target_fw_id);
  const d = devByPk(t.pk);
  if (fw && d) {
    if (status === "SUCCESS") {
      const old = fwById(d.fw_id)?.version ?? "";
      d.fw_id = fw.id;
      d.os_version = fw.os_version;
      addEvent(d.id, "FIRMWARE_UPDATED", "INFO", `Firmware updated ${old} -> ${fw.version} (${dep.code})`);
      if (fw.is_latest) autoResolve(d.id, "FIRMWARE_UPDATE", `Auto-resolved: updated to ${fw.version}`);
    } else if (status === "FAILED") {
      addEvent(d.id, "FIRMWARE_UPDATE_FAILED", "ERROR", `Firmware ${fw.version} installation failed: ${error ?? "unknown"}`);
      addLog(d.id, "ERROR", "FIRMWARE", "fw-updater", `Update to ${fw.version} failed: ${error ?? "unknown error"}`);
    }
  }
  finalizeIfDone(dep);
}

export interface NewDevice {
  serial_number: string;
  mac_address: string;
  model: string;
  hardware_version: string;
  ip_address: string;
  customer_ref: string;
  region: string;
  city: string;
  simulation_profile: string;
  initial_status: string;
}

/** Port of services.devices.provision_device (input already validated). */
export function createDevice(b: NewDevice, description: string): Device {
  const fw = latestFw(b.model);
  if (!fw) fail(422, `Unknown device model '${b.model}'`);
  const deviceId = `STB-${b.serial_number.slice(-8)}`;
  if (store.s.devices.some((d) => d.serial_number === b.serial_number || d.mac_address === b.mac_address || d.device_id === deviceId)) {
    fail(409, "A device with this serial number, MAC address or device ID already exists");
  }
  const now = Date.now();
  const online = b.initial_status === "ONLINE";
  const u = (lo: number, hi: number) => round1(lo + (hi - lo) * Math.random());
  const d: Device = {
    id: nextId("devices"), device_id: deviceId, serial_number: b.serial_number, mac_address: b.mac_address, model: b.model,
    hardware_version: b.hardware_version, fw_id: fw.id, os_version: fw.os_version, ip_address: b.ip_address, customer_ref: b.customer_ref,
    region: b.region, city: b.city, profile: b.simulation_profile, registered_at: now,
    st: {
      connection_status: b.initial_status, health_status: "HEALTHY", last_seen_at: online ? now : null, last_boot_at: online ? now : null,
      last_connected_at: online ? now : null, last_disconnected_at: null, cpu_usage: online ? u(8, 25) : 0, memory_usage: online ? u(30, 50) : 0,
      storage_usage: u(20, 40), temperature_c: u(40, 50), network_type: "ETHERNET", signal_strength_dbm: null,
      bandwidth_mbps: online ? u(80, 300) : 0, latency_ms: online ? u(8, 20) : 0, packet_loss_pct: 0,
    },
    apps: store.s.apps
      .filter((a) => a.category === "Live TV" || a.category === "System")
      .map((a) => ({ app_id: a.id, version: a.latest_version, status: "INSTALLED", installed_at: now, last_used_at: null, usage: 0, crashes: 0 })),
    sim: { base_cpu: u(8, 30), base_mem: u(30, 55), spike: 0, busy_until: 0 },
  };
  store.s.devices.push(d);
  invalidateDeviceIndex();
  addEvent(d.id, "REGISTERED", "INFO", description);
  return d;
}
