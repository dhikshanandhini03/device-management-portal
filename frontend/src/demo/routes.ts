import {
  AlertRec, App, AuditRec, Cmd, DAY, DEFAULT_SETTINGS, Dep, Device, DUser, HOUR, LogRec, MIN, RoleName, Target,
  hashPassword, markDirty, nextId, store,
} from "./data";
import {
  COMMAND_LABELS, HttpError, ROLE_DESCRIPTIONS, ROLE_PERMISSIONS, TERMINAL, contains, createDevice, currentUserPayload,
  devByPk, fail, fwById, getDevice, hasPermission, invalidateDeviceIndex, iso, latestFw, newCode, recordAudit, round1, round2,
  serializeAlert, serializeAudit, serializeCommand, serializeDeployment, serializeDevice, serializeDeviceDetail, serializeUser,
  settingFloat, settingsMap, userById,
} from "./logic";
import { simulatorAction, simulatorStatus } from "./engine";
import { noise } from "./rng";

type Body = Record<string, unknown>;
type Q = Record<string, string>;

export interface Ctx {
  method: string;
  path: string;
  q: Q;
  body: Body;
  params: Record<string, string>;
  auth: string | null;
}

export class Reply {
  constructor(public status: number, public data: unknown, public headers: Record<string, string> = {}) {}
}

// ------------------------------------------------------------------ validation helpers (FastAPI/pydantic style)
function bad(loc: "body" | "query", field: string, msg: string): never {
  throw new HttpError(422, [{ type: "value_error", loc: [loc, field], msg }]);
}

interface StrOpts { min?: number; max?: number; pattern?: RegExp; required?: boolean }

function strField(loc: "body" | "query", field: string, raw: unknown, o: StrOpts): string | undefined {
  if (raw === undefined || raw === null || (loc === "query" && raw === "")) {
    if (o.required) bad(loc, field, "Field required");
    return undefined;
  }
  if (typeof raw !== "string") bad(loc, field, "Input should be a valid string");
  if (o.min !== undefined && raw.length < o.min) bad(loc, field, `String should have at least ${o.min} character${o.min === 1 ? "" : "s"}`);
  if (o.max !== undefined && raw.length > o.max) bad(loc, field, `String should have at most ${o.max} characters`);
  if (o.pattern && !o.pattern.test(raw)) bad(loc, field, `String should match pattern '${o.pattern.source}'`);
  return raw;
}

const bstr = (b: Body, f: string, o: StrOpts = {}) => strField("body", f, b[f], o);
const qstr = (q: Q, f: string, o: StrOpts = {}) => strField("query", f, q[f], o);

function qint(q: Q, f: string, def: number, min: number, max: number): number {
  if (q[f] === undefined || q[f] === "") return def;
  const v = Number(q[f]);
  if (!Number.isInteger(v)) bad("query", f, "Input should be a valid integer, unable to parse string as an integer");
  if (v < min) bad("query", f, `Input should be greater than or equal to ${min}`);
  if (v > max) bad("query", f, `Input should be less than or equal to ${max}`);
  return v;
}

function qbool(q: Q, f: string): boolean | undefined {
  const v = q[f];
  if (v === undefined || v === "") return undefined;
  if (["true", "1", "yes", "on"].includes(v.toLowerCase())) return true;
  if (["false", "0", "no", "off"].includes(v.toLowerCase())) return false;
  return bad("query", f, "Input should be a valid boolean, unable to interpret input");
}

function qdate(q: Q, f: string): number | undefined {
  const v = q[f];
  if (!v) return undefined;
  const ms = Date.parse(/^\d{4}-\d{2}-\d{2}$/.test(v) ? `${v}T00:00:00Z` : v);
  if (Number.isNaN(ms)) bad("query", f, "Input should be a valid datetime");
  return ms;
}

function passwordStrength(field: string, value: string): void {
  if (value.length < 8) bad("body", field, "Value error, Password must be at least 8 characters");
  if (![/[A-Z]/, /[a-z]/, /[0-9]/, /[^A-Za-z0-9]/].every((r) => r.test(value))) {
    bad("body", field, "Value error, Password must contain upper and lower case letters, a digit and a special character");
  }
}

const EMAIL_RE = /^[^@\s]+@[^@\s]+\.[A-Za-z0-9-]{2,}$/;
function email(field: string, raw: unknown): string {
  const v = strField("body", field, raw, { required: true });
  if (!v || !EMAIL_RE.test(v)) bad("body", field, "value is not a valid email address: An email address must have an @-sign and a valid domain.");
  return v;
}

// ------------------------------------------------------------------ query helpers
function paginate<T, R>(ctx: Ctx, rows: T[], map: (row: T) => R) {
  const page = qint(ctx.q, "page", 1, 1, 100000);
  const size = qint(ctx.q, "page_size", 25, 1, 500);
  const items = rows.slice((page - 1) * size, page * size).map(map);
  return { items, total: rows.length, page, page_size: size, pages: Math.max(1, Math.ceil(rows.length / size)) };
}

/** PostgreSQL ordering: NULLs sort last ascending and first descending. */
function compare(a: unknown, b: unknown): number {
  const an = a === null || a === undefined;
  const bn = b === null || b === undefined;
  if (an || bn) return an === bn ? 0 : an ? 1 : -1;
  if (typeof a === "number" && typeof b === "number") return a - b;
  const sa = String(a);
  const sb = String(b);
  return sa < sb ? -1 : sa > sb ? 1 : 0;
}

function sortRows<T>(rows: T[], key: (r: T) => unknown, dir: string, tie?: (r: T) => unknown): T[] {
  const sign = dir === "desc" ? -1 : 1;
  return rows.sort((a, b) => sign * compare(key(a), key(b)) || (tie ? compare(tie(a), tie(b)) : 0));
}

const newestFirst = <T extends { id: number }>(rows: T[], at: (r: T) => number) => rows.sort((a, b) => at(b) - at(a) || b.id - a.id);

function csvCell(v: unknown): string {
  let text: string;
  if (v === null || v === undefined) text = "";
  else if (typeof v === "number" || typeof v === "boolean") text = v === true ? "True" : v === false ? "False" : String(v);
  else {
    text = String(v);
    if (text && "=+-@\t\r".includes(text[0])) text = `'${text}`;
  }
  return /[",\r\n]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
}

function csv(filename: string, headers: string[], rows: unknown[][]): Reply {
  const body = [headers, ...rows].map((r) => r.map(csvCell).join(",")).join("\r\n") + "\r\n";
  return new Reply(200, body, { "content-type": "text/csv", "content-disposition": `attachment; filename="${filename}"` });
}

const dayStart = (ms: number) => Math.floor(ms / DAY) * DAY;
const stamp = () => new Date().toISOString().replace(/[-:]/g, "").replace("T", "-").slice(0, 15);

// ------------------------------------------------------------------ auth
const b64url = (o: unknown) => btoa(JSON.stringify(o)).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
const TOKEN_MINUTES = 60;
const failedLogins = new Map<string, number[]>();

function currentUser(ctx: Ctx): DUser {
  const m = /^Bearer (.+)$/.exec(ctx.auth ?? "");
  if (!m) fail(401, "Not authenticated");
  let payload: { sub?: string; exp?: number };
  try {
    payload = JSON.parse(atob(m[1].split(".")[1].replace(/-/g, "+").replace(/_/g, "/")));
  } catch {
    return fail(401, "Invalid token");
  }
  if (!payload.exp || payload.exp * 1000 <= Date.now()) fail(401, "Session expired");
  const user = userById(Number(payload.sub));
  if (!user || !user.is_active) fail(401, "User inactive or not found");
  return user;
}

function requirePerm(ctx: Ctx, perm: string): DUser {
  const user = currentUser(ctx);
  if (!hasPermission(user.role, perm)) {
    recordAudit({ user, action: "ACCESS_DENIED", result: "DENIED", target_type: "endpoint", target_id: `${ctx.method} /api${ctx.path}`.slice(0, 64), details: { required_permission: perm } });
    markDirty();
    fail(403, `Permission '${perm}' required`);
  }
  return user;
}

async function login(ctx: Ctx) {
  const username = bstr(ctx.body, "username", { required: true, min: 1, max: 255 }) as string;
  const password = bstr(ctx.body, "password", { required: true, min: 1, max: 128 }) as string;
  const key = username.toLowerCase();
  const recent = (failedLogins.get(key) ?? []).filter((t) => t > Date.now() - 5 * MIN);
  failedLogins.set(key, recent);
  if (recent.length >= 10) fail(429, "Too many failed attempts. Try again later.");
  const ident = username.trim().toLowerCase();
  const user = store.s.users.find((u) => u.username.toLowerCase() === ident || u.email.toLowerCase() === ident);
  markDirty();
  if (!user || user.password_hash !== (await hashPassword(password))) {
    recent.push(Date.now());
    recordAudit({ user: user ?? null, username: username.slice(0, 64), action: "LOGIN_FAILED", result: "FAILURE", target_type: "session", details: { reason: "invalid_credentials" } });
    fail(401, "Invalid username or password");
  }
  if (!user.is_active) {
    recordAudit({ user, action: "LOGIN_FAILED", result: "DENIED", target_type: "session", details: { reason: "account_deactivated" } });
    fail(403, "Account is deactivated. Contact your administrator.");
  }
  failedLogins.delete(key);
  user.last_login_at = Date.now();
  recordAudit({ user, action: "LOGIN", target_type: "session", details: { user_agent: navigator.userAgent.slice(0, 200) } });
  const exp = Math.floor(Date.now() / 1000) + TOKEN_MINUTES * 60;
  const token = `${b64url({ alg: "none", typ: "JWT" })}.${b64url({ sub: String(user.id), role: user.role, exp })}.demo`;
  return { access_token: token, token_type: "bearer", expires_at: iso(exp * 1000), user: currentUserPayload(user) };
}

async function changePassword(ctx: Ctx) {
  const user = currentUser(ctx);
  const current = bstr(ctx.body, "current_password", { required: true, min: 1, max: 128 }) as string;
  const next = bstr(ctx.body, "new_password", { required: true, max: 128 }) as string;
  passwordStrength("new_password", next);
  if (user.password_hash !== (await hashPassword(current))) fail(400, "Current password is incorrect");
  user.password_hash = await hashPassword(next);
  user.updated_at = Date.now();
  recordAudit({ user, action: "PASSWORD_CHANGED", target_type: "user", target_id: user.username });
  markDirty();
  return { message: "Password updated" };
}

// ------------------------------------------------------------------ devices
const DEVICE_SORT: Record<string, (d: Device) => unknown> = {
  device_id: (d) => d.device_id,
  serial_number: (d) => d.serial_number,
  mac_address: (d) => d.mac_address,
  model: (d) => d.model,
  hardware_version: (d) => d.hardware_version,
  firmware_version: (d) => fwById(d.fw_id)?.version,
  ip_address: (d) => d.ip_address,
  connection_status: (d) => d.st.connection_status,
  health_status: (d) => d.st.health_status,
  last_seen_at: (d) => d.st.last_seen_at,
  customer_ref: (d) => d.customer_ref,
  region: (d) => d.region,
  registered_at: (d) => d.registered_at,
};

interface DeviceFilter { search?: string; status?: string; model?: string; firmware?: string; region?: string; health?: string; update?: boolean }

function matchDevice(d: Device, f: DeviceFilter): boolean {
  if (f.search && ![d.device_id, d.serial_number, d.mac_address, d.customer_ref, d.ip_address].some((v) => contains(v, f.search as string))) return false;
  if (f.status && d.st.connection_status !== f.status.toUpperCase()) return false;
  if (f.model && d.model !== f.model) return false;
  if (f.firmware && fwById(d.fw_id)?.version !== f.firmware) return false;
  if (f.region && d.region !== f.region) return false;
  if (f.health && d.st.health_status !== f.health.toUpperCase()) return false;
  if (f.update !== undefined) {
    const latest = latestFw(d.model);
    const available = !!latest && latest.id !== d.fw_id;
    if (available !== f.update) return false;
  }
  return true;
}

function filteredDevices(ctx: Ctx): Device[] {
  const q = ctx.q;
  const sortBy = qstr(q, "sort_by");
  if (sortBy && !DEVICE_SORT[sortBy]) fail(422, `Invalid sort field '${sortBy}'. Allowed: ${Object.keys(DEVICE_SORT).sort().join(", ")}`);
  const dir = qstr(q, "sort_dir", { pattern: /^(asc|desc)$/ }) ?? "asc";
  const f: DeviceFilter = {
    search: qstr(q, "search", { max: 64 }), status: qstr(q, "status", { pattern: /^(ONLINE|OFFLINE|REBOOTING|online|offline|rebooting)$/ }),
    model: qstr(q, "model"), firmware: qstr(q, "firmware"), region: qstr(q, "region"),
    health: qstr(q, "health", { pattern: /^(HEALTHY|WARNING|CRITICAL)$/ }), update: qbool(q, "update_available"),
  };
  const rows = store.s.devices.filter((d) => matchDevice(d, f));
  return sortRows(rows, DEVICE_SORT[sortBy ?? "device_id"], dir, (d) => d.device_id);
}

function validateDeviceBody(b: Body) {
  const macRaw = bstr(b, "mac_address", { required: true }) as string;
  const mac = macRaw.toUpperCase().replace(/-/g, ":");
  const out = {
    serial_number: bstr(b, "serial_number", { required: true, pattern: /^[A-Z0-9]{8,20}$/ }) as string,
    mac_address: mac,
    model: bstr(b, "model", { required: true, min: 2, max: 64 }) as string,
    hardware_version: bstr(b, "hardware_version", { required: true, min: 1, max: 16 }) as string,
    ip_address: bstr(b, "ip_address", { required: true, min: 7, max: 45 }) as string,
    customer_ref: bstr(b, "customer_ref", { required: true, min: 3, max: 32 }) as string,
    region: bstr(b, "region", { required: true, min: 2, max: 32 }) as string,
    city: bstr(b, "city", { required: true, min: 2, max: 64 }) as string,
    simulation_profile: bstr(b, "simulation_profile", { pattern: /^(STANDARD|STABLE_ONLINE|STABLE_OFFLINE)$/ }) ?? "STANDARD",
    initial_status: bstr(b, "initial_status", { pattern: /^(ONLINE|OFFLINE)$/ }) ?? "OFFLINE",
  };
  if (!/^([0-9A-F]{2}:){5}[0-9A-F]{2}$/.test(mac)) bad("body", "mac_address", "Value error, MAC address must be in format AA:BB:CC:DD:EE:FF");
  const ipv4 = /^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/.exec(out.ip_address);
  const validV4 = !!ipv4 && ipv4.slice(1).every((p) => Number(p) <= 255 && String(Number(p)) === p);
  const validV6 = !ipv4 && /^[0-9a-fA-F:]+$/.test(out.ip_address) && out.ip_address.includes(":");
  if (!validV4 && !validV6) fail(422, "Invalid IP address");
  return out;
}

function generatedTelemetry(d: Device, hours: number) {
  const now = Date.now();
  const since = now - hours * HOUR;
  const st = d.st;
  const gn = (a: number, b: number) => (noise(a, b) + noise(a, b + 7919) + noise(a, b + 104729) - 1.5) * 2;
  const clampv = (v: number, lo: number, hi: number) => round1(Math.max(lo, Math.min(hi, v)));
  if (hours <= 24 && st.connection_status === "ONLINE") {
    const step = 5 * MIN;
    const end = Math.floor(now / step) * step;
    const points = [];
    for (let t = end - 120 * MIN; t <= end; t += step) {
      if (t < since || t < d.registered_at) continue;
      const k = t / step;
      points.push({
        timestamp: iso(t), cpu_usage: clampv(st.cpu_usage + gn(d.id, k) * 5, 2, 99), memory_usage: clampv(st.memory_usage + gn(d.id + 1e6, k) * 3, 10, 99),
        storage_usage: st.storage_usage, temperature_c: clampv((st.temperature_c ?? 50) + (noise(d.id, k + 3) - 0.5) * 4, 20, 99),
        latency_ms: clampv(st.latency_ms + gn(d.id + 2e6, k) * 2, 1, 999),
      });
    }
    if (points.length) return { device_id: d.device_id, resolution: "raw", points };
  }
  return { device_id: d.device_id, resolution: "hourly", points: hourlyPoints(d, since, now) };
}

function hourlyPoints(d: Device, since: number, now: number) {
  const gn = (a: number, b: number) => (noise(a, b) + noise(a, b + 7919) + noise(a, b + 104729) - 1.5) * 2;
  const baseCpu = Math.max(5, d.sim.base_cpu);
  const baseMem = Math.max(20, d.sim.base_mem);
  const lastSeen = d.st.connection_status === "OFFLINE" ? d.st.last_seen_at ?? 0 : now;
  const points = [];
  for (let t = Math.ceil(since / HOUR) * HOUR; t < Math.floor(now / HOUR) * HOUR; t += HOUR) {
    if (t < d.registered_at || t > lastSeen) continue;
    const h = new Date(t).getUTCHours();
    const diurnal = 1 + 0.35 * (h >= 18 && h <= 23 ? 1 : h >= 2 && h <= 6 ? -0.4 : 0);
    const k = t / HOUR;
    points.push({
      timestamp: iso(t),
      cpu_usage: round1(Math.min(99, Math.max(2, baseCpu * 0.8 * diurnal + gn(d.id, k) * 6))),
      memory_usage: round1(Math.min(99, Math.max(15, baseMem * 0.95 + gn(d.id + 1e6, k) * 4))),
      storage_usage: d.st.storage_usage,
      temperature_c: round1((d.st.temperature_c ?? 50) + (noise(d.id, k + 5) - 0.5) * 6),
      latency_ms: round1(Math.max(2, (d.st.latency_ms || 15) + gn(d.id + 2e6, k) * 3)),
    });
  }
  return points;
}

function installedApps(d: Device) {
  return d.apps
    .map((ia) => ({ ia, app: store.s.apps.find((a) => a.id === ia.app_id) as App }))
    .sort((a, b) => a.app.name.localeCompare(b.app.name))
    .map(({ ia, app }) => ({
      application_id: app.id, name: app.name, package_id: app.package_id, category: app.category, version: ia.version,
      latest_version: app.latest_version, status: ia.status, update_available: ia.version !== app.latest_version,
      installed_at: iso(ia.installed_at), last_used_at: iso(ia.last_used_at), usage_minutes_7d: ia.usage, crash_count_7d: ia.crashes,
    }));
}

const serializeEvent = (e: { id: number; type: string; sev: string; desc: string; at: number; pk: number }) => ({
  id: e.id, event_type: e.type, severity: e.sev, description: e.desc, created_at: iso(e.at), device_id: devByPk(e.pk)?.device_id ?? null,
});

const serializeLog = (l: LogRec) => {
  const d = devByPk(l.pk);
  return { id: l.id, severity: l.sev, category: l.cat, component: l.comp, message: l.msg, created_at: iso(l.at), device_id: d?.device_id ?? null, serial_number: d?.serial_number ?? null };
};

// ------------------------------------------------------------------ dashboard helpers
function fleetCounts() {
  const s = store.s;
  const by = (f: (d: Device) => boolean) => s.devices.filter(f).length;
  return {
    total_devices: s.devices.length,
    online_devices: by((d) => d.st.connection_status === "ONLINE"),
    offline_devices: by((d) => d.st.connection_status === "OFFLINE"),
    rebooting_devices: by((d) => d.st.connection_status === "REBOOTING"),
    warning_devices: by((d) => d.st.health_status === "WARNING"),
    critical_devices: by((d) => d.st.health_status === "CRITICAL"),
    healthy_devices: by((d) => d.st.health_status === "HEALTHY"),
    firmware_update_available: by((d) => {
      const l = latestFw(d.model);
      return !!l && l.id !== d.fw_id;
    }),
  };
}

function groupCount<T>(rows: T[], key: (r: T) => string): [string, number][] {
  const m = new Map<string, number>();
  for (const r of rows) m.set(key(r), (m.get(key(r)) ?? 0) + 1);
  return [...m.entries()];
}

// ------------------------------------------------------------------ applications
function appStats() {
  const stats = new Map<number, { device_count: number; versions: Set<string>; latest: number; update: number; failed: number; usage: number; crashes: number }>();
  for (const a of store.s.apps) stats.set(a.id, { device_count: 0, versions: new Set(), latest: 0, update: 0, failed: 0, usage: 0, crashes: 0 });
  for (const d of store.s.devices) {
    for (const ia of d.apps) {
      const s = stats.get(ia.app_id);
      const app = store.s.apps.find((a) => a.id === ia.app_id);
      if (!s || !app) continue;
      s.device_count += 1;
      s.versions.add(ia.version);
      if (ia.version === app.latest_version) s.latest += 1;
      else s.update += 1;
      if (ia.status === "INSTALL_FAILED") s.failed += 1;
      s.usage += ia.usage;
      s.crashes += ia.crashes;
    }
  }
  return stats;
}

function appDict(a: App, s: ReturnType<typeof appStats>) {
  const st = s.get(a.id);
  return {
    id: a.id, name: a.name, package_id: a.package_id, category: a.category, publisher: a.publisher, latest_version: a.latest_version,
    description: a.description, device_count: st?.device_count ?? 0, version_count: st?.versions.size ?? 0, latest_count: st?.latest ?? 0,
    update_available_count: st?.update ?? 0, failed_count: st?.failed ?? 0,
  };
}

function getApp(id: string): App {
  const app = store.s.apps.find((a) => a.id === Number(id));
  if (!app) fail(404, "Application not found");
  return app;
}

// ------------------------------------------------------------------ alerts / logs / audit filters
function filteredAlerts(ctx: Ctx, withDates = true): AlertRec[] {
  const q = ctx.q;
  const severity = qstr(q, "severity", { pattern: /^(INFO|WARNING|CRITICAL)$/ });
  const statuses = (qstr(q, "status") ?? "").split(",").map((s) => s.trim().toUpperCase()).filter(Boolean);
  const category = qstr(q, "category");
  const search = qstr(q, "search", { max: 64 });
  const from = withDates ? qdate(q, "date_from") : undefined;
  const to = withDates ? qdate(q, "date_to") : undefined;
  const rows = store.s.alerts.filter((a) => {
    if (severity && a.severity !== severity) return false;
    if (statuses.length && !statuses.includes(a.status)) return false;
    if (category && a.category !== category) return false;
    if (search) {
      const d = devByPk(a.pk);
      if (![d?.device_id, d?.serial_number, a.code].some((v) => contains(v, search))) return false;
    }
    if (from !== undefined && a.created_at < from) return false;
    if (to !== undefined && a.created_at > to) return false;
    return true;
  });
  return newestFirst(rows, (a) => a.created_at);
}

function getAlert(code: string): AlertRec {
  const a = store.s.alerts.find((x) => x.code === code);
  if (!a) fail(404, `Alert '${code}' not found`);
  return a;
}

function filteredLogs(ctx: Ctx): LogRec[] {
  const q = ctx.q;
  const deviceId = qstr(q, "device_id", { max: 64 });
  const serial = qstr(q, "serial_number", { max: 64 });
  const severities = (qstr(q, "severity", { max: 64 }) ?? "").split(",").map((s) => s.trim().toUpperCase()).filter(Boolean);
  const category = qstr(q, "category", { max: 32 });
  const search = qstr(q, "search", { max: 128 });
  const from = qdate(q, "date_from");
  const to = qdate(q, "date_to");
  const rows = store.s.logs.filter((l) => {
    if (severities.length && !severities.includes(l.sev)) return false;
    if (category && l.cat !== category.toUpperCase()) return false;
    if (search && !contains(l.msg, search)) return false;
    if (from !== undefined && l.at < from) return false;
    if (to !== undefined && l.at > to) return false;
    if (deviceId || serial) {
      const d = devByPk(l.pk);
      if (deviceId && !contains(d?.device_id, deviceId)) return false;
      if (serial && !contains(d?.serial_number, serial)) return false;
    }
    return true;
  });
  return newestFirst(rows, (l) => l.at);
}

function filteredAudit(ctx: Ctx): AuditRec[] {
  const q = ctx.q;
  const username = qstr(q, "username", { max: 64 });
  const actions = (qstr(q, "action", { max: 256 }) ?? "").split(",").map((s) => s.trim().toUpperCase()).filter(Boolean);
  const result = qstr(q, "result", { pattern: /^(SUCCESS|FAILURE|DENIED)$/ });
  const target = qstr(q, "target", { max: 64 });
  const from = qdate(q, "date_from");
  const to = qdate(q, "date_to");
  const rows = store.s.audit.filter((a) =>
    (!username || contains(a.username, username)) && (!actions.length || actions.includes(a.action)) &&
    (!result || a.result === result) && (!target || contains(a.target_id, target)) &&
    (from === undefined || a.created_at >= from) && (to === undefined || a.created_at <= to));
  return newestFirst(rows, (a) => a.created_at);
}

// ------------------------------------------------------------------ firmware
const ACTIVE_DEPLOYMENT = ["SCHEDULED", "IN_PROGRESS"];

function firmwareDict(id: number) {
  const fw = fwById(id);
  if (!fw) fail(404, "Firmware version not found");
  return {
    id: fw.id, version: fw.version, model: fw.model, os_version: fw.os_version, release_date: iso(fw.release_date), release_notes: fw.release_notes,
    file_size_mb: fw.file_size_mb, checksum_sha256: fw.checksum_sha256, status: fw.status, is_latest: fw.is_latest,
    device_count: store.s.devices.filter((d) => d.fw_id === fw.id).length,
  };
}

function getDeployment(code: string): Dep {
  const d = store.s.deployments.find((x) => x.code === code);
  if (!d) fail(404, `Deployment '${code}' not found`);
  return d;
}

function nextDeploymentCode(): string {
  let n = store.s.deployments.length + 1;
  for (;;) {
    const code = `DEP-${String(n).padStart(5, "0")}`;
    if (!store.s.deployments.some((d) => d.code === code)) return code;
    n += 1;
  }
}

function firmwareDistribution() {
  const counts = groupCount(store.s.devices, (d) => String(d.fw_id));
  return counts
    .map(([id, c]) => ({ fw: fwById(Number(id)), c }))
    .filter((x) => x.fw)
    .sort((a, b) => b.c - a.c)
    .map(({ fw, c }) => ({ version: fw?.version ?? "", model: fw?.model ?? "", is_latest: !!fw?.is_latest, count: c }));
}

// ------------------------------------------------------------------ analytics
function dateRange(ctx: Ctx) {
  const to = qdate(ctx.q, "date_to") ?? Date.now();
  const from = qdate(ctx.q, "date_from") ?? to - 30 * DAY;
  if (from >= to) fail(422, "date_from must be before date_to");
  if (to - from > 366 * DAY) fail(422, "Date range cannot exceed 366 days");
  return { from, to };
}

function byDay<T>(rows: T[], at: (r: T) => number) {
  const m = new Map<number, T[]>();
  for (const r of rows) {
    const k = dayStart(at(r));
    if (!m.has(k)) m.set(k, []);
    (m.get(k) as T[]).push(r);
  }
  return [...m.entries()].sort((a, b) => a[0] - b[0]);
}

function availability(r: { from: number; to: number }) {
  const snaps = store.s.snapshots.filter((s) => s[0] >= r.from && s[0] <= r.to);
  return byDay(snaps, (s) => s[0]).map(([day, rows]) => {
    const avg = (i: number) => rows.reduce((a, s) => a + s[i], 0) / rows.length;
    const total = avg(1);
    const online = avg(2);
    return {
      date: iso(day), online: Math.round(online), offline: Math.round(total - online), total: Math.round(total),
      warning: Math.round(avg(3)), critical: Math.round(avg(4)), availability_pct: total ? round2((100 * online) / total) : 0,
    };
  });
}

const registrations = (r: { from: number; to: number }) =>
  byDay(store.s.devices.filter((d) => d.registered_at >= r.from && d.registered_at <= r.to), (d) => d.registered_at)
    .map(([day, rows]) => ({ date: iso(day), registrations: rows.length }));

function modelsReport() {
  return groupCount(store.s.devices, (d) => d.model)
    .sort((a, b) => b[1] - a[1])
    .map(([model, count]) => {
      const ds = store.s.devices.filter((d) => d.model === model);
      return {
        model, devices: count, online: ds.filter((d) => d.st.connection_status === "ONLINE").length,
        avg_cpu: round1(ds.reduce((a, d) => a + d.st.cpu_usage, 0) / ds.length), avg_memory: round1(ds.reduce((a, d) => a + d.st.memory_usage, 0) / ds.length),
      };
    });
}

function uptimeReport() {
  const now = Date.now();
  const online = store.s.devices.filter((d) => d.st.connection_status === "ONLINE" && d.st.last_boot_at);
  const hours = (d: Device) => (now - (d.st.last_boot_at as number)) / HOUR;
  const bucket = (h: number) => (h < 24 ? "< 1 day" : h < 168 ? "1-7 days" : h < 720 ? "7-30 days" : "> 30 days");
  const dist = new Map(groupCount(online, (d) => bucket(hours(d))));
  const models = [...new Set(online.map((d) => d.model))].sort();
  return {
    distribution: ["< 1 day", "1-7 days", "7-30 days", "> 30 days"].map((b) => ({ bucket: b, devices: dist.get(b) ?? 0 })),
    by_model: models.map((m) => {
      const ds = online.filter((d) => d.model === m);
      return { model: m, avg_uptime_hours: round1(ds.reduce((a, d) => a + hours(d), 0) / ds.length) };
    }),
  };
}

function failures(r: { from: number; to: number }) {
  const evs = store.s.events.filter((e) => e.at >= r.from && e.at <= r.to);
  return byDay(evs, (e) => e.at).map(([day, rows]) => ({
    date: iso(day), app_crashes: rows.filter((e) => e.type === "APP_CRASH").length, critical_errors: rows.filter((e) => e.type === "CRITICAL_ERROR").length,
    disconnections: rows.filter((e) => e.type === "DISCONNECTED").length,
    operation_failures: rows.filter((e) => e.type === "COMMAND_FAILED" || e.type === "FIRMWARE_UPDATE_FAILED").length,
  }));
}

function applicationsReport() {
  const stats = appStats();
  return store.s.apps
    .map((a) => ({ a, s: stats.get(a.id) }))
    .filter((x) => (x.s?.device_count ?? 0) > 0)
    .sort((x, y) => (y.s?.usage ?? 0) - (x.s?.usage ?? 0))
    .map(({ a, s }) => ({ application: a.name, package_id: a.package_id, installations: s?.device_count ?? 0, usage_hours_7d: round1((s?.usage ?? 0) / 60), crashes_7d: s?.crashes ?? 0 }));
}

function activity(r: { from: number; to: number }) {
  return byDay(store.s.events.filter((e) => e.at >= r.from && e.at <= r.to), (e) => e.at).map(([day, rows]) => {
    const row: Record<string, number | string | null> = { date: iso(day), total: rows.length };
    for (const [t, c] of groupCount(rows, (e) => e.type)) row[t] = c;
    return row;
  });
}

// ------------------------------------------------------------------ users
const USER_SORT: Record<string, (u: DUser) => unknown> = {
  username: (u) => u.username, full_name: (u) => u.full_name, email: (u) => u.email, last_login_at: (u) => u.last_login_at, created_at: (u) => u.created_at,
};
const ROLES: RoleName[] = ["ADMIN", "SUPPORT_ENGINEER", "READ_ONLY"];

function getUser(id: string): DUser {
  const u = userById(Number(id));
  if (!u) fail(404, "User not found");
  return u;
}

function roleName(v: string): RoleName {
  if (!ROLES.includes(v as RoleName)) fail(422, `Unknown role '${v}'`);
  return v as RoleName;
}

function setActive(ctx: Ctx, active: boolean) {
  const admin = requirePerm(ctx, "users:manage");
  const user = getUser(ctx.params.id);
  if (user.id === admin.id) fail(409, "You cannot change the status of your own account");
  if (user.is_active !== active) {
    user.is_active = active;
    user.updated_at = Date.now();
    recordAudit({ user: admin, action: active ? "USER_ACTIVATED" : "USER_DEACTIVATED", target_type: "user", target_id: user.username });
    markDirty();
  }
  return serializeUser(user);
}

// ------------------------------------------------------------------ settings
const BOOL_KEYS = ["offline_alerts_enabled"];
const LIMITS: Record<string, [number, number]> = {
  cpu_alert_threshold: [50, 100], memory_alert_threshold: [50, 100], cpu_warning_threshold: [30, 100], memory_warning_threshold: [30, 100],
  storage_warning_threshold: [50, 100], temperature_critical_threshold: [50, 110], command_default_timeout_seconds: [10, 3600],
  deployment_target_timeout_seconds: [30, 86400], telemetry_raw_retention_hours: [1, 168],
};

function settingsList() {
  const values = settingsMap();
  return Object.entries(DEFAULT_SETTINGS).map(([key, [, description]]) => ({
    key, value: values[key], description, updated_at: iso(store.s.settings[key]?.updated_at ?? null),
    type: BOOL_KEYS.includes(key) ? "boolean" : "number", min: LIMITS[key]?.[0] ?? null, max: LIMITS[key]?.[1] ?? null,
  }));
}

// ------------------------------------------------------------------ route table
type Handler = (ctx: Ctx) => unknown;
const routes: { method: string; re: RegExp; keys: string[]; handler: Handler }[] = [];

function route(method: string, pattern: string, handler: Handler) {
  const keys: string[] = [];
  const re = new RegExp(`^${pattern.replace(/:(\w+)/g, (_m, k: string) => (keys.push(k), "([^/]+)"))}$`);
  routes.push({ method, re, keys, handler });
}

export async function dispatch(ctx: Ctx): Promise<Reply> {
  for (const r of routes) {
    if (r.method !== ctx.method) continue;
    const m = r.re.exec(ctx.path);
    if (!m) continue;
    r.keys.forEach((k, i) => (ctx.params[k] = decodeURIComponent(m[i + 1])));
    const result = await r.handler(ctx);
    return result instanceof Reply ? result : new Reply(200, result);
  }
  const known = routes.some((r) => r.re.test(ctx.path));
  return new Reply(known ? 405 : 404, { detail: known ? "Method Not Allowed" : "Not Found" });
}

// Auth
route("POST", "/auth/login", login);
route("POST", "/auth/logout", (ctx) => {
  const user = currentUser(ctx);
  recordAudit({ user, action: "LOGOUT", target_type: "session" });
  markDirty();
  return { message: "Logged out" };
});
route("GET", "/auth/me", (ctx) => currentUserPayload(currentUser(ctx)));
route("POST", "/auth/change-password", changePassword);

// Search
route("GET", "/search", (ctx) => {
  requirePerm(ctx, "devices:view");
  const q = qstr(ctx.q, "q", { required: true, min: 2, max: 64 }) as string;
  const limit = qint(ctx.q, "limit", 8, 1, 25);
  return sortRows(store.s.devices.filter((d) => matchDevice(d, { search: q })), (d) => d.device_id, "asc").slice(0, limit).map(serializeDevice);
});

// Dashboard
route("GET", "/dashboard/summary", (ctx) => {
  requirePerm(ctx, "dashboard:view");
  return { ...fleetCounts(), open_alerts: store.s.alerts.filter((a) => a.status !== "RESOLVED").length, generated_at: iso(Date.now()) };
});
route("GET", "/dashboard/charts", (ctx) => {
  requirePerm(ctx, "dashboard:view");
  const c = fleetCounts();
  const now = Date.now();
  const monthKey = (ms: number) => {
    const d = new Date(ms);
    return Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), 1);
  };
  const regs = groupCount(store.s.devices.filter((d) => d.registered_at >= now - 365 * DAY), (d) => String(monthKey(d.registered_at)))
    .sort((a, b) => Number(a[0]) - Number(b[0]))
    .map(([m, n]) => ({ timestamp: iso(Number(m)), value: n }));
  const fw = groupCount(store.s.devices, (d) => fwById(d.fw_id)?.version ?? "").sort((a, b) => b[1] - a[1]);
  const topFw = fw.slice(0, 8).map(([label, value]) => ({ label, value }));
  if (fw.length > 8) topFw.push({ label: "Other", value: fw.slice(8).reduce((a, [, n]) => a + n, 0) });
  const hourly = new Map<number, Record<string, number | string | null>>();
  for (const e of store.s.events) {
    if (e.at < now - DAY) continue;
    const h = Math.floor(e.at / HOUR) * HOUR;
    if (!hourly.has(h)) hourly.set(h, { timestamp: iso(h), INFO: 0, WARNING: 0, ERROR: 0, CRITICAL: 0 });
    const row = hourly.get(h) as Record<string, number>;
    row[e.sev] = (row[e.sev] ?? 0) + 1;
  }
  return {
    online_offline: [{ label: "Online", value: c.online_devices }, { label: "Offline", value: c.offline_devices }, { label: "Rebooting", value: c.rebooting_devices }],
    registration_trend: regs,
    firmware_distribution: topFw,
    model_distribution: groupCount(store.s.devices, (d) => d.model).sort((a, b) => b[1] - a[1]).map(([label, value]) => ({ label, value })),
    health_overview: [{ label: "Healthy", value: c.healthy_devices }, { label: "Warning", value: c.warning_devices }, { label: "Critical", value: c.critical_devices }],
    recent_events: [...hourly.entries()].sort((a, b) => a[0] - b[0]).map(([, row]) => row),
  };
});
route("GET", "/dashboard/activity", (ctx) => {
  requirePerm(ctx, "dashboard:view");
  const s = store.s;
  const recent = (key: "last_connected_at" | "last_disconnected_at") =>
    s.devices.filter((d) => d.st[key] !== null).sort((a, b) => (b.st[key] as number) - (a.st[key] as number)).slice(0, 6)
      .map((d) => ({ device_id: d.device_id, serial_number: d.serial_number, model: d.model, region: d.region, timestamp: iso(d.st[key]) }));
  const dist = groupCount(s.devices, (d) => `${d.st.connection_status}|${d.st.health_status}`);
  return {
    recent_alerts: newestFirst(s.alerts.filter((a) => a.status !== "RESOLVED"), (a) => a.created_at).slice(0, 6).map(serializeAlert),
    recently_connected: recent("last_connected_at"),
    recently_disconnected: recent("last_disconnected_at"),
    recent_admin_activity: newestFirst(s.audit.filter((a) => !["LOGIN", "LOGOUT", "LOGIN_FAILED"].includes(a.action)), (a) => a.created_at).slice(0, 8)
      .map((a) => ({ id: a.id, username: a.username, action: a.action, target_id: a.target_id, result: a.result, created_at: iso(a.created_at) })),
    recent_device_events: newestFirst([...s.events], (e) => e.at).slice(0, 10)
      .map((e) => ({ id: e.id, device_id: devByPk(e.pk)?.device_id ?? "", event_type: e.type, severity: e.sev, description: e.desc, created_at: iso(e.at) })),
    status_distribution: dist.map(([k, n]) => ({ connection_status: k.split("|")[0], health_status: k.split("|")[1], count: n })),
  };
});

// Devices
route("GET", "/devices", (ctx) => {
  requirePerm(ctx, "devices:view");
  return paginate(ctx, filteredDevices(ctx), serializeDevice);
});
route("GET", "/devices/export", (ctx) => {
  const user = requirePerm(ctx, "devices:view");
  const rows = filteredDevices(ctx);
  recordAudit({ user, action: "DEVICE_EXPORT", target_type: "device", details: { rows: rows.length, filters: ctx.q } });
  markDirty();
  return csv(`bell-stb-devices-${stamp()}.csv`,
    ["Device ID", "Serial Number", "MAC Address", "Model", "Hardware Version", "Firmware Version", "OS Version", "IP Address", "Connection Status", "Health", "Last Seen", "Customer Reference", "Region", "City", "Data Source"],
    rows.map((d) => [d.device_id, d.serial_number, d.mac_address, d.model, d.hardware_version, fwById(d.fw_id)?.version, d.os_version, d.ip_address,
      d.st.connection_status, d.st.health_status, iso(d.st.last_seen_at), d.customer_ref, d.region, d.city, "SIMULATED"]));
});
route("GET", "/devices/filters", (ctx) => {
  requirePerm(ctx, "devices:view");
  const uniq = (v: string[]) => [...new Set(v)].sort();
  return {
    models: uniq(store.s.devices.map((d) => d.model)),
    firmware_versions: uniq(store.s.devices.map((d) => fwById(d.fw_id)?.version ?? "")),
    regions: uniq(store.s.devices.map((d) => d.region)),
    statuses: ["ONLINE", "OFFLINE", "REBOOTING"],
    health_statuses: ["HEALTHY", "WARNING", "CRITICAL"],
  };
});
route("POST", "/devices", (ctx) => {
  const user = requirePerm(ctx, "devices:manage");
  const body = validateDeviceBody(ctx.body);
  const d = createDevice(body, `Device registered by ${user.username}`);
  recordAudit({ user, action: "DEVICE_REGISTERED", target_type: "device", target_id: d.device_id, details: { serial_number: d.serial_number, model: d.model, simulation_profile: d.profile } });
  markDirty();
  return new Reply(201, serializeDeviceDetail(d));
});
route("GET", "/devices/:id", (ctx) => {
  requirePerm(ctx, "devices:view");
  return serializeDeviceDetail(getDevice(ctx.params.id));
});
route("PATCH", "/devices/:id", (ctx) => {
  const user = requirePerm(ctx, "devices:manage");
  const d = getDevice(ctx.params.id);
  const changes: Record<string, string> = {};
  const fields: [keyof Device & string, StrOpts][] = [
    ["customer_ref", { min: 3, max: 32 }], ["region", { min: 2, max: 32 }], ["city", { min: 2, max: 64 }],
    ["profile", { pattern: /^(STANDARD|STABLE_ONLINE|STABLE_OFFLINE)$/ }],
  ];
  for (const [key, opts] of fields) {
    const name = key === "profile" ? "simulation_profile" : key;
    const v = bstr(ctx.body, name, opts);
    if (v !== undefined) changes[name] = v;
  }
  if (changes.customer_ref) d.customer_ref = changes.customer_ref;
  if (changes.region) d.region = changes.region;
  if (changes.city) d.city = changes.city;
  if (changes.simulation_profile) d.profile = changes.simulation_profile;
  recordAudit({ user, action: "DEVICE_UPDATED", target_type: "device", target_id: d.device_id, details: changes });
  markDirty();
  return serializeDeviceDetail(d);
});
route("DELETE", "/devices/:id", (ctx) => {
  const user = requirePerm(ctx, "devices:manage");
  const d = getDevice(ctx.params.id);
  const s = store.s;
  s.devices = s.devices.filter((x) => x.id !== d.id);
  s.events = s.events.filter((x) => x.pk !== d.id);
  s.logs = s.logs.filter((x) => x.pk !== d.id);
  s.alerts = s.alerts.filter((x) => x.pk !== d.id);
  s.commands = s.commands.filter((x) => x.pk !== d.id);
  s.targets = s.targets.filter((x) => x.pk !== d.id);
  invalidateDeviceIndex();
  recordAudit({ user, action: "DEVICE_DECOMMISSIONED", target_type: "device", target_id: d.device_id, details: { serial_number: d.serial_number } });
  markDirty();
  return { message: `Device ${d.device_id} decommissioned` };
});
route("GET", "/devices/:id/network", (ctx) => {
  requirePerm(ctx, "devices:view");
  const d = getDevice(ctx.params.id);
  const st = d.st;
  const history = newestFirst(store.s.events.filter((e) => e.pk === d.id && ["CONNECTED", "DISCONNECTED", "NETWORK_CHANGE"].includes(e.type)), (e) => e.at).slice(0, 50);
  return {
    device_id: d.device_id, ip_address: d.ip_address, mac_address: d.mac_address, connection_status: st.connection_status, network_type: st.network_type,
    signal_strength_dbm: st.signal_strength_dbm, bandwidth_mbps: st.bandwidth_mbps, latency_ms: st.latency_ms, packet_loss_pct: st.packet_loss_pct,
    last_connected_at: iso(st.last_connected_at), last_disconnected_at: iso(st.last_disconnected_at), connection_history: history.map(serializeEvent),
  };
});
route("GET", "/devices/:id/applications", (ctx) => {
  requirePerm(ctx, "devices:view");
  return installedApps(getDevice(ctx.params.id));
});
route("GET", "/devices/:id/software", (ctx) => {
  requirePerm(ctx, "devices:view");
  const d = getDevice(ctx.params.id);
  const fw = fwById(d.fw_id);
  const latest = latestFw(d.model);
  return {
    firmware_version: fw?.version ?? "", firmware_release_date: iso(fw?.release_date), os_version: d.os_version,
    latest_firmware_version: latest?.version ?? null, latest_os_version: latest?.os_version ?? null,
    update_available: !!latest && latest.id !== d.fw_id, applications: installedApps(d),
  };
});
route("GET", "/devices/:id/telemetry", (ctx) => {
  requirePerm(ctx, "devices:view");
  const d = getDevice(ctx.params.id);
  return generatedTelemetry(d, qint(ctx.q, "hours", 24, 1, 24 * 90));
});
route("GET", "/devices/:id/events", (ctx) => {
  requirePerm(ctx, "devices:view");
  const d = getDevice(ctx.params.id);
  const types = (qstr(ctx.q, "event_type") ?? "").split(",").map((t) => t.trim().toUpperCase()).filter(Boolean);
  const rows = newestFirst(store.s.events.filter((e) => e.pk === d.id && (!types.length || types.includes(e.type))), (e) => e.at);
  return paginate(ctx, rows, serializeEvent);
});
route("GET", "/devices/:id/logs", (ctx) => {
  requirePerm(ctx, "devices:view");
  const d = getDevice(ctx.params.id);
  const sev = qstr(ctx.q, "severity", { pattern: /^(INFO|WARNING|ERROR|CRITICAL)$/ });
  return paginate(ctx, newestFirst(store.s.logs.filter((l) => l.pk === d.id && (!sev || l.sev === sev)), (l) => l.at), serializeLog);
});
route("GET", "/devices/:id/commands", (ctx) => {
  requirePerm(ctx, "commands:view");
  const d = getDevice(ctx.params.id);
  return paginate(ctx, newestFirst(store.s.commands.filter((c) => c.pk === d.id), (c) => c.created_at), (c) => serializeCommand(c));
});
route("GET", "/devices/:id/alerts", (ctx) => {
  requirePerm(ctx, "alerts:view");
  const d = getDevice(ctx.params.id);
  return newestFirst(store.s.alerts.filter((a) => a.pk === d.id), (a) => a.created_at).slice(0, 50).map(serializeAlert);
});

// Commands
const APP_COMMANDS = ["RESTART_APP", "CLEAR_APP_CACHE"];
route("GET", "/commands/types", (ctx) => {
  requirePerm(ctx, "commands:view");
  return Object.entries(COMMAND_LABELS).map(([type, label]) => ({ type, label, requires_admin: type === "FACTORY_RESET", requires_application: APP_COMMANDS.includes(type) }));
});
route("POST", "/commands", (ctx) => {
  const user = requirePerm(ctx, "commands:execute");
  const b = ctx.body;
  const deviceId = bstr(b, "device_id", { required: true, min: 3, max: 32 }) as string;
  const type = bstr(b, "command_type", { required: true, pattern: /^(REBOOT|FACTORY_RESET|SYNC_CONFIG|REFRESH_INFO|RESTART_APP|CLEAR_APP_CACHE)$/ }) as string;
  const confirmation = bstr(b, "confirmation", { max: 64 });
  const rawTimeout = b.timeout_seconds;
  if (rawTimeout !== undefined && rawTimeout !== null && (typeof rawTimeout !== "number" || !Number.isInteger(rawTimeout) || rawTimeout < 10 || rawTimeout > 3600)) {
    bad("body", "timeout_seconds", "Input should be greater than or equal to 10 and less than or equal to 3600");
  }
  const params: Record<string, unknown> = typeof b.parameters === "object" && b.parameters !== null ? { ...(b.parameters as Body) } : {};
  const d = getDevice(deviceId);
  const action = `COMMAND_${type}`;
  if (type === "FACTORY_RESET") {
    if (!hasPermission(user.role, "commands:factory_reset")) {
      recordAudit({ user, action, result: "DENIED", target_type: "device", target_id: d.device_id, details: { reason: "factory reset requires administrator role" } });
      markDirty();
      fail(403, "Factory reset requires the ADMIN role");
    }
    if ((confirmation ?? "").trim().toUpperCase() !== d.serial_number.toUpperCase()) fail(422, "Factory reset requires confirmation with the device serial number");
  }
  if (APP_COMMANDS.includes(type)) {
    const pkg = String(params.package_id ?? "");
    const app = store.s.apps.find((a) => a.package_id === pkg);
    if (!app || !d.apps.some((ia) => ia.app_id === app.id)) fail(422, `Application '${pkg}' is not installed on ${d.device_id}`);
  } else {
    delete params.package_id;
  }
  const active = store.s.commands.find((c) => c.pk === d.id && c.type === type && !TERMINAL.includes(c.status));
  if (active) fail(409, `Command ${active.code} of the same type is already in progress for this device`);
  const timeout = typeof rawTimeout === "number" ? rawTimeout : Math.trunc(settingFloat("command_default_timeout_seconds"));
  const now = Date.now();
  let note = "Command created";
  if (d.st.connection_status !== "ONLINE") note += `; device is ${d.st.connection_status} - delivery will wait until it reconnects`;
  const cmd: Cmd = {
    id: nextId("commands"), code: newCode("CMD"), pk: d.id, type, status: "PENDING", params, result_message: null, requested_by: user.id,
    timeout_seconds: timeout, created_at: now, queued_at: null, sent_at: null, acknowledged_at: null, started_at: null, completed_at: null,
    expires_at: now + timeout * 1000, history: [{ status: "PENDING", message: note, created_at: now }],
  };
  store.s.commands.push(cmd);
  recordAudit({ user, action, target_type: "device", target_id: d.device_id, details: { command_code: cmd.code, parameters: params, timeout_seconds: timeout } });
  markDirty();
  return new Reply(201, serializeCommand(cmd, true));
});
route("GET", "/commands", (ctx) => {
  requirePerm(ctx, "commands:view");
  const q = ctx.q;
  const deviceId = qstr(q, "device_id", { max: 64 });
  const status = qstr(q, "status", { pattern: /^(PENDING|QUEUED|SENT|ACKNOWLEDGED|EXECUTING|SUCCESSFUL|FAILED|TIMED_OUT)$/ });
  const type = qstr(q, "command_type");
  const requestedBy = qstr(q, "requested_by");
  const rows = store.s.commands.filter((c) => {
    if (status && c.status !== status) return false;
    if (type && c.type !== type.toUpperCase()) return false;
    if (requestedBy && userById(c.requested_by)?.username !== requestedBy) return false;
    if (deviceId) {
      const d = devByPk(c.pk);
      if (!contains(d?.device_id, deviceId) && !contains(d?.serial_number, deviceId)) return false;
    }
    return true;
  });
  return paginate(ctx, newestFirst(rows, (c) => c.created_at), (c) => serializeCommand(c));
});
route("GET", "/commands/:code", (ctx) => {
  requirePerm(ctx, "commands:view");
  const c = store.s.commands.find((x) => x.code === ctx.params.code);
  if (!c) fail(404, `Command '${ctx.params.code}' not found`);
  return serializeCommand(c, true);
});

// Firmware
route("GET", "/firmware", (ctx) => {
  requirePerm(ctx, "firmware:view");
  const search = qstr(ctx.q, "search", { max: 64 });
  const model = qstr(ctx.q, "model");
  const status = qstr(ctx.q, "status", { pattern: /^(ACTIVE|BETA|DEPRECATED)$/ });
  const latestOnly = qbool(ctx.q, "latest_only") ?? false;
  return store.s.firmware
    .filter((f) => (!search || contains(f.version, search) || contains(f.model, search)) && (!model || f.model === model) && (!status || f.status === status) && (!latestOnly || f.is_latest))
    .sort((a, b) => compare(a.model, b.model) || b.release_date - a.release_date)
    .map((f) => firmwareDict(f.id));
});
route("POST", "/firmware", (ctx) => {
  const user = requirePerm(ctx, "firmware:manage");
  const b = ctx.body;
  const version = bstr(b, "version", { required: true, pattern: /^\d+\.\d+\.\d+(-[a-z0-9]+)?$/ }) as string;
  const model = bstr(b, "model", { required: true, min: 2, max: 64 }) as string;
  const osVersion = bstr(b, "os_version", { required: true, min: 2, max: 32 }) as string;
  const notes = bstr(b, "release_notes", { max: 4000 }) ?? "";
  const size = Number(b.file_size_mb);
  if (!(size > 0 && size <= 4096)) bad("body", "file_size_mb", "Input should be greater than 0 and less than or equal to 4096");
  const status = bstr(b, "status", { pattern: /^(ACTIVE|BETA|DEPRECATED)$/ }) ?? "ACTIVE";
  const markLatest = b.mark_latest === true;
  if (!store.s.firmware.some((f) => f.model === model)) fail(422, `Unknown device model '${model}'`);
  if (store.s.firmware.some((f) => f.model === model && f.version === version)) fail(409, `Firmware ${version} already exists for ${model}`);
  if (markLatest) store.s.firmware.forEach((f) => f.model === model && (f.is_latest = false));
  const fw = {
    id: nextId("firmware"), version, model, os_version: osVersion, release_date: Date.now(), release_notes: notes, file_size_mb: size, status, is_latest: markLatest,
    checksum_sha256: Array.from(crypto.getRandomValues(new Uint8Array(32)), (x) => x.toString(16).padStart(2, "0")).join(""),
  };
  store.s.firmware.push(fw);
  recordAudit({ user, action: "FIRMWARE_REGISTERED", target_type: "firmware", target_id: `${model} ${version}`, details: { mark_latest: markLatest } });
  markDirty();
  return new Reply(201, firmwareDict(fw.id));
});
route("GET", "/firmware/distribution", (ctx) => {
  requirePerm(ctx, "firmware:view");
  return firmwareDistribution().map(({ count, ...rest }) => ({ ...rest, device_count: count }));
});
route("GET", "/firmware/eligible-devices", (ctx) => {
  requirePerm(ctx, "firmware:view");
  const id = qint(ctx.q, "firmware_version_id", NaN, 1, Number.MAX_SAFE_INTEGER);
  if (Number.isNaN(id)) bad("query", "firmware_version_id", "Field required");
  const fw = fwById(id);
  if (!fw) fail(404, "Firmware version not found");
  const f: DeviceFilter = { search: qstr(ctx.q, "search", { max: 64 }), region: qstr(ctx.q, "region"), status: qstr(ctx.q, "status", { pattern: /^(ONLINE|OFFLINE)$/ }), model: fw.model };
  const rows = sortRows(store.s.devices.filter((d) => matchDevice(d, f) && d.fw_id !== fw.id), (d) => d.device_id, "asc");
  return paginate(ctx, rows, serializeDevice);
});
route("GET", "/firmware/deployments", (ctx) => {
  requirePerm(ctx, "firmware:view");
  const status = qstr(ctx.q, "status");
  const search = qstr(ctx.q, "search", { max: 64 });
  const rows = store.s.deployments.filter((d) => (!status || d.status === status.toUpperCase()) &&
    (!search || contains(d.code, search) || contains(d.name, search) || contains(fwById(d.fw_id)?.version, search)));
  return paginate(ctx, newestFirst(rows, (d) => d.created_at), serializeDeployment);
});
route("POST", "/firmware/deployments", (ctx) => {
  const user = requirePerm(ctx, "firmware:manage");
  const b = ctx.body;
  const name = bstr(b, "name", { required: true, min: 3, max: 128 }) as string;
  if (typeof b.firmware_version_id !== "number") bad("body", "firmware_version_id", "Input should be a valid integer");
  if (!Array.isArray(b.device_ids) || b.device_ids.length < 1) bad("body", "device_ids", "List should have at least 1 item after validation, not 0");
  if (b.device_ids.length > 1000) bad("body", "device_ids", "List should have at most 1000 items after validation");
  const policy = bstr(b, "offline_policy", { pattern: /^(WAIT|SKIP)$/ }) ?? "WAIT";
  const scheduledRaw = bstr(b, "scheduled_at");
  const scheduled = scheduledRaw ? Date.parse(scheduledRaw) : Date.now();
  if (Number.isNaN(scheduled)) bad("body", "scheduled_at", "Input should be a valid datetime");
  const fw = fwById(b.firmware_version_id as number);
  if (!fw) fail(404, "Firmware version not found");
  if (fw.status === "DEPRECATED") fail(422, "Deprecated firmware cannot be deployed");
  const ids = [...new Set((b.device_ids as unknown[]).map(String))];
  const devices = store.s.devices.filter((d) => ids.includes(d.device_id));
  const missing = ids.filter((i) => !devices.some((d) => d.device_id === i));
  if (missing.length) fail(422, `Unknown devices: ${missing.slice(0, 10).join(", ")}`);
  const wrong = devices.filter((d) => d.model !== fw.model).map((d) => d.device_id);
  if (wrong.length) fail(422, `Firmware ${fw.version} is not compatible with: ${wrong.slice(0, 10).join(", ")}`);
  const activeDeps = new Set(store.s.deployments.filter((d) => ACTIVE_DEPLOYMENT.includes(d.status)).map((d) => d.id));
  const busyIds = devices.filter((d) => store.s.targets.some((t) => t.pk === d.id && activeDeps.has(t.dep_id) && t.status !== "SUCCESS" && t.status !== "FAILED")).map((d) => d.device_id);
  if (busyIds.length) fail(409, `Devices already in an active deployment: ${busyIds.slice(0, 10).join(", ")}`);
  const now = Date.now();
  const dep: Dep = {
    id: nextId("deployments"), code: nextDeploymentCode(), name, fw_id: fw.id, status: "SCHEDULED", is_rollback: false, rollback_of: null,
    offline_policy: policy, scheduled_at: scheduled, started_at: null, completed_at: null, created_by: user.id, created_at: now,
  };
  store.s.deployments.push(dep);
  for (const d of devices) {
    store.s.targets.push({ id: nextId("targets"), dep_id: dep.id, pk: d.id, prev_fw_id: d.fw_id, target_fw_id: fw.id, status: "PENDING", error: null, updated_at: now });
  }
  recordAudit({ user, action: "FIRMWARE_DEPLOYMENT_CREATED", target_type: "deployment", target_id: dep.code,
    details: { firmware: fw.version, model: fw.model, targets: devices.length, scheduled_at: iso(scheduled), offline_policy: policy } });
  markDirty();
  return new Reply(201, serializeDeployment(dep));
});
route("GET", "/firmware/deployments/:code", (ctx) => {
  requirePerm(ctx, "firmware:view");
  return serializeDeployment(getDeployment(ctx.params.code));
});
route("GET", "/firmware/deployments/:code/targets", (ctx) => {
  requirePerm(ctx, "firmware:view");
  const dep = getDeployment(ctx.params.code);
  const status = qstr(ctx.q, "status");
  const rows = store.s.targets.filter((t) => t.dep_id === dep.id && (!status || t.status === status.toUpperCase())).sort((a, b) => a.id - b.id);
  return paginate(ctx, rows, (t: Target) => {
    const d = devByPk(t.pk);
    return {
      id: t.id, device_id: d?.device_id ?? "", serial_number: d?.serial_number ?? "", region: d?.region ?? "", connection_status: d?.st.connection_status ?? "UNKNOWN",
      previous_version: fwById(t.prev_fw_id)?.version ?? null, target_version: fwById(t.target_fw_id)?.version ?? "", status: t.status,
      error_message: t.error, updated_at: iso(t.updated_at),
    };
  });
});
route("POST", "/firmware/deployments/:code/cancel", (ctx) => {
  const user = requirePerm(ctx, "firmware:manage");
  const dep = getDeployment(ctx.params.code);
  if (!ACTIVE_DEPLOYMENT.includes(dep.status)) fail(409, `Deployment is ${dep.status} and cannot be cancelled`);
  const now = Date.now();
  for (const t of store.s.targets) if (t.dep_id === dep.id && t.status === "PENDING") Object.assign(t, { status: "FAILED", error: "Cancelled by administrator", updated_at: now });
  dep.status = "CANCELLED";
  dep.completed_at = now;
  recordAudit({ user, action: "FIRMWARE_DEPLOYMENT_CANCELLED", target_type: "deployment", target_id: dep.code });
  markDirty();
  return serializeDeployment(dep);
});
route("POST", "/firmware/deployments/:code/rollback", (ctx) => {
  const user = requirePerm(ctx, "firmware:manage");
  const original = getDeployment(ctx.params.code);
  if (!["COMPLETED", "COMPLETED_WITH_ERRORS", "CANCELLED"].includes(original.status)) fail(409, `Deployment is ${original.status}; only finished deployments can be rolled back`);
  const targets = store.s.targets.filter((t) => t.dep_id === original.id && t.status === "SUCCESS" && t.prev_fw_id !== null);
  if (!targets.length) fail(409, "No successfully updated devices to roll back");
  const prevCounts = groupCount(targets, (t) => String(t.prev_fw_id)).sort((a, b) => b[1] - a[1]);
  const now = Date.now();
  const rb: Dep = {
    id: nextId("deployments"), code: nextDeploymentCode(), name: `Rollback of ${original.code}`, fw_id: Number(prevCounts[0][0]), status: "SCHEDULED",
    is_rollback: true, rollback_of: original.id, offline_policy: "WAIT", scheduled_at: now, started_at: null, completed_at: null, created_by: user.id, created_at: now,
  };
  store.s.deployments.push(rb);
  for (const t of targets) {
    store.s.targets.push({ id: nextId("targets"), dep_id: rb.id, pk: t.pk, prev_fw_id: devByPk(t.pk)?.fw_id ?? null, target_fw_id: t.prev_fw_id as number, status: "PENDING", error: null, updated_at: now });
  }
  original.status = "ROLLED_BACK";
  recordAudit({ user, action: "FIRMWARE_ROLLBACK_CREATED", target_type: "deployment", target_id: rb.code, details: { rollback_of: original.code, targets: targets.length } });
  markDirty();
  return new Reply(201, serializeDeployment(rb));
});
route("GET", "/firmware/:id", (ctx) => {
  requirePerm(ctx, "firmware:view");
  return firmwareDict(Number(ctx.params.id));
});
route("POST", "/firmware/:id/deprecate", (ctx) => {
  const user = requirePerm(ctx, "firmware:manage");
  const fw = fwById(Number(ctx.params.id));
  if (!fw) fail(404, "Firmware version not found");
  if (fw.is_latest) fail(409, "The latest firmware for a model cannot be deprecated");
  fw.status = "DEPRECATED";
  recordAudit({ user, action: "FIRMWARE_DEPRECATED", target_type: "firmware", target_id: `${fw.model} ${fw.version}` });
  markDirty();
  return { message: `Firmware ${fw.version} deprecated` };
});

// Applications
route("GET", "/applications", (ctx) => {
  requirePerm(ctx, "applications:view");
  const search = qstr(ctx.q, "search", { max: 64 });
  const category = qstr(ctx.q, "category");
  const update = qbool(ctx.q, "update_available");
  const stats = appStats();
  return store.s.apps
    .filter((a) => (!search || contains(a.name, search) || contains(a.package_id, search)) && (!category || a.category === category))
    .sort((a, b) => a.name.localeCompare(b.name))
    .map((a) => appDict(a, stats))
    .filter((a) => update === undefined || a.update_available_count > 0 === update);
});
route("GET", "/applications/:id", (ctx) => {
  requirePerm(ctx, "applications:view");
  const app = getApp(ctx.params.id);
  const stats = appStats();
  const data = appDict(app, stats);
  const installs = store.s.devices.flatMap((d) => d.apps.filter((ia) => ia.app_id === app.id));
  const total = data.device_count || 1;
  return {
    ...data,
    versions: groupCount(installs, (ia) => ia.version).sort((a, b) => b[1] - a[1])
      .map(([version, c]) => ({ version, device_count: c, is_latest: version === app.latest_version, percentage: round1((100 * c) / total) })),
    statuses: groupCount(installs, (ia) => ia.status).map(([status, c]) => ({ status, device_count: c })),
    usage_minutes_7d: stats.get(app.id)?.usage ?? 0,
    crash_count_7d: stats.get(app.id)?.crashes ?? 0,
  };
});
route("GET", "/applications/:id/installations", (ctx) => {
  requirePerm(ctx, "applications:view");
  const app = getApp(ctx.params.id);
  const version = qstr(ctx.q, "version");
  const search = qstr(ctx.q, "search", { max: 64 });
  const rows = sortRows(store.s.devices.filter((d) => !search || contains(d.device_id, search) || contains(d.serial_number, search)), (d) => d.device_id, "asc")
    .flatMap((d) => d.apps.filter((ia) => ia.app_id === app.id && (!version || ia.version === version)).map((ia) => ({ d, ia })));
  return paginate(ctx, rows, ({ d, ia }) => ({
    device_id: d.device_id, serial_number: d.serial_number, model: d.model, region: d.region, version: ia.version, status: ia.status,
    installed_at: iso(ia.installed_at), last_used_at: iso(ia.last_used_at),
  }));
});

// Monitoring
route("GET", "/monitoring/overview", (ctx) => {
  requirePerm(ctx, "monitoring:view");
  const now = Date.now();
  const online = store.s.devices.filter((d) => d.st.connection_status === "ONLINE");
  const avg = (f: (d: Device) => number) => (online.length ? round1(online.reduce((a, d) => a + f(d), 0) / online.length) : 0);
  const total = store.s.devices.length;
  const net = groupCount(store.s.devices, (d) => `${d.st.network_type}|${d.st.connection_status}`);
  return {
    avg_cpu_usage: avg((d) => d.st.cpu_usage), avg_memory_usage: avg((d) => d.st.memory_usage), avg_storage_usage: avg((d) => d.st.storage_usage),
    avg_temperature_c: avg((d) => d.st.temperature_c ?? 0), avg_latency_ms: avg((d) => d.st.latency_ms),
    avg_uptime_seconds: Math.trunc(online.filter((d) => d.st.last_boot_at).reduce((a, d) => a + (now - (d.st.last_boot_at as number)) / 1000, 0) / Math.max(1, online.length)),
    online_devices: online.length, total_devices: total, connectivity_pct: total ? round1((100 * online.length) / total) : 0,
    network: net.map(([k, count]) => ({ network_type: k.split("|")[0], connection_status: k.split("|")[1], count })),
    app_crashes_24h: store.s.events.filter((e) => e.type === "APP_CRASH" && e.at >= now - DAY).length,
    device_errors_24h: store.s.logs.filter((l) => (l.sev === "ERROR" || l.sev === "CRITICAL") && l.at >= now - DAY).length,
    high_cpu_devices: online.filter((d) => d.st.cpu_usage >= settingFloat("cpu_warning_threshold")).length,
    high_memory_devices: online.filter((d) => d.st.memory_usage >= settingFloat("memory_warning_threshold")).length,
    generated_at: iso(now),
  };
});
route("GET", "/monitoring/health-history", (ctx) => {
  requirePerm(ctx, "monitoring:view");
  const hours = qint(ctx.q, "hours", 24, 1, 24 * 90);
  const now = Date.now();
  const buckets = new Map<number, { n: number; cpu: number; mem: number; sto: number; temp: number; lat: number }>();
  for (const d of store.s.devices) {
    for (const p of hourlyPoints(d, now - hours * HOUR, now)) {
      const t = Date.parse(p.timestamp as string);
      const b = buckets.get(t) ?? { n: 0, cpu: 0, mem: 0, sto: 0, temp: 0, lat: 0 };
      b.n += 1;
      b.cpu += p.cpu_usage;
      b.mem += p.memory_usage;
      b.sto += p.storage_usage;
      b.temp += p.temperature_c;
      b.lat += p.latency_ms;
      buckets.set(t, b);
    }
  }
  const online = store.s.devices.filter((d) => d.st.connection_status === "ONLINE");
  if (online.length) {
    const sum = (f: (d: Device) => number) => online.reduce((a, d) => a + f(d), 0);
    buckets.set(Math.floor(now / HOUR) * HOUR, {
      n: online.length, cpu: sum((d) => d.st.cpu_usage), mem: sum((d) => d.st.memory_usage), sto: sum((d) => d.st.storage_usage),
      temp: sum((d) => d.st.temperature_c ?? 0), lat: sum((d) => d.st.latency_ms),
    });
  }
  return [...buckets.entries()].sort((a, b) => a[0] - b[0]).map(([t, b]) => ({
    timestamp: iso(t), cpu_usage: round1(b.cpu / b.n), memory_usage: round1(b.mem / b.n), storage_usage: round1(b.sto / b.n),
    temperature_c: round1(b.temp / b.n), latency_ms: round1(b.lat / b.n), reporting_devices: b.n,
  }));
});
route("GET", "/monitoring/top-devices", (ctx) => {
  requirePerm(ctx, "monitoring:view");
  const metric = (qstr(ctx.q, "metric", { pattern: /^(cpu_usage|memory_usage|storage_usage|temperature_c|latency_ms)$/ }) ?? "cpu_usage") as
    "cpu_usage" | "memory_usage" | "storage_usage" | "temperature_c" | "latency_ms";
  const limit = qint(ctx.q, "limit", 10, 1, 50);
  return store.s.devices
    .filter((d) => d.st.connection_status === "ONLINE" && d.st[metric] !== null)
    .sort((a, b) => (b.st[metric] as number) - (a.st[metric] as number))
    .slice(0, limit)
    .map((d) => ({ device_id: d.device_id, serial_number: d.serial_number, model: d.model, region: d.region, value: d.st[metric], health_status: d.st.health_status }));
});
route("GET", "/monitoring/logs", (ctx) => {
  requirePerm(ctx, "monitoring:view");
  return paginate(ctx, filteredLogs(ctx), serializeLog);
});
route("GET", "/monitoring/logs/export", (ctx) => {
  requirePerm(ctx, "monitoring:view");
  return csv("bell-stb-diagnostic-logs.csv", ["Timestamp", "Device ID", "Serial Number", "Severity", "Category", "Component", "Message"],
    filteredLogs(ctx).slice(0, 20000).map((l) => {
      const d = devByPk(l.pk);
      return [iso(l.at), d?.device_id, d?.serial_number, l.sev, l.cat, l.comp, l.msg];
    }));
});
route("GET", "/monitoring/log-categories", (ctx) => {
  requirePerm(ctx, "monitoring:view");
  return ["SYSTEM", "NETWORK", "APPLICATION", "FIRMWARE", "HARDWARE", "SECURITY"];
});
route("GET", "/monitoring/devices/:id/diagnostics", (ctx) => {
  requirePerm(ctx, "monitoring:view");
  const d = getDevice(ctx.params.id);
  const detail = serializeDeviceDetail(d);
  const st = d.st;
  const online = st.connection_status === "ONLINE";
  const check = (name: string, ok: boolean, warn: boolean, value: string, hint: string) => ({ check: name, result: ok ? "PASS" : warn ? "WARN" : "FAIL", value, detail: hint });
  const cpuWarn = settingFloat("cpu_warning_threshold");
  const memWarn = settingFloat("memory_warning_threshold");
  const temp = st.temperature_c ?? 0;
  const now = Date.now();
  return {
    device: detail,
    checks: [
      check("Connectivity", online, st.connection_status === "REBOOTING", st.connection_status, online ? "Device heartbeat received" : "No heartbeat from device"),
      check("CPU utilisation", st.cpu_usage < cpuWarn, st.cpu_usage < 95, `${st.cpu_usage.toFixed(1)}%`, `Warning threshold ${cpuWarn.toFixed(0)}%`),
      check("Memory utilisation", st.memory_usage < memWarn, st.memory_usage < 95, `${st.memory_usage.toFixed(1)}%`, `Warning threshold ${memWarn.toFixed(0)}%`),
      check("Storage utilisation", st.storage_usage < settingFloat("storage_warning_threshold"), st.storage_usage < 97, `${st.storage_usage.toFixed(1)}%`, "Free space for recordings and app cache"),
      check("Temperature", temp < 70, temp < settingFloat("temperature_critical_threshold"), `${temp.toFixed(1)} C`, "SoC temperature sensor"),
      check("Network latency", st.latency_ms < 60, st.latency_ms < 150, `${st.latency_ms.toFixed(0)} ms`, "Round trip to headend"),
      check("Packet loss", st.packet_loss_pct < 1, st.packet_loss_pct < 5, `${st.packet_loss_pct.toFixed(1)}%`, "Last heartbeat window"),
      check("Firmware", !detail.update_available, true, fwById(d.fw_id)?.version ?? "", !detail.update_available ? "Up to date" : `Update ${detail.latest_firmware_version} available`),
    ],
    app_crashes_24h: store.s.events.filter((e) => e.pk === d.id && e.type === "APP_CRASH" && e.at >= now - DAY).length,
    recent_errors: newestFirst(store.s.logs.filter((l) => l.pk === d.id && (l.sev === "ERROR" || l.sev === "CRITICAL")), (l) => l.at).slice(0, 10)
      .map((l) => ({ id: l.id, severity: l.sev, category: l.cat, component: l.comp, message: l.msg, created_at: iso(l.at) })),
  };
});

// Alerts
const ALERT_CATEGORIES = ["DEVICE_OFFLINE", "HIGH_CPU", "HIGH_MEMORY", "FIRMWARE_UPDATE", "APP_CRASH", "NETWORK_DISCONNECT", "CRITICAL_ERROR"];
route("GET", "/alerts", (ctx) => {
  requirePerm(ctx, "alerts:view");
  return paginate(ctx, filteredAlerts(ctx), serializeAlert);
});
route("GET", "/alerts/summary", (ctx) => {
  requirePerm(ctx, "alerts:view");
  const a = store.s.alerts;
  const active = a.filter((x) => x.status !== "RESOLVED");
  return {
    open: a.filter((x) => x.status === "OPEN").length, acknowledged: a.filter((x) => x.status === "ACKNOWLEDGED").length,
    resolved: a.filter((x) => x.status === "RESOLVED").length, critical_active: active.filter((x) => x.severity === "CRITICAL").length,
    warning_active: active.filter((x) => x.severity === "WARNING").length, info_active: active.filter((x) => x.severity === "INFO").length,
    by_category: ALERT_CATEGORIES.map((c) => ({ category: c, count: active.filter((x) => x.category === c).length })),
  };
});
route("GET", "/alerts/export", (ctx) => {
  requirePerm(ctx, "alerts:view");
  return csv("bell-stb-alerts.csv", ["Alert ID", "Device ID", "Serial Number", "Category", "Severity", "Title", "Status", "Created", "Resolved"],
    filteredAlerts(ctx, false).slice(0, 10000).map((a) => {
      const d = devByPk(a.pk);
      return [a.code, d?.device_id, d?.serial_number, a.category, a.severity, a.title, a.status, iso(a.created_at), iso(a.res_at)];
    }));
});
route("GET", "/alerts/:code", (ctx) => {
  requirePerm(ctx, "alerts:view");
  return serializeAlert(getAlert(ctx.params.code));
});
route("POST", "/alerts/:code/acknowledge", (ctx) => {
  const user = requirePerm(ctx, "alerts:manage");
  const a = getAlert(ctx.params.code);
  if (a.status !== "OPEN") fail(409, `Alert is ${a.status} and cannot be acknowledged`);
  a.status = "ACKNOWLEDGED";
  a.ack_at = Date.now();
  a.ack_by = user.id;
  recordAudit({ user, action: "ALERT_ACKNOWLEDGED", target_type: "alert", target_id: a.code, details: { device_id: devByPk(a.pk)?.device_id, category: a.category } });
  markDirty();
  return serializeAlert(a);
});
route("POST", "/alerts/:code/resolve", (ctx) => {
  const user = requirePerm(ctx, "alerts:manage");
  const a = getAlert(ctx.params.code);
  if (a.status === "RESOLVED") fail(409, "Alert is already resolved");
  const note = bstr(ctx.body, "note", { max: 1000 });
  const now = Date.now();
  if (a.status === "OPEN") {
    a.ack_at = now;
    a.ack_by = user.id;
  }
  a.status = "RESOLVED";
  a.res_at = now;
  a.res_by = user.id;
  a.note = note || null;
  recordAudit({ user, action: "ALERT_RESOLVED", target_type: "alert", target_id: a.code, details: { device_id: devByPk(a.pk)?.device_id, note: a.note } });
  markDirty();
  return serializeAlert(a);
});

// Analytics
route("GET", "/analytics/report", (ctx) => {
  requirePerm(ctx, "analytics:view");
  const r = dateRange(ctx);
  const avail = availability(r);
  const cmds = store.s.commands.filter((c) => c.created_at >= r.from && c.created_at <= r.to);
  const fails = failures(r);
  const regs = registrations(r);
  return {
    date_from: iso(r.from), date_to: iso(r.to),
    summary: {
      total_devices: store.s.devices.length, new_registrations: regs.reduce((a, x) => a + x.registrations, 0),
      avg_availability_pct: avail.length ? round2(avail.reduce((a, x) => a + x.availability_pct, 0) / avail.length) : 0,
      failure_events: fails.reduce((a, f) => a + f.app_crashes + f.critical_errors + f.operation_failures, 0),
      commands_executed: cmds.length,
      command_success_pct: cmds.length ? round1((100 * cmds.filter((c) => c.status === "SUCCESSFUL").length) / cmds.length) : 0,
    },
    availability: avail, registrations: regs,
    firmware: firmwareDistribution().map(({ count, ...rest }) => ({ ...rest, devices: count })),
    models: modelsReport(), uptime: uptimeReport(), failures: fails, applications: applicationsReport(), activity: activity(r),
  };
});
route("GET", "/analytics/export", (ctx) => {
  const user = requirePerm(ctx, "analytics:view");
  const report = qstr(ctx.q, "report", { required: true, pattern: /^(availability|registrations|firmware|models|uptime|failures|applications|activity)$/ }) as string;
  const r = dateRange(ctx);
  const data: Record<string, unknown>[] = {
    availability: () => availability(r), registrations: () => registrations(r),
    firmware: () => firmwareDistribution().map(({ count, ...rest }) => ({ ...rest, devices: count })), models: modelsReport,
    uptime: () => uptimeReport().by_model, failures: () => failures(r), applications: applicationsReport, activity: () => activity(r),
  }[report]!();
  const first = ["date", "model", "version", "application"];
  const headers = [...new Set(data.flatMap((row) => Object.keys(row)))].sort((a, b) => Number(!first.includes(a)) - Number(!first.includes(b)) || compare(a, b));
  recordAudit({ user, action: "REPORT_EXPORTED", target_type: "report", target_id: report, details: { rows: data.length, date_from: iso(r.from), date_to: iso(r.to) } });
  markDirty();
  return csv(`bell-stb-${report}-report.csv`, headers, data.map((row) => headers.map((h) => row[h] ?? 0)));
});

// Users
route("GET", "/users/roles", (ctx) => {
  requirePerm(ctx, "users:manage");
  return ROLES.map((name, i) => ({ id: i + 1, name, description: ROLE_DESCRIPTIONS[name], permissions: ROLE_PERMISSIONS[name] }));
});
route("GET", "/users", (ctx) => {
  requirePerm(ctx, "users:manage");
  const q = ctx.q;
  const sortBy = qstr(q, "sort_by");
  if (sortBy && !USER_SORT[sortBy]) fail(422, `Invalid sort field '${sortBy}'. Allowed: ${Object.keys(USER_SORT).sort().join(", ")}`);
  const dir = qstr(q, "sort_dir", { pattern: /^(asc|desc)$/ }) ?? "asc";
  const search = qstr(q, "search", { max: 64 });
  const role = qstr(q, "role");
  const active = qbool(q, "is_active");
  const rows = store.s.users.filter((u) => (!search || contains(u.username, search) || contains(u.full_name, search) || contains(u.email, search)) &&
    (!role || u.role === role) && (active === undefined || u.is_active === active));
  return paginate(ctx, sortRows(rows, USER_SORT[sortBy ?? "username"], dir), serializeUser);
});
route("POST", "/users", async (ctx) => {
  const admin = requirePerm(ctx, "users:manage");
  const b = ctx.body;
  const usernameRaw = bstr(b, "username", { required: true, max: 64 }) as string;
  if (!/^[a-zA-Z0-9._-]{3,64}$/.test(usernameRaw)) bad("body", "username", "Value error, Username must be 3-64 characters: letters, digits, '.', '_' or '-'");
  const mail = email("email", b.email).toLowerCase();
  const fullName = bstr(b, "full_name", { required: true, min: 2, max: 128 }) as string;
  const roleRaw = bstr(b, "role", { required: true }) as string;
  const password = bstr(b, "password", { required: true, max: 128 }) as string;
  passwordStrength("password", password);
  const username = usernameRaw.toLowerCase();
  const role = roleName(roleRaw);
  if (store.s.users.some((u) => u.username.toLowerCase() === username || u.email.toLowerCase() === mail)) fail(409, "A user with this username or email already exists");
  const now = Date.now();
  const user: DUser = {
    id: nextId("users"), username, email: mail, full_name: fullName, role, is_active: b.is_active !== false, password_hash: await hashPassword(password),
    last_login_at: null, created_at: now, updated_at: now,
  };
  store.s.users.push(user);
  recordAudit({ user: admin, action: "USER_CREATED", target_type: "user", target_id: user.username, details: { role, email: mail } });
  markDirty();
  return new Reply(201, serializeUser(user));
});
route("GET", "/users/:id", (ctx) => {
  requirePerm(ctx, "users:manage");
  return serializeUser(getUser(ctx.params.id));
});
route("PATCH", "/users/:id", async (ctx) => {
  const admin = requirePerm(ctx, "users:manage");
  const user = getUser(ctx.params.id);
  const b = ctx.body;
  const mail = b.email !== undefined && b.email !== null ? email("email", b.email) : undefined;
  const fullName = bstr(b, "full_name", { min: 2, max: 128 });
  const role = bstr(b, "role");
  const isActive = typeof b.is_active === "boolean" ? b.is_active : undefined;
  const password = bstr(b, "password", { max: 128 });
  if (password) passwordStrength("password", password);
  if (user.id === admin.id && (isActive === false || (role !== undefined && role !== user.role))) fail(409, "You cannot deactivate or change the role of your own account");
  const details: Record<string, unknown> = {};
  if (mail !== undefined && mail.toLowerCase() !== user.email) {
    if (store.s.users.some((u) => u.id !== user.id && u.email.toLowerCase() === mail.toLowerCase())) fail(409, "Email already in use");
    details.email = { from: user.email, to: mail.toLowerCase() };
    user.email = mail.toLowerCase();
  }
  if (fullName !== undefined && fullName !== user.full_name) {
    details.full_name = { from: user.full_name, to: fullName };
    user.full_name = fullName;
  }
  if (role !== undefined && role !== user.role) {
    const r = roleName(role);
    details.role = { from: user.role, to: r };
    user.role = r;
  }
  if (isActive !== undefined && isActive !== user.is_active) {
    details.is_active = { from: user.is_active, to: isActive };
    user.is_active = isActive;
  }
  if (password) {
    user.password_hash = await hashPassword(password);
    details.password = "reset";
  }
  if (Object.keys(details).length) {
    user.updated_at = Date.now();
    const action = Object.keys(details).length === 1 && details.role ? "USER_ROLE_CHANGED" : "USER_UPDATED";
    recordAudit({ user: admin, action, target_type: "user", target_id: user.username, details });
    markDirty();
  }
  return serializeUser(user);
});
route("POST", "/users/:id/activate", (ctx) => setActive(ctx, true));
route("POST", "/users/:id/deactivate", (ctx) => setActive(ctx, false));
route("GET", "/users/:id/login-history", (ctx) => {
  requirePerm(ctx, "users:manage");
  const user = getUser(ctx.params.id);
  const rows = store.s.audit.filter((a) => (a.user_id === user.id || a.username === user.username) && ["LOGIN", "LOGOUT", "LOGIN_FAILED"].includes(a.action));
  return paginate(ctx, newestFirst(rows, (a) => a.created_at), serializeAudit);
});
route("GET", "/users/:id/activity", (ctx) => {
  requirePerm(ctx, "users:manage");
  const user = getUser(ctx.params.id);
  const rows = store.s.audit.filter((a) => a.user_id === user.id && !["LOGIN", "LOGOUT", "LOGIN_FAILED"].includes(a.action));
  return paginate(ctx, newestFirst(rows, (a) => a.created_at), serializeAudit);
});

// Audit logs
route("GET", "/audit-logs", (ctx) => {
  requirePerm(ctx, "audit:view");
  return paginate(ctx, filteredAudit(ctx), serializeAudit);
});
route("GET", "/audit-logs/actions", (ctx) => {
  requirePerm(ctx, "audit:view");
  return [...new Set(store.s.audit.map((a) => a.action))].sort();
});
route("GET", "/audit-logs/export", (ctx) => {
  requirePerm(ctx, "audit:view");
  return csv("bell-stb-audit-log.csv", ["Event ID", "Timestamp", "Username", "Action", "Target Type", "Target", "Result", "IP Address"],
    filteredAudit(ctx).slice(0, 50000).map((a) => [a.id, iso(a.created_at), a.username, a.action, a.target_type, a.target_id, a.result, a.ip_address]));
});
route("GET", "/audit-logs/:id", (ctx) => {
  requirePerm(ctx, "audit:view");
  const a = store.s.audit.find((x) => x.id === Number(ctx.params.id));
  if (!a) fail(404, "Audit event not found");
  return serializeAudit(a);
});
for (const method of ["PUT", "PATCH", "DELETE"]) route(method, "/audit-logs/:id", () => new Reply(405, { detail: "Method Not Allowed" }));

// Settings & simulator
route("GET", "/settings", (ctx) => {
  currentUser(ctx);
  return settingsList();
});
route("PUT", "/settings", (ctx) => {
  const user = requirePerm(ctx, "settings:manage");
  const values = (ctx.body.values ?? {}) as Record<string, unknown>;
  const current = settingsMap();
  const changes: Record<string, unknown> = {};
  const updates: Record<string, string> = {};
  for (const [key, raw] of Object.entries(values)) {
    if (!(key in DEFAULT_SETTINGS)) fail(422, `Unknown setting '${key}'`);
    const isBool = BOOL_KEYS.includes(key);
    const value = isBool ? String(raw).trim().toLowerCase() : String(raw).trim();
    if (isBool) {
      if (value !== "true" && value !== "false") fail(422, `'${key}' must be true or false`);
    } else {
      const num = Number(value);
      if (value === "" || Number.isNaN(num)) fail(422, `'${key}' must be numeric`);
      const [lo, hi] = LIMITS[key];
      if (num < lo || num > hi) fail(422, `'${key}' must be between ${lo} and ${hi}`);
    }
    if (current[key] !== value) {
      changes[key] = { from: current[key], to: value };
      updates[key] = value;
    }
  }
  for (const [key, value] of Object.entries(updates)) store.s.settings[key] = { value, updated_at: Date.now() };
  if (Object.keys(changes).length) {
    recordAudit({ user, action: "CONFIGURATION_CHANGED", target_type: "settings", target_id: "system", details: changes });
    markDirty();
  }
  return settingsList();
});
route("GET", "/simulator/status", (ctx) => {
  requirePerm(ctx, "dashboard:view");
  return simulatorStatus();
});
route("POST", "/simulator/:action", (ctx) => {
  const user = requirePerm(ctx, "settings:manage");
  const action = ctx.params.action;
  if (!["start", "stop", "reset"].includes(action)) fail(404, "Unknown simulator action");
  const result = simulatorAction(action);
  recordAudit({ user, action: `SIMULATOR_${action.toUpperCase()}`, target_type: "simulator", target_id: "stb-simulator" });
  return result;
});
