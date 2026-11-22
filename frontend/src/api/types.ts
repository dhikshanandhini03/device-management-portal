export interface Page<T> {
  items: T[];
  total: number;
  page: number;
  page_size: number;
  pages: number;
}

export interface CurrentUser {
  id: number;
  username: string;
  email: string;
  full_name: string;
  role: "ADMIN" | "SUPPORT_ENGINEER" | "READ_ONLY";
  is_active: boolean;
  last_login_at: string | null;
  created_at: string;
  updated_at: string;
  permissions: string[];
}

export type UserRecord = Omit<CurrentUser, "permissions">;

export interface Device {
  id: number;
  device_id: string;
  serial_number: string;
  mac_address: string;
  model: string;
  hardware_version: string;
  firmware_version: string;
  os_version: string;
  ip_address: string;
  connection_status: "ONLINE" | "OFFLINE" | "REBOOTING";
  health_status: "HEALTHY" | "WARNING" | "CRITICAL";
  last_seen_at: string | null;
  customer_ref: string;
  region: string;
  city: string;
  simulation_profile: string;
  registered_at: string;
  update_available: boolean;
  latest_firmware_version: string | null;
}

export interface DeviceDetail extends Device {
  firmware_release_date: string | null;
  last_boot_at: string | null;
  uptime_seconds: number | null;
  last_connected_at: string | null;
  last_disconnected_at: string | null;
  cpu_usage: number;
  memory_usage: number;
  storage_usage: number;
  temperature_c: number | null;
  network_type: string;
  signal_strength_dbm: number | null;
  bandwidth_mbps: number;
  latency_ms: number;
  packet_loss_pct: number;
  open_alerts: number;
}

export interface DeviceEvent {
  id: number;
  event_type: string;
  severity: string;
  description: string;
  created_at: string;
  device_id?: string | null;
}

export interface DeviceLog {
  id: number;
  severity: "INFO" | "WARNING" | "ERROR" | "CRITICAL";
  category: string;
  component: string;
  message: string;
  created_at: string;
  device_id?: string | null;
  serial_number?: string | null;
}

export interface InstalledApp {
  application_id: number;
  name: string;
  package_id: string;
  category: string;
  version: string;
  latest_version: string;
  status: string;
  update_available: boolean;
  installed_at: string;
  last_used_at: string | null;
  usage_minutes_7d: number;
  crash_count_7d: number;
}

export interface TelemetryPoint {
  timestamp: string;
  cpu_usage: number;
  memory_usage: number;
  storage_usage: number;
  temperature_c: number | null;
  latency_ms: number;
}

export interface Command {
  id: number;
  command_code: string;
  device_id: string;
  serial_number: string;
  device_model: string;
  command_type: string;
  status: string;
  parameters: Record<string, unknown>;
  result_message: string | null;
  requested_by: string | null;
  timeout_seconds: number;
  created_at: string;
  queued_at: string | null;
  sent_at: string | null;
  acknowledged_at: string | null;
  started_at: string | null;
  completed_at: string | null;
  expires_at: string;
  history: { status: string; message: string | null; created_at: string }[];
}

export interface Firmware {
  id: number;
  version: string;
  model: string;
  os_version: string;
  release_date: string;
  release_notes: string;
  file_size_mb: number;
  checksum_sha256: string;
  status: string;
  is_latest: boolean;
  device_count: number;
}

export interface Deployment {
  id: number;
  deployment_code: string;
  name: string;
  firmware_version_id: number;
  firmware_version: string;
  model: string;
  status: string;
  is_rollback: boolean;
  rollback_of: string | null;
  offline_policy: string;
  target_count: number;
  successful_count: number;
  failed_count: number;
  pending_count: number;
  in_progress_count: number;
  progress_pct: number;
  scheduled_at: string;
  started_at: string | null;
  completed_at: string | null;
  created_by: string | null;
  created_at: string;
}

export interface DeploymentTarget {
  id: number;
  device_id: string;
  serial_number: string;
  region: string;
  connection_status: string;
  previous_version: string | null;
  target_version: string;
  status: string;
  error_message: string | null;
  updated_at: string;
}

export interface Application {
  id: number;
  name: string;
  package_id: string;
  category: string;
  publisher: string;
  latest_version: string;
  description: string;
  device_count: number;
  version_count: number;
  latest_count: number;
  update_available_count: number;
  failed_count: number;
}

export interface ApplicationDetail extends Application {
  versions: { version: string; device_count: number; is_latest: boolean; percentage: number }[];
  statuses: { status: string; device_count: number }[];
  usage_minutes_7d: number;
  crash_count_7d: number;
}

export interface Alert {
  id: number;
  alert_code: string;
  device_id: string;
  serial_number: string;
  category: string;
  severity: "INFO" | "WARNING" | "CRITICAL";
  title: string;
  description: string;
  status: "OPEN" | "ACKNOWLEDGED" | "RESOLVED";
  created_at: string;
  acknowledged_at: string | null;
  acknowledged_by: string | null;
  resolved_at: string | null;
  resolved_by: string | null;
  resolution_note: string | null;
}

export interface AuditLog {
  id: number;
  user_id: number | null;
  username: string;
  action: string;
  target_type: string | null;
  target_id: string | null;
  details: Record<string, unknown>;
  result: string;
  ip_address: string | null;
  created_at: string;
}

export interface LabelValue {
  label: string;
  value: number;
}
