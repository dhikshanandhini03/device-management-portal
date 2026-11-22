import { Rng } from "./rng";

export type RoleName = "ADMIN" | "SUPPORT_ENGINEER" | "READ_ONLY";

export interface DUser {
  id: number;
  username: string;
  email: string;
  full_name: string;
  role: RoleName;
  is_active: boolean;
  password_hash: string;
  last_login_at: number | null;
  created_at: number;
  updated_at: number;
}

export interface Firmware {
  id: number;
  version: string;
  model: string;
  os_version: string;
  release_date: number;
  release_notes: string;
  file_size_mb: number;
  checksum_sha256: string;
  status: string;
  is_latest: boolean;
}

export interface App {
  id: number;
  name: string;
  package_id: string;
  category: string;
  publisher: string;
  latest_version: string;
  description: string;
}

export interface Installed {
  app_id: number;
  version: string;
  status: string;
  installed_at: number;
  last_used_at: number | null;
  usage: number;
  crashes: number;
}

export interface Status {
  connection_status: string;
  health_status: string;
  last_seen_at: number | null;
  last_boot_at: number | null;
  last_connected_at: number | null;
  last_disconnected_at: number | null;
  cpu_usage: number;
  memory_usage: number;
  storage_usage: number;
  temperature_c: number | null;
  network_type: string;
  signal_strength_dbm: number | null;
  bandwidth_mbps: number;
  latency_ms: number;
  packet_loss_pct: number;
}

export interface Device {
  id: number;
  device_id: string;
  serial_number: string;
  mac_address: string;
  model: string;
  hardware_version: string;
  fw_id: number;
  os_version: string;
  ip_address: string;
  customer_ref: string;
  region: string;
  city: string;
  profile: string;
  registered_at: number;
  st: Status;
  apps: Installed[];
  sim: { base_cpu: number; base_mem: number; spike: number; busy_until: number; reboot?: { factory: boolean; fail: boolean } };
}

export interface Ev {
  id: number;
  pk: number;
  type: string;
  sev: string;
  desc: string;
  at: number;
}

export interface LogRec {
  id: number;
  pk: number;
  sev: string;
  cat: string;
  comp: string;
  msg: string;
  at: number;
}

export interface AlertRec {
  id: number;
  code: string;
  pk: number;
  category: string;
  severity: string;
  title: string;
  description: string;
  status: string;
  created_at: number;
  ack_at: number | null;
  ack_by: number | null;
  res_at: number | null;
  res_by: number | null;
  note: string | null;
}

export interface CmdHistory {
  status: string;
  message: string | null;
  created_at: number;
}

export interface Cmd {
  id: number;
  code: string;
  pk: number;
  type: string;
  status: string;
  params: Record<string, unknown>;
  result_message: string | null;
  requested_by: number | null;
  timeout_seconds: number;
  created_at: number;
  queued_at: number | null;
  sent_at: number | null;
  acknowledged_at: number | null;
  started_at: number | null;
  completed_at: number | null;
  expires_at: number;
  history: CmdHistory[];
  next_at?: number;
  fail?: boolean;
}

export interface Dep {
  id: number;
  code: string;
  name: string;
  fw_id: number;
  status: string;
  is_rollback: boolean;
  rollback_of: number | null;
  offline_policy: string;
  scheduled_at: number;
  started_at: number | null;
  completed_at: number | null;
  created_by: number | null;
  created_at: number;
}

export interface Target {
  id: number;
  dep_id: number;
  pk: number;
  prev_fw_id: number | null;
  target_fw_id: number;
  status: string;
  error: string | null;
  updated_at: number;
  next_at?: number;
  rebooting?: boolean;
}

export interface AuditRec {
  id: number;
  user_id: number | null;
  username: string;
  action: string;
  target_type: string | null;
  target_id: string | null;
  details: Record<string, unknown>;
  result: string;
  ip_address: string | null;
  created_at: number;
}

export interface SimState {
  running: boolean;
  tick: number;
  started_at: number | null;
  last_registration: number;
  stats: Record<string, number>;
}

export interface State {
  version: number;
  seeded_at: number;
  seq: Record<string, number>;
  users: DUser[];
  firmware: Firmware[];
  apps: App[];
  devices: Device[];
  events: Ev[];
  logs: LogRec[];
  alerts: AlertRec[];
  commands: Cmd[];
  deployments: Dep[];
  targets: Target[];
  audit: AuditRec[];
  /** Hourly fleet snapshots: [timestamp, total, online, warning, critical]. */
  snapshots: number[][];
  settings: Record<string, { value: string; updated_at: number | null }>;
  sim: SimState;
}

const STATE_VERSION = 1;
const STORAGE_KEY = "bellstb.demo.state";
export const MIN = 60_000;
export const HOUR = 60 * MIN;
export const DAY = 24 * HOUR;

export const store = { s: {} as State };

export function nextId(table: string): number {
  const s = store.s;
  s.seq[table] = (s.seq[table] ?? 0) + 1;
  return s.seq[table];
}

export const DEFAULT_SETTINGS: Record<string, [string, string]> = {
  cpu_alert_threshold: ["90", "CPU utilisation (%) that raises a High CPU Usage alert"],
  memory_alert_threshold: ["90", "Memory utilisation (%) that raises a High Memory Usage alert"],
  cpu_warning_threshold: ["80", "CPU utilisation (%) that marks device health as WARNING"],
  memory_warning_threshold: ["80", "Memory utilisation (%) that marks device health as WARNING"],
  storage_warning_threshold: ["90", "Storage utilisation (%) that marks device health as WARNING"],
  temperature_critical_threshold: ["80", "Temperature (C) that marks device health as CRITICAL"],
  offline_alerts_enabled: ["true", "Raise Device Offline alerts when devices disconnect"],
  command_default_timeout_seconds: ["120", "Default remote command timeout"],
  deployment_target_timeout_seconds: ["600", "Time an offline device may stay pending in a WAIT deployment"],
  telemetry_raw_retention_hours: ["24", "Retention of raw telemetry before hourly roll-up only"],
};

// ------------------------------------------------------------------ persistence
let saveTimer: number | undefined;
let dirty = false;

export function markDirty(): void {
  dirty = true;
  if (saveTimer === undefined) saveTimer = window.setTimeout(saveNow, 700);
}

export function saveNow(): void {
  if (saveTimer !== undefined) window.clearTimeout(saveTimer);
  saveTimer = undefined;
  if (!dirty) return;
  dirty = false;
  const s = store.s;
  for (let attempt = 0; attempt < 4; attempt++) {
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(s));
      return;
    } catch {
      // Quota exceeded: drop the oldest history and retry.
      s.events.splice(0, Math.floor(s.events.length / 3));
      s.logs.splice(0, Math.floor(s.logs.length / 3));
      s.audit.splice(0, Math.floor(s.audit.length / 4));
    }
  }
}

export function loadState(): State | null {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as State;
    return parsed.version === STATE_VERSION ? parsed : null;
  } catch {
    return null;
  }
}

export function clearState(): void {
  localStorage.removeItem(STORAGE_KEY);
}

export async function hashPassword(password: string): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(`bellstb-demo:${password}`));
  return Array.from(new Uint8Array(digest), (b) => b.toString(16).padStart(2, "0")).join("");
}

// ------------------------------------------------------------------ seed data (port of backend/app/seed.py)
const MODELS: [string, string, string[], string, string[], boolean][] = [
  ["VIP2262", "CS2262", ["1.0", "1.2"], "MediaroomOS", ["3.8.12", "3.9.4", "3.10.2", "3.11.0"], false],
  ["VIP5662W", "AR5662", ["2.0", "2.1", "2.3"], "MediaroomOS", ["4.2.7", "4.3.1", "4.4.0", "4.5.2"], false],
  ["VIP4302", "CS4302", ["1.1", "1.4"], "MediaroomOS", ["3.10.5", "3.11.2", "3.12.0"], false],
  ["Fibe 4K Box (FTB-4K10)", "FB4K10", ["A1", "A2", "B1"], "Android TV 11", ["11.2.3", "11.3.0", "11.4.1", "11.5.0"], true],
  ["Fibe TV App Box (ATV-200)", "ATV200", ["R1", "R2"], "Android TV 12", ["12.0.8", "12.1.2", "12.2.0"], true],
];
const MODEL_WEIGHTS = [0.18, 0.27, 0.12, 0.28, 0.15];

export const REGIONS: Record<string, string[]> = {
  Ontario: ["Toronto", "Ottawa", "Mississauga", "Hamilton", "London", "Kingston", "Barrie", "Sudbury"],
  Quebec: ["Montreal", "Quebec City", "Laval", "Gatineau", "Sherbrooke", "Trois-Rivieres"],
  Atlantic: ["Halifax", "Moncton", "Saint John", "St. John's", "Fredericton", "Charlottetown"],
  Manitoba: ["Winnipeg", "Brandon", "Steinbach"],
};
const REGION_WEIGHTS = [0.48, 0.32, 0.13, 0.07];

const APPLICATIONS: [string, string, string, string, string[], string][] = [
  ["Fibe TV", "ca.bell.fibetv", "Live TV", "Bell Canada", ["8.4.1", "8.5.0", "8.6.2"], "system"],
  ["Fibe Guide", "ca.bell.fibe.guide", "Live TV", "Bell Canada", ["5.1.0", "5.2.3"], "system"],
  ["STB Diagnostics Agent", "ca.bell.stb.diagnostics", "System", "Bell Canada", ["2.0.4", "2.1.0", "2.2.1"], "system"],
  ["Fibe PVR", "ca.bell.fibe.pvr", "Live TV", "Bell Canada", ["3.3.0", "3.4.1"], "system"],
  ["Crave", "ca.bell.crave", "Streaming", "Bell Media", ["6.9.0", "7.0.2", "7.1.0"], "android"],
  ["Netflix", "com.netflix.ninja", "Streaming", "Netflix", ["9.12.0", "9.14.1", "9.15.0"], "android"],
  ["YouTube", "com.google.android.youtube.tv", "Streaming", "Google", ["4.40.3", "4.41.0"], "android"],
  ["Prime Video", "com.amazon.amazonvideo.livingroom", "Streaming", "Amazon", ["6.15.1", "6.16.0"], "android"],
  ["Disney+", "com.disney.disneyplus", "Streaming", "Disney", ["2.24.0", "2.25.1"], "android"],
  ["TSN", "ca.bell.tsn", "Sports", "Bell Media", ["4.2.0", "4.3.0"], "optional"],
  ["CTV", "ca.bell.ctv", "Entertainment", "Bell Media", ["3.8.2", "3.9.0"], "optional"],
  ["RDS", "ca.bell.rds", "Sports", "Bell Media", ["4.1.1", "4.2.0"], "optional"],
  ["Spotify", "com.spotify.tv.android", "Music", "Spotify", ["1.80.0", "1.82.3"], "android"],
];

const LOG_TEMPLATES: Record<string, [string, string, string][]> = {
  INFO: [
    ["SYSTEM", "sysmgr", "Scheduled maintenance window completed"],
    ["NETWORK", "netd", "DHCP lease renewed for {ip}"],
    ["APPLICATION", "appmgr", "Application ca.bell.fibetv resumed from standby"],
    ["FIRMWARE", "fw-updater", "Firmware integrity check passed"],
    ["SYSTEM", "epg-sync", "EPG data synchronised (14 days, 412 channels)"],
  ],
  WARNING: [
    ["NETWORK", "netd", "Packet loss of {loss}% detected on uplink"],
    ["HARDWARE", "thermal", "SoC temperature elevated: {temp} C"],
    ["APPLICATION", "appmgr", "Application response time exceeded 3000 ms"],
    ["SYSTEM", "storage", "Recording partition usage above 85%"],
    ["NETWORK", "wifi", "Wi-Fi signal degraded to {signal} dBm"],
  ],
  ERROR: [
    ["APPLICATION", "appmgr", "Application com.netflix.ninja terminated unexpectedly (SIGSEGV)"],
    ["NETWORK", "multicast", "IGMP join failed for channel group 239.1.1.{n}"],
    ["SYSTEM", "drm", "DRM license acquisition failed (code 0x8004C{n})"],
    ["FIRMWARE", "fw-updater", "Delta package download interrupted"],
  ],
  CRITICAL: [
    ["HARDWARE", "storage", "Filesystem error detected on /data - remounted read-only"],
    ["SYSTEM", "kernel", "Kernel watchdog reset triggered"],
    ["HARDWARE", "thermal", "Thermal shutdown threshold reached"],
  ],
};

const EVENT_TYPES: [string, string, string][] = [
  ["CONNECTED", "INFO", "Device connected"],
  ["DISCONNECTED", "WARNING", "Heartbeat lost - device disconnected"],
  ["REBOOT", "INFO", "Device rebooted (scheduled maintenance)"],
  ["APP_CRASH", "ERROR", "Application crash detected"],
  ["CONFIG_SYNC", "INFO", "Configuration synchronised with headend"],
  ["NETWORK_CHANGE", "INFO", "Network interface changed"],
  ["CRITICAL_ERROR", "CRITICAL", "Critical system error reported"],
];
const EVENT_WEIGHTS = [0.26, 0.2, 0.18, 0.12, 0.14, 0.07, 0.03];

const round1 = (v: number) => Math.round(v * 10) / 10;

export async function seedState(deviceCount = 500): Promise<State> {
  const rng = new Rng(20261122);
  const now = Math.floor(Date.now() / 1000) * 1000;
  const s: State = {
    version: STATE_VERSION,
    seeded_at: now,
    seq: {},
    users: [],
    firmware: [],
    apps: [],
    devices: [],
    events: [],
    logs: [],
    alerts: [],
    commands: [],
    deployments: [],
    targets: [],
    audit: [],
    snapshots: [],
    settings: {},
    sim: { running: true, tick: 0, started_at: now, last_registration: now, stats: { heartbeats: 0, events: 0, commands: 0, firmware_updates: 0, registrations: 0, errors: 0 } },
  };
  store.s = s;
  for (const [k, [v]] of Object.entries(DEFAULT_SETTINGS)) s.settings[k] = { value: v, updated_at: null };

  // Users
  const pw = {
    ADMIN: await hashPassword("Admin@12345"),
    SUPPORT_ENGINEER: await hashPassword("Support@12345"),
    READ_ONLY: await hashPassword("Readonly@12345"),
  };
  const people: [string, string, RoleName, boolean][] = [
    ["admin", "Alex Morgan", "ADMIN", true],
    ["support", "Samira Haddad", "SUPPORT_ENGINEER", true],
    ["readonly", "Ryan Leblanc", "READ_ONLY", true],
    ["m.gagnon", "Marie Gagnon", "SUPPORT_ENGINEER", true],
    ["d.okafor", "David Okafor", "ADMIN", true],
    ["p.nguyen", "Paul Nguyen", "READ_ONLY", true],
    ["j.tremblay", "Julie Tremblay", "SUPPORT_ENGINEER", false],
  ];
  const users: Record<string, DUser> = {};
  for (const [username, name, role, active] of people) {
    const u: DUser = {
      id: nextId("users"), username, email: `${username}@bellstb.local`, full_name: name, role, is_active: active,
      password_hash: pw[role], last_login_at: null, created_at: now - 120 * DAY, updated_at: now - 120 * DAY,
    };
    s.users.push(u);
    users[username] = u;
  }

  // Firmware
  const fwByModel: Record<string, Firmware[]> = {};
  const hex = () => Array.from({ length: 64 }, () => "0123456789abcdef"[rng.int(0, 15)]).join("");
  for (const [model, , , osFamily, versions] of MODELS) {
    fwByModel[model] = [];
    const n = versions.length;
    versions.forEach((v, i) => {
      const age = (n - 1 - i) * 75 + rng.int(5, 30);
      const fw: Firmware = {
        id: nextId("firmware"), version: v, model, os_version: `${osFamily} (${v.slice(0, v.lastIndexOf("."))})`,
        release_date: now - age * DAY,
        release_notes: rng.pick([
          "Security patches, improved channel change time and EPG stability fixes.",
          "Adds HDR10+ passthrough, fixes HDMI-CEC wake issues and reduces memory footprint.",
          "Improves Wi-Fi roaming, updates DRM components and resolves PVR playback stutter.",
          "Performance improvements for 4K streaming apps and updated diagnostics agent hooks.",
        ]),
        file_size_mb: round1(rng.uniform(180, 920)), checksum_sha256: hex(),
        status: i === 0 && n > 3 ? "DEPRECATED" : "ACTIVE", is_latest: i === n - 1,
      };
      s.firmware.push(fw);
      fwByModel[model].push(fw);
    });
    const [major, minor] = versions[n - 1].split(".");
    const beta: Firmware = {
      id: nextId("firmware"), version: `${major}.${Number(minor) + 1}.0-beta`, model,
      os_version: `${osFamily} (${major}.${Number(minor) + 1})`, release_date: now - rng.int(2, 10) * DAY,
      release_notes: "Beta build for lab validation. Not for general deployment.",
      file_size_mb: round1(rng.uniform(200, 950)), checksum_sha256: hex(), status: "BETA", is_latest: false,
    };
    s.firmware.push(beta);
    fwByModel[model].push(beta);
  }

  // Applications
  const apps: [App, string[], string][] = [];
  for (const [name, pkg, cat, pub, versions, kind] of APPLICATIONS) {
    const a: App = {
      id: nextId("apps"), name, package_id: pkg, category: cat, publisher: pub, latest_version: versions[versions.length - 1],
      description: `${name} application for Bell set-top boxes (${pub}).`,
    };
    s.apps.push(a);
    apps.push([a, versions, kind]);
  }

  // Devices
  const macs = new Set<string>();
  let seq = 104_000;
  for (let i = 1; i <= deviceCount; i++) {
    const [model, prefix, hw, , , android] = rng.weighted(MODELS, MODEL_WEIGHTS);
    const region = rng.weighted(Object.keys(REGIONS), REGION_WEIGHTS);
    seq += rng.int(1, 37);
    const serial = `${prefix}${rng.pick([23, 24, 25, 26])}${String(seq).padStart(6, "0")}`;
    const fwList = fwByModel[model].filter((f) => f.status !== "BETA");
    let weights = fwList.length > 2 ? [...Array(fwList.length - 2).fill(0.05), 0.25, 0.6] : [0.3, 0.7];
    weights = weights.slice(-fwList.length);
    const fw = rng.weighted(fwList, weights);
    const registered = now - Math.min(1080, Math.floor(rng.expo(300))) * DAY - rng.int(0, 23) * HOUR;
    const profile = i <= 10 ? "STABLE_ONLINE" : i <= 15 ? "STABLE_OFFLINE" : "STANDARD";
    const online = profile === "STABLE_ONLINE" || (profile === "STANDARD" && rng.next() < 0.87);
    const wifi = rng.next() < 0.3;
    const r = rng.next();
    let cpu: number;
    let mem: number;
    if (r < 0.015) [cpu, mem] = [rng.uniform(95, 99), rng.uniform(85, 97)];
    else if (r < 0.08) [cpu, mem] = [rng.uniform(80, 92), rng.uniform(70, 89)];
    else [cpu, mem] = [rng.uniform(6, 55), rng.uniform(28, 68)];
    const storage = rng.next() > 0.03 ? rng.uniform(15, 88) : rng.uniform(90, 97);
    const temp = rng.uniform(42, 62) + cpu / 10;
    let health: string;
    if (!online) health = rng.weighted(["HEALTHY", "WARNING"], [0.85, 0.15]);
    else if (cpu >= 95 || mem >= 95) health = "CRITICAL";
    else if (cpu >= 80 || mem >= 80 || storage >= 90) health = "WARNING";
    else health = "HEALTHY";
    const boot = now - rng.uniform(1, 24 * 45) * HOUR;
    const lastSeen = online ? now - rng.int(5, 60) * 1000 : now - rng.uniform(0.3, 24 * 9) * HOUR;
    let mac: string;
    do {
      mac = "00:1E:46:" + [0, 0, 0].map(() => rng.int(0, 255).toString(16).toUpperCase().padStart(2, "0")).join(":");
    } while (macs.has(mac));
    macs.add(mac);
    const d: Device = {
      id: i, device_id: `STB-${serial.slice(-8)}`, serial_number: serial, mac_address: mac, model,
      hardware_version: rng.pick(hw), fw_id: fw.id, os_version: fw.os_version,
      ip_address: `100.${rng.int(64, 127)}.${rng.int(0, 255)}.${rng.int(1, 254)}`,
      customer_ref: `BAN-${rng.int(500000000, 599999999)}`, region, city: rng.pick(REGIONS[region]), profile,
      registered_at: registered,
      st: {
        connection_status: online ? "ONLINE" : "OFFLINE", health_status: health, last_seen_at: lastSeen,
        last_boot_at: online ? boot : boot - 2 * DAY,
        last_connected_at: online ? boot + 40_000 : lastSeen - rng.int(1, 20) * DAY,
        last_disconnected_at: online && rng.next() < 0.4 ? null : !online ? lastSeen : boot - rng.int(1, 30) * MIN,
        cpu_usage: online ? round1(cpu) : 0, memory_usage: online ? round1(mem) : 0, storage_usage: round1(storage),
        temperature_c: round1(temp), network_type: wifi ? "WIFI" : "ETHERNET",
        signal_strength_dbm: wifi ? Math.round(rng.uniform(-78, -38)) : null,
        bandwidth_mbps: online ? round1(wifi ? rng.uniform(25, 95) : rng.uniform(80, 940)) : 0,
        latency_ms: online ? round1(wifi ? rng.uniform(12, 45) : rng.uniform(4, 18)) : 0,
        packet_loss_pct: online ? rng.pick([0, 0, 0, 0.1, 0.3, 0.8, 2.4]) : 0,
      },
      apps: [],
      sim: {
        base_cpu: cpu < 80 ? Math.min(cpu, 55) : rng.uniform(15, 40),
        base_mem: mem < 80 ? Math.min(mem, 65) : rng.uniform(35, 60),
        spike: cpu >= 80 ? rng.int(3, 20) : 0,
        busy_until: 0,
      },
    };
    for (const [app, versions, kind] of apps) {
      if (kind === "android" && !android) continue;
      if (kind === "optional" && rng.next() > 0.55) continue;
      if (kind === "android" && rng.next() > 0.8) continue;
      const vw = [...Array(versions.length - 1).fill(0.1), 0.7];
      const version = rng.weighted(versions, vw);
      let status = version !== versions[versions.length - 1] ? "UPDATE_AVAILABLE" : "INSTALLED";
      if (rng.next() < 0.01) status = "INSTALL_FAILED";
      d.apps.push({
        app_id: app.id, version, status, installed_at: registered + rng.int(0, 30) * DAY,
        last_used_at: rng.next() < 0.85 ? now - rng.uniform(0.2, 240) * HOUR : null,
        usage: Math.floor(rng.expo(app.category === "Live TV" || app.category === "Streaming" ? 600 : 120)),
        crashes: rng.weighted([0, 1, 2, 4], [0.86, 0.09, 0.04, 0.01]),
      });
    }
    s.devices.push(d);
  }
  s.seq.devices = deviceCount;

  // Fleet snapshots (90 days hourly)
  const hour0 = Math.floor(now / HOUR) * HOUR;
  for (let h = 90 * 24; h > 0; h--) {
    const ts = hour0 - h * HOUR;
    const size = Math.floor(deviceCount * (0.9 + 0.1 * (1 - h / (90 * 24))));
    const hourUtc = new Date(ts).getUTCHours();
    const evening = hourUtc >= 18 && hourUtc <= 23;
    const onlinePct = Math.min(0.97, Math.max(0.78, rng.gauss(evening ? 0.9 : 0.86, 0.025)));
    s.snapshots.push([ts, size, Math.floor(size * onlinePct), Math.floor(size * rng.uniform(0.04, 0.09)), Math.floor(size * rng.uniform(0.005, 0.02))]);
  }

  // Events and logs
  const pkgs = apps.map(([a]) => a.package_id);
  const evs: Omit<Ev, "id">[] = [];
  const logs: Omit<LogRec, "id">[] = [];
  for (const d of s.devices) {
    evs.push({ pk: d.id, type: "REGISTERED", sev: "INFO", desc: "Device registered and provisioned", at: d.registered_at });
    for (let k = rng.int(4, 10); k > 0; k--) {
      const [et, sev, base] = rng.weighted(EVENT_TYPES, EVENT_WEIGHTS);
      let desc = base;
      if (et === "APP_CRASH") desc = `Application ${rng.pick(pkgs)} crashed (exit code ${rng.pick([134, 139, 6])})`;
      else if (et === "NETWORK_CHANGE") desc = rng.pick(["Switched from Wi-Fi to Ethernet", "Switched from Ethernet to Wi-Fi", "IP address renewed"]);
      else if (et === "CONNECTED") desc = `Device connected (${d.ip_address})`;
      evs.push({ pk: d.id, type: et, sev, desc, at: now - rng.int(10, 30 * 24 * 60) * MIN });
    }
    for (let k = rng.int(6, 16); k > 0; k--) {
      const sev = rng.weighted(["INFO", "WARNING", "ERROR", "CRITICAL"], [0.62, 0.24, 0.11, 0.03]);
      const [cat, comp, tpl] = rng.pick(LOG_TEMPLATES[sev]);
      const msg = tpl
        .replace("{ip}", d.ip_address)
        .replace("{loss}", String(rng.pick([2.1, 3.4, 5.8])))
        .replace("{temp}", String(rng.int(71, 79)))
        .replace("{signal}", String(rng.int(-82, -74)))
        .replace("{n}", String(rng.int(10, 99)));
      logs.push({ pk: d.id, sev, cat, comp, msg, at: now - rng.int(1, 7 * 24 * 60) * MIN });
    }
  }
  evs.sort((a, b) => a.at - b.at).forEach((e) => s.events.push({ id: nextId("events"), ...e }));
  logs.sort((a, b) => a.at - b.at).forEach((l) => s.logs.push({ id: nextId("logs"), ...l }));

  // Alerts
  const latest: Record<string, Firmware> = {};
  for (const f of s.firmware) if (f.is_latest) latest[f.model] = f;
  let counter = 0;
  const responders = [users.support.id, users["m.gagnon"].id, users.admin.id];
  const add = (d: Device, cat: string, sev: string, title: string, desc: string, status: string, created: number) => {
    counter += 1;
    const a: AlertRec = {
      id: nextId("alerts"), code: `ALR-${(0x5a000 + counter).toString(16).toUpperCase().padStart(5, "0")}`, pk: d.id,
      category: cat, severity: sev, title, description: desc, status, created_at: created,
      ack_at: null, ack_by: null, res_at: null, res_by: null, note: null,
    };
    if (status === "ACKNOWLEDGED" || status === "RESOLVED") {
      a.ack_at = created + rng.int(3, 90) * MIN;
      a.ack_by = rng.pick(responders);
    }
    if (status === "RESOLVED") {
      a.res_at = (a.ack_at as number) + rng.int(5, 600) * MIN;
      a.res_by = a.ack_by;
      a.note = rng.pick(["Remote reboot cleared the issue", "Customer power-cycled the device", "Resolved after configuration sync", "Transient - no action required"]);
    }
    s.alerts.push(a);
  };
  for (const d of s.devices) {
    const st = d.st;
    if (st.connection_status === "OFFLINE") {
      add(d, "DEVICE_OFFLINE", "WARNING", "Device offline", `${d.device_id} (${d.model}) stopped sending heartbeats`, rng.pick(["OPEN", "OPEN", "ACKNOWLEDGED"]), (st.last_seen_at as number) + 2 * MIN);
    } else if (st.cpu_usage >= 90) {
      add(d, "HIGH_CPU", st.cpu_usage >= 97 ? "CRITICAL" : "WARNING", "High CPU usage", `CPU utilisation at ${Math.round(st.cpu_usage)}% (threshold 90%)`, "OPEN", now - rng.int(5, 600) * MIN);
    }
    if (st.connection_status === "ONLINE" && st.memory_usage >= 90) {
      add(d, "HIGH_MEMORY", "WARNING", "High memory usage", `Memory utilisation at ${Math.round(st.memory_usage)}% (threshold 90%)`, "OPEN", now - rng.int(5, 600) * MIN);
    }
    if (st.health_status === "CRITICAL" && rng.next() < 0.6) {
      add(d, "CRITICAL_ERROR", "CRITICAL", "Device critical error", "Kernel watchdog reset triggered", rng.pick(["OPEN", "ACKNOWLEDGED"]), now - rng.int(5, 300) * MIN);
    }
    if (d.fw_id !== latest[d.model].id && rng.next() < 0.08) {
      add(d, "FIRMWARE_UPDATE", "INFO", "Firmware update available", `Firmware ${latest[d.model].version} is available for ${d.model}`, "OPEN", now - rng.int(1, 20) * DAY);
    }
    if (rng.next() < 0.05) {
      add(d, "APP_CRASH", "WARNING", "Application crash", "Application com.netflix.ninja terminated unexpectedly", rng.pick(["OPEN", "ACKNOWLEDGED"]), now - rng.uniform(1, 48) * HOUR);
    }
    if (st.network_type === "WIFI" && rng.next() < 0.04) {
      add(d, "NETWORK_DISCONNECT", "WARNING", "Network disconnection", "Wi-Fi link lost for more than 60 seconds", st.connection_status === "OFFLINE" ? "OPEN" : "RESOLVED", now - rng.uniform(1, 72) * HOUR);
    }
  }
  const cats: [string, string, string][] = [
    ["HIGH_CPU", "WARNING", "High CPU usage"], ["APP_CRASH", "WARNING", "Application crash"],
    ["DEVICE_OFFLINE", "WARNING", "Device offline"], ["NETWORK_DISCONNECT", "WARNING", "Network disconnection"],
    ["CRITICAL_ERROR", "CRITICAL", "Device critical error"], ["HIGH_MEMORY", "WARNING", "High memory usage"],
  ];
  for (let k = 0; k < 260; k++) {
    const d = rng.pick(s.devices);
    const [cat, sev, title] = rng.pick(cats);
    add(d, cat, sev, title, `Historical ${title.toLowerCase()} event`, "RESOLVED", now - rng.uniform(12, 24 * 60) * HOUR);
  }

  // Commands
  const types = ["REBOOT", "SYNC_CONFIG", "REFRESH_INFO", "RESTART_APP", "CLEAR_APP_CACHE", "FACTORY_RESET"];
  const tWeights = [0.38, 0.22, 0.2, 0.1, 0.07, 0.03];
  for (let n = 0; n < 160; n++) {
    const d = rng.pick(s.devices);
    const ctype = rng.weighted(types, tWeights);
    const requester = ctype === "FACTORY_RESET" ? users.admin : rng.pick([users.support, users["m.gagnon"], users.admin]);
    const created = now - rng.int(30, 30 * 24 * 60) * MIN;
    const outcome = rng.weighted(["SUCCESSFUL", "FAILED", "TIMED_OUT"], [0.86, 0.07, 0.07]);
    const params = ctype === "RESTART_APP" || ctype === "CLEAR_APP_CACHE" ? { package_id: "ca.bell.fibetv" } : {};
    const stages: [string, number, string][] = [["PENDING", 0, "Command created"], ["QUEUED", 1, "Validated and queued for delivery"]];
    if (outcome === "TIMED_OUT") stages.push(["TIMED_OUT", 121, "No response from device within 120s (last stage: QUEUED)"]);
    else {
      stages.push(["SENT", 2, "Delivered to device"], ["ACKNOWLEDGED", 3, "Device acknowledged command"], ["EXECUTING", 4, "Execution started"]);
      stages.push(
        outcome === "SUCCESSFUL"
          ? ["SUCCESSFUL", rng.int(8, 60), "Command completed successfully"]
          : ["FAILED", rng.int(8, 40), rng.pick(["Device returned error code 0x21 (busy)", "Application not responding"])],
      );
    }
    const ts: Record<string, number> = {};
    for (const [st, off] of stages) ts[st] = created + off * 1000;
    const code = `CMD-${(0x3c000000 + n * 7919).toString(16).toUpperCase().padStart(8, "0")}`;
    s.commands.push({
      id: nextId("commands"), code, pk: d.id, type: ctype, status: outcome, params, result_message: stages[stages.length - 1][2],
      requested_by: requester.id, timeout_seconds: 120, created_at: created, queued_at: ts.QUEUED ?? null, sent_at: ts.SENT ?? null,
      acknowledged_at: ts.ACKNOWLEDGED ?? null, started_at: ts.EXECUTING ?? null, completed_at: ts[outcome], expires_at: created + 120_000,
      history: stages.map(([st, , m]) => ({ status: st, message: m, created_at: ts[st] })),
    });
    s.audit.push({
      id: 0, user_id: requester.id, username: requester.username, action: `COMMAND_${ctype}`, target_type: "device", target_id: d.device_id,
      details: { command_code: code, parameters: params }, result: "SUCCESS", ip_address: `10.20.${rng.int(1, 30)}.${rng.int(2, 250)}`, created_at: created,
    });
  }

  // Deployments
  let depN = 0;
  for (const [model, fws] of Object.entries(fwByModel)) {
    const released = fws.filter((f) => f.status !== "BETA");
    for (const fw of released.slice(-2)) {
      depN += 1;
      const idx = released.indexOf(fw);
      const prev = idx > 0 ? released[idx - 1] : null;
      const onTarget = s.devices.filter((d) => d.model === model && d.fw_id === fw.id);
      const sample = rng.sample(onTarget, Math.min(onTarget.length, rng.int(12, 40)));
      const failedExtra = s.devices.filter((d) => d.model === model && d.fw_id !== fw.id).slice(0, rng.int(0, 3));
      const created = fw.release_date + rng.int(1, 5) * DAY;
      const dep: Dep = {
        id: nextId("deployments"), code: `DEP-${String(depN).padStart(5, "0")}`, name: `${model} ${fw.version} rollout wave ${rng.int(1, 3)}`,
        fw_id: fw.id, status: failedExtra.length ? "COMPLETED_WITH_ERRORS" : "COMPLETED", is_rollback: false, rollback_of: null,
        offline_policy: "WAIT", scheduled_at: created, started_at: created + MIN, completed_at: created + rng.int(1, 8) * HOUR,
        created_by: users.admin.id, created_at: created,
      };
      s.deployments.push(dep);
      for (const d of sample) {
        s.targets.push({ id: nextId("targets"), dep_id: dep.id, pk: d.id, prev_fw_id: prev ? prev.id : null, target_fw_id: fw.id, status: "SUCCESS", error: null, updated_at: dep.completed_at as number });
      }
      for (const d of failedExtra) {
        s.targets.push({
          id: nextId("targets"), dep_id: dep.id, pk: d.id, prev_fw_id: d.fw_id, target_fw_id: fw.id, status: "FAILED",
          error: rng.pick(["Checksum verification failed", "Insufficient storage", "Device unreachable during deployment window"]), updated_at: dep.completed_at as number,
        });
      }
      s.audit.push({
        id: 0, user_id: users.admin.id, username: "admin", action: "FIRMWARE_DEPLOYMENT_CREATED", target_type: "deployment", target_id: dep.code,
        details: { firmware: fw.version, model, targets: sample.length + failedExtra.length }, result: "SUCCESS", ip_address: "10.20.1.15", created_at: created,
      });
    }
  }

  // Audit trail
  const actives = s.users.filter((u) => u.is_active);
  for (let k = 0; k < 420; k++) {
    const u = rng.pick(actives);
    const t = now - rng.int(60, 30 * 24 * 60) * MIN;
    const ip = `10.20.${rng.int(1, 30)}.${rng.int(2, 250)}`;
    s.audit.push({ id: 0, user_id: u.id, username: u.username, action: "LOGIN", target_type: "session", target_id: null, details: {}, result: "SUCCESS", ip_address: ip, created_at: t });
    if (rng.next() < 0.7) {
      s.audit.push({ id: 0, user_id: u.id, username: u.username, action: "LOGOUT", target_type: "session", target_id: null, details: {}, result: "SUCCESS", ip_address: ip, created_at: t + rng.int(5, 400) * MIN });
    }
  }
  for (let k = 0; k < 25; k++) {
    const u = rng.pick(s.users);
    s.audit.push({
      id: 0, user_id: u.id, username: u.username, action: "LOGIN_FAILED", target_type: "session", target_id: null, details: { reason: "invalid_credentials" },
      result: "FAILURE", ip_address: `10.20.${rng.int(1, 30)}.${rng.int(2, 250)}`, created_at: now - rng.int(60, 30 * 24 * 60) * MIN,
    });
  }
  s.audit.push({ id: 0, user_id: users.admin.id, username: "admin", action: "USER_DEACTIVATED", target_type: "user", target_id: "j.tremblay", details: {}, result: "SUCCESS", ip_address: "10.20.1.15", created_at: now - 12 * DAY });
  s.audit.push({
    id: 0, user_id: users.admin.id, username: "admin", action: "CONFIGURATION_CHANGED", target_type: "settings", target_id: "system",
    details: { cpu_alert_threshold: { from: "85", to: "90" } }, result: "SUCCESS", ip_address: "10.20.1.15", created_at: now - 20 * DAY,
  });
  s.audit.sort((a, b) => a.created_at - b.created_at).forEach((a) => (a.id = nextId("audit")));
  return s;
}
