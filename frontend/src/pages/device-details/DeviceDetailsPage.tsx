import { ReactNode, useState } from "react";
import { useParams, useSearchParams, useNavigate } from "react-router-dom";
import { keepPreviousData, useQuery } from "@tanstack/react-query";
import {
  Box,
  Button,
  Card,
  CardContent,
  Chip,
  LinearProgress,
  MenuItem,
  Stack,
  Tab,
  Table,
  TableBody,
  TableCell,
  TableContainer,
  TableHead,
  TableRow,
  Tabs,
  TextField,
  ToggleButton,
  ToggleButtonGroup,
  Typography,
} from "@mui/material";
import Grid from "@mui/material/Grid2";
import SettingsRemoteOutlinedIcon from "@mui/icons-material/SettingsRemoteOutlined";
import MonitorHeartOutlinedIcon from "@mui/icons-material/MonitorHeartOutlined";
import { CartesianGrid, Legend, Line, LineChart, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import { api } from "../../api/client";
import type { Alert, Command, DeviceDetail, DeviceEvent, DeviceLog, InstalledApp, Page, TelemetryPoint } from "../../api/types";
import PageHeader from "../../components/common/PageHeader";
import StatusChip from "../../components/common/StatusChip";
import KeyValueGrid from "../../components/common/KeyValueGrid";
import Pager from "../../components/common/Pager";
import ChartCard from "../../components/common/ChartCard";
import { EmptyState, ErrorState, LoadingState } from "../../components/common/States";
import CommandLauncher from "../../components/commands/CommandLauncher";
import CommandHistoryTable from "../../components/commands/CommandHistoryTable";
import { dayjs, fmtDate, fmtDateTime, fmtRelative, fmtUptime, humanize } from "../../utils/format";

const TABS = ["overview", "network", "software", "hardware", "activity", "logs", "remote"] as const;
type TabId = (typeof TABS)[number];

function Section({ title, children, testId, action }: { title: string; children: ReactNode; testId?: string; action?: ReactNode }) {
  return (
    <Card sx={{ mb: 2 }} data-testid={testId}>
      <CardContent>
        <Stack direction="row" justifyContent="space-between" alignItems="center" sx={{ mb: 2 }}>
          <Typography variant="h6">{title}</Typography>
          {action}
        </Stack>
        {children}
      </CardContent>
    </Card>
  );
}

function Gauge({ label, value, unit = "%", max = 100, warn = 80, crit = 95, testId }: { label: string; value: number | null; unit?: string; max?: number; warn?: number; crit?: number; testId: string }) {
  const v = value ?? 0;
  const color = v >= crit ? "error" : v >= warn ? "warning" : "success";
  return (
    <Card sx={{ height: "100%" }} data-testid={testId}>
      <CardContent>
        <Typography variant="caption" color="text.secondary" fontWeight={600} textTransform="uppercase">
          {label}
        </Typography>
        <Typography variant="h4" sx={{ my: 1 }} data-testid={`${testId}-value`}>
          {value === null ? "—" : `${v.toFixed(1)}${unit}`}
        </Typography>
        <LinearProgress variant="determinate" value={Math.min(100, (v / max) * 100)} color={color} sx={{ height: 8, borderRadius: 4 }} />
      </CardContent>
    </Card>
  );
}

function OverviewTab({ d }: { d: DeviceDetail }) {
  const alerts = useQuery({ queryKey: ["device-alerts", d.device_id], queryFn: async () => (await api.get<Alert[]>(`/devices/${d.device_id}/alerts`)).data });
  const open = (alerts.data ?? []).filter((a) => a.status !== "RESOLVED");
  return (
    <>
      <Section title="Device information" testId="overview-section">
        <KeyValueGrid
          columns={4}
          items={[
            { label: "Device ID", value: d.device_id, testId: "detail-device-id" },
            { label: "Serial number", value: d.serial_number, testId: "detail-serial" },
            { label: "MAC address", value: d.mac_address, testId: "detail-mac" },
            { label: "Device model", value: d.model, testId: "detail-model" },
            { label: "Hardware revision", value: d.hardware_version, testId: "detail-hardware" },
            { label: "Firmware version", value: d.firmware_version, testId: "detail-firmware" },
            { label: "Operating system", value: d.os_version, testId: "detail-os" },
            { label: "IP address", value: d.ip_address, testId: "detail-ip" },
            { label: "Connection status", value: <StatusChip value={d.connection_status} testId="detail-status-chip" />, testId: "detail-status" },
            { label: "Last communication", value: `${fmtDateTime(d.last_seen_at)} (${fmtRelative(d.last_seen_at)})`, testId: "detail-last-seen" },
            { label: "Device uptime", value: fmtUptime(d.uptime_seconds), testId: "detail-uptime" },
            { label: "Customer reference", value: d.customer_ref, testId: "detail-customer" },
            { label: "Region / City", value: `${d.region} / ${d.city}`, testId: "detail-region" },
            { label: "Registered", value: fmtDate(d.registered_at) },
            { label: "Health", value: <StatusChip value={d.health_status} />, testId: "detail-health" },
            { label: "Simulation profile", value: humanize(d.simulation_profile) },
          ]}
        />
      </Section>
      <Section title={`Active alerts (${open.length})`} testId="device-active-alerts">
        {open.length === 0 ? (
          <EmptyState title="No active alerts for this device" />
        ) : (
          <Table size="small">
            <TableBody>
              {open.map((a) => (
                <TableRow key={a.id}>
                  <TableCell width={100}><StatusChip value={a.severity} /></TableCell>
                  <TableCell>{a.title}</TableCell>
                  <TableCell>{a.description}</TableCell>
                  <TableCell><StatusChip value={a.status} /></TableCell>
                  <TableCell>{fmtRelative(a.created_at)}</TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        )}
      </Section>
    </>
  );
}

interface NetworkInfo {
  network_type: string;
  signal_strength_dbm: number | null;
  bandwidth_mbps: number;
  latency_ms: number;
  packet_loss_pct: number;
  last_connected_at: string | null;
  last_disconnected_at: string | null;
  connection_status: string;
  ip_address: string;
  mac_address: string;
  connection_history: DeviceEvent[];
}

function NetworkTab({ d }: { d: DeviceDetail }) {
  const q = useQuery({ queryKey: ["device-network", d.device_id], queryFn: async () => (await api.get<NetworkInfo>(`/devices/${d.device_id}/network`)).data });
  if (q.isLoading) return <LoadingState />;
  if (q.isError || !q.data) return <ErrorState error={q.error} onRetry={() => q.refetch()} />;
  const n = q.data;
  return (
    <>
      <Section title="Network connectivity" testId="network-section">
        <KeyValueGrid
          columns={4}
          items={[
            { label: "IP address", value: n.ip_address, testId: "network-ip" },
            { label: "MAC address", value: n.mac_address, testId: "network-mac" },
            { label: "Connectivity", value: <StatusChip value={n.connection_status} />, testId: "network-status" },
            { label: "Interface", value: n.network_type === "WIFI" ? "Wi-Fi" : "Ethernet", testId: "network-type" },
            { label: "Signal strength", value: n.signal_strength_dbm !== null ? `${n.signal_strength_dbm} dBm` : "N/A (wired)", testId: "network-signal" },
            { label: "Bandwidth", value: `${n.bandwidth_mbps.toFixed(1)} Mbps`, testId: "network-bandwidth" },
            { label: "Latency", value: `${n.latency_ms.toFixed(1)} ms`, testId: "network-latency" },
            { label: "Packet loss", value: `${n.packet_loss_pct.toFixed(1)}%`, testId: "network-packet-loss" },
            { label: "Last connected", value: fmtDateTime(n.last_connected_at), testId: "network-last-connected" },
            { label: "Last disconnected", value: fmtDateTime(n.last_disconnected_at), testId: "network-last-disconnected" },
          ]}
        />
      </Section>
      <Section title="Connection history" testId="connection-history">
        {n.connection_history.length === 0 ? (
          <EmptyState title="No connection events recorded" />
        ) : (
          <Table size="small">
            <TableHead>
              <TableRow>
                <TableCell>Timestamp</TableCell>
                <TableCell>Event</TableCell>
                <TableCell>Details</TableCell>
              </TableRow>
            </TableHead>
            <TableBody>
              {n.connection_history.map((e) => (
                <TableRow key={e.id} data-testid="connection-history-row">
                  <TableCell sx={{ whiteSpace: "nowrap" }}>{fmtDateTime(e.created_at)}</TableCell>
                  <TableCell><StatusChip value={e.event_type === "CONNECTED" ? "ONLINE" : e.event_type === "DISCONNECTED" ? "OFFLINE" : "INFO"} /></TableCell>
                  <TableCell>{e.description}</TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        )}
      </Section>
    </>
  );
}

interface Software {
  firmware_version: string;
  firmware_release_date: string | null;
  os_version: string;
  latest_firmware_version: string | null;
  latest_os_version: string | null;
  update_available: boolean;
  applications: InstalledApp[];
}

function SoftwareTab({ d }: { d: DeviceDetail }) {
  const q = useQuery({ queryKey: ["device-software", d.device_id], queryFn: async () => (await api.get<Software>(`/devices/${d.device_id}/software`)).data });
  if (q.isLoading) return <LoadingState />;
  if (q.isError || !q.data) return <ErrorState error={q.error} onRetry={() => q.refetch()} />;
  const s = q.data;
  return (
    <>
      <Section title="Firmware & operating system" testId="software-section">
        <KeyValueGrid
          columns={3}
          items={[
            { label: "Firmware version", value: s.firmware_version, testId: "software-firmware" },
            { label: "Firmware release date", value: fmtDate(s.firmware_release_date) },
            { label: "Operating system", value: s.os_version, testId: "software-os" },
            { label: "Latest firmware for model", value: s.latest_firmware_version ?? "—", testId: "software-latest-firmware" },
            { label: "Latest OS", value: s.latest_os_version ?? "—" },
            {
              label: "Available updates",
              value: s.update_available ? <Chip size="small" color="secondary" label={`Firmware ${s.latest_firmware_version} available`} /> : <Chip size="small" color="success" label="Up to date" />,
              testId: "software-update-available",
            },
          ]}
        />
      </Section>
      <Section title={`Installed applications (${s.applications.length})`} testId="installed-apps">
        <TableContainer>
          <Table size="small" data-testid="apps-table">
            <TableHead>
              <TableRow>
                <TableCell>Application</TableCell>
                <TableCell>Package</TableCell>
                <TableCell>Installed version</TableCell>
                <TableCell>Latest version</TableCell>
                <TableCell>Status</TableCell>
                <TableCell>Last used</TableCell>
                <TableCell align="right">Usage (7d)</TableCell>
                <TableCell align="right">Crashes (7d)</TableCell>
              </TableRow>
            </TableHead>
            <TableBody>
              {s.applications.map((a) => (
                <TableRow key={a.package_id} data-testid="app-row" data-package={a.package_id}>
                  <TableCell sx={{ fontWeight: 600 }}>{a.name}</TableCell>
                  <TableCell sx={{ fontFamily: "monospace", fontSize: 12 }}>{a.package_id}</TableCell>
                  <TableCell data-testid="app-version">{a.version}</TableCell>
                  <TableCell>{a.latest_version}</TableCell>
                  <TableCell><StatusChip value={a.update_available && a.status === "INSTALLED" ? "UPDATE_AVAILABLE" : a.status} /></TableCell>
                  <TableCell>{fmtRelative(a.last_used_at)}</TableCell>
                  <TableCell align="right">{(a.usage_minutes_7d / 60).toFixed(1)} h</TableCell>
                  <TableCell align="right">{a.crash_count_7d}</TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </TableContainer>
      </Section>
    </>
  );
}

function HardwareTab({ d }: { d: DeviceDetail }) {
  const [hours, setHours] = useState(24);
  const q = useQuery({
    queryKey: ["device-telemetry", d.device_id, hours],
    queryFn: async () => (await api.get<{ resolution: string; points: TelemetryPoint[] }>(`/devices/${d.device_id}/telemetry`, { params: { hours } })).data,
  });
  const data = (q.data?.points ?? []).map((p) => ({ ...p, t: dayjs(p.timestamp).format(hours > 24 ? "MMM D HH:mm" : "HH:mm") }));
  return (
    <>
      <Grid container spacing={2} sx={{ mb: 2 }}>
        <Grid size={{ xs: 12, sm: 6, md: 3 }}><Gauge label="CPU utilisation" value={d.cpu_usage} testId="hw-cpu" /></Grid>
        <Grid size={{ xs: 12, sm: 6, md: 3 }}><Gauge label="Memory utilisation" value={d.memory_usage} testId="hw-memory" /></Grid>
        <Grid size={{ xs: 12, sm: 6, md: 3 }}><Gauge label="Storage utilisation" value={d.storage_usage} warn={90} crit={97} testId="hw-storage" /></Grid>
        <Grid size={{ xs: 12, sm: 6, md: 3 }}><Gauge label="SoC temperature" value={d.temperature_c} unit=" °C" max={100} warn={70} crit={80} testId="hw-temperature" /></Grid>
      </Grid>
      {d.connection_status !== "ONLINE" && (
        <Typography variant="body2" color="text.secondary" sx={{ mb: 2 }}>
          Device is offline. Values show the last reported state.
        </Typography>
      )}
      <ChartCard
        title="Resource utilisation history"
        subtitle={q.data ? `${q.data.resolution === "raw" ? "Raw samples" : "Hourly averages"} · ${data.length} points` : undefined}
        testId="hw-telemetry-chart"
        loading={q.isLoading}
        error={q.error}
        empty={!data.length}
        height={300}
        action={
          <ToggleButtonGroup size="small" exclusive value={hours} onChange={(_, v) => v && setHours(v)}>
            <ToggleButton value={6}>6h</ToggleButton>
            <ToggleButton value={24}>24h</ToggleButton>
            <ToggleButton value={168}>7d</ToggleButton>
          </ToggleButtonGroup>
        }
      >
        <ResponsiveContainer>
          <LineChart data={data}>
            <CartesianGrid strokeDasharray="3 3" vertical={false} />
            <XAxis dataKey="t" fontSize={11} minTickGap={30} />
            <YAxis fontSize={11} domain={[0, 100]} />
            <Tooltip />
            <Legend />
            <Line type="monotone" dataKey="cpu_usage" name="CPU %" stroke="#1f5fa8" dot={false} strokeWidth={2} />
            <Line type="monotone" dataKey="memory_usage" name="Memory %" stroke="#e1251b" dot={false} strokeWidth={2} />
            <Line type="monotone" dataKey="storage_usage" name="Storage %" stroke="#2e9d6a" dot={false} strokeWidth={1.5} />
            <Line type="monotone" dataKey="temperature_c" name="Temp °C" stroke="#f2a516" dot={false} strokeWidth={1.5} />
          </LineChart>
        </ResponsiveContainer>
      </ChartCard>
    </>
  );
}

const EVENT_GROUPS: Record<string, string> = {
  all: "",
  connection: "CONNECTED,DISCONNECTED,NETWORK_CHANGE,NETWORK_LOSS",
  reboot: "REBOOT,FACTORY_RESET",
  application: "APP_CRASH,APP_RESTART,APP_CACHE_CLEARED",
  firmware: "FIRMWARE_UPDATED,FIRMWARE_UPDATE_FAILED",
  commands: "COMMAND_SUCCESSFUL,COMMAND_FAILED,COMMAND_TIMED_OUT",
};

function ActivityTab({ d }: { d: DeviceDetail }) {
  const [group, setGroup] = useState("all");
  const [page, setPage] = useState(1);
  const [cmdPage, setCmdPage] = useState(1);
  const events = useQuery({
    queryKey: ["device-events", d.device_id, group, page],
    queryFn: async () => (await api.get<Page<DeviceEvent>>(`/devices/${d.device_id}/events`, { params: { event_type: EVENT_GROUPS[group] || undefined, page, page_size: 15 } })).data,
    placeholderData: keepPreviousData,
  });
  const commands = useQuery({
    queryKey: ["device-commands", d.device_id, cmdPage],
    queryFn: async () => (await api.get<Page<Command>>(`/devices/${d.device_id}/commands`, { params: { page: cmdPage, page_size: 10 } })).data,
  });
  return (
    <>
      <Section
        title="Device events"
        testId="device-events"
        action={
          <ToggleButtonGroup size="small" exclusive value={group} onChange={(_, v) => { if (v) { setGroup(v); setPage(1); } }} data-testid="event-filter">
            <ToggleButton value="all">All</ToggleButton>
            <ToggleButton value="connection" data-testid="event-filter-connection">Connection</ToggleButton>
            <ToggleButton value="reboot" data-testid="event-filter-reboot">Reboots</ToggleButton>
            <ToggleButton value="application">Applications</ToggleButton>
            <ToggleButton value="firmware">Firmware</ToggleButton>
            <ToggleButton value="commands">Commands</ToggleButton>
          </ToggleButtonGroup>
        }
      >
        {events.isLoading ? (
          <LoadingState />
        ) : !events.data?.items.length ? (
          <EmptyState title="No events for this filter" />
        ) : (
          <>
            <Table size="small" data-testid="events-table">
              <TableHead>
                <TableRow>
                  <TableCell>Timestamp</TableCell>
                  <TableCell>Event</TableCell>
                  <TableCell>Severity</TableCell>
                  <TableCell>Description</TableCell>
                </TableRow>
              </TableHead>
              <TableBody>
                {events.data.items.map((e) => (
                  <TableRow key={e.id} data-testid="event-row" data-event-type={e.event_type}>
                    <TableCell sx={{ whiteSpace: "nowrap" }}>{fmtDateTime(e.created_at)}</TableCell>
                    <TableCell sx={{ fontWeight: 600 }}>{humanize(e.event_type)}</TableCell>
                    <TableCell><StatusChip value={e.severity} /></TableCell>
                    <TableCell>{e.description}</TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
            <Pager total={events.data.total} page={page} pageSize={15} onPage={setPage} testId="events-pagination" />
          </>
        )}
      </Section>
      <Section title="Remote command history" testId="device-command-history">
        {commands.isLoading ? (
          <LoadingState />
        ) : (
          <>
            <CommandHistoryTable rows={commands.data?.items ?? []} showDevice={false} />
            {!!commands.data?.total && <Pager total={commands.data.total} page={cmdPage} pageSize={10} onPage={setCmdPage} testId="device-commands-pagination" />}
          </>
        )}
      </Section>
    </>
  );
}

function LogsTab({ d }: { d: DeviceDetail }) {
  const [severity, setSeverity] = useState("");
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(25);
  const q = useQuery({
    queryKey: ["device-logs", d.device_id, severity, page, pageSize],
    queryFn: async () => (await api.get<Page<DeviceLog>>(`/devices/${d.device_id}/logs`, { params: { severity: severity || undefined, page, page_size: pageSize } })).data,
    placeholderData: keepPreviousData,
  });
  return (
    <Section
      title="Device logs"
      testId="device-logs"
      action={
        <TextField select label="Severity" value={severity} onChange={(e) => { setSeverity(e.target.value); setPage(1); }} sx={{ minWidth: 160 }} SelectProps={{ inputProps: { "data-testid": "log-severity-filter" } }}>
          <MenuItem value="">All severities</MenuItem>
          {["INFO", "WARNING", "ERROR", "CRITICAL"].map((s) => <MenuItem key={s} value={s}>{s}</MenuItem>)}
        </TextField>
      }
    >
      {q.isLoading ? (
        <LoadingState />
      ) : q.isError ? (
        <ErrorState error={q.error} />
      ) : !q.data?.items.length ? (
        <EmptyState title="No log entries" />
      ) : (
        <>
          <Table size="small" data-testid="logs-table">
            <TableHead>
              <TableRow>
                <TableCell>Timestamp</TableCell>
                <TableCell>Severity</TableCell>
                <TableCell>Category</TableCell>
                <TableCell>Component</TableCell>
                <TableCell>Message</TableCell>
              </TableRow>
            </TableHead>
            <TableBody>
              {q.data.items.map((l) => (
                <TableRow key={l.id} data-testid="log-row" data-severity={l.severity}>
                  <TableCell sx={{ whiteSpace: "nowrap", fontFamily: "monospace", fontSize: 12 }}>{fmtDateTime(l.created_at)}</TableCell>
                  <TableCell><StatusChip value={l.severity} /></TableCell>
                  <TableCell>{l.category}</TableCell>
                  <TableCell sx={{ fontFamily: "monospace", fontSize: 12 }}>{l.component}</TableCell>
                  <TableCell data-testid="log-message">{l.message}</TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
          <Pager total={q.data.total} page={page} pageSize={pageSize} onPage={setPage} onPageSize={(s) => { setPageSize(s); setPage(1); }} testId="logs-pagination" />
        </>
      )}
    </Section>
  );
}

export default function DeviceDetailsPage() {
  const { deviceId = "" } = useParams();
  const navigate = useNavigate();
  const [params, setParams] = useSearchParams();
  const tab = (TABS.includes(params.get("tab") as TabId) ? params.get("tab") : "overview") as TabId;
  const q = useQuery({
    queryKey: ["device", deviceId],
    queryFn: async () => (await api.get<DeviceDetail>(`/devices/${deviceId}`)).data,
    refetchInterval: 10000,
  });

  if (q.isLoading) return <LoadingState label="Loading device…" />;
  if (q.isError || !q.data)
    return (
      <Box data-testid="device-details-page">
        <PageHeader title={deviceId} crumbs={[{ label: "Device Inventory", to: "/devices" }, { label: deviceId }]} />
        <ErrorState error={q.error} title="Device could not be loaded" onRetry={() => q.refetch()} />
      </Box>
    );
  const d = q.data;
  return (
    <Box data-testid="device-details-page">
      <PageHeader
        title={d.device_id}
        testId="device-title"
        crumbs={[{ label: "Device Inventory", to: "/devices" }, { label: d.device_id }]}
        subtitle={
          <Stack direction="row" spacing={1} alignItems="center" component="span">
            <StatusChip value={d.connection_status} testId="header-status" />
            <StatusChip value={d.health_status} testId="header-health" />
            <span>
              {d.model} · {d.serial_number} · {d.region}
            </span>
          </Stack>
        }
        actions={
          <>
            <Button variant="outlined" startIcon={<MonitorHeartOutlinedIcon />} onClick={() => navigate(`/monitoring/devices/${d.device_id}`)} data-testid="open-diagnostics">
              Diagnostics
            </Button>
            <Button variant="contained" startIcon={<SettingsRemoteOutlinedIcon />} onClick={() => setParams({ tab: "remote" })} data-testid="open-remote-actions">
              Remote actions
            </Button>
          </>
        }
      />
      <Tabs value={tab} onChange={(_, v) => setParams({ tab: v })} sx={{ mb: 2, borderBottom: 1, borderColor: "divider" }} variant="scrollable" data-testid="device-tabs">
        <Tab value="overview" label="Overview" data-testid="tab-overview" />
        <Tab value="network" label="Network" data-testid="tab-network" />
        <Tab value="software" label="Software" data-testid="tab-software" />
        <Tab value="hardware" label="Hardware" data-testid="tab-hardware" />
        <Tab value="activity" label="Activity" data-testid="tab-activity" />
        <Tab value="logs" label="Logs" data-testid="tab-logs" />
        <Tab value="remote" label="Remote Actions" data-testid="tab-remote" />
      </Tabs>
      <Box data-testid={`tabpanel-${tab}`}>
        {tab === "overview" && <OverviewTab d={d} />}
        {tab === "network" && <NetworkTab d={d} />}
        {tab === "software" && <SoftwareTab d={d} />}
        {tab === "hardware" && <HardwareTab d={d} />}
        {tab === "activity" && <ActivityTab d={d} />}
        {tab === "logs" && <LogsTab d={d} />}
        {tab === "remote" && (
          <Section title="Remote device operations" testId="remote-section">
            <CommandLauncher device={d} />
          </Section>
        )}
      </Box>
    </Box>
  );
}
