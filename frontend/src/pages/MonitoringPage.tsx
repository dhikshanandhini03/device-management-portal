import { useState } from "react";
import { useNavigate } from "react-router-dom";
import { keepPreviousData, useQuery } from "@tanstack/react-query";
import {
  Box,
  Button,
  Card,
  CardContent,
  MenuItem,
  Stack,
  Table,
  TableBody,
  TableCell,
  TableContainer,
  TableHead,
  TableRow,
  TextField,
  ToggleButton,
  ToggleButtonGroup,
  Typography,
  Link,
} from "@mui/material";
import Grid from "@mui/material/Grid2";
import MemoryIcon from "@mui/icons-material/Memory";
import StorageIcon from "@mui/icons-material/Storage";
import SpeedIcon from "@mui/icons-material/Speed";
import TimerOutlinedIcon from "@mui/icons-material/TimerOutlined";
import LanOutlinedIcon from "@mui/icons-material/LanOutlined";
import BugReportOutlinedIcon from "@mui/icons-material/BugReportOutlined";
import ErrorOutlineIcon from "@mui/icons-material/ErrorOutline";
import FileDownloadOutlinedIcon from "@mui/icons-material/FileDownloadOutlined";
import { Area, AreaChart, CartesianGrid, Legend, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import { api, cleanParams, downloadFile, errorMessage } from "../api/client";
import type { DeviceLog, Page } from "../api/types";
import PageHeader from "../components/common/PageHeader";
import StatCard from "../components/common/StatCard";
import StatusChip from "../components/common/StatusChip";
import ChartCard from "../components/common/ChartCard";
import Pager from "../components/common/Pager";
import { EmptyState, ErrorState, LoadingState } from "../components/common/States";
import { useNotify } from "../components/common/Notifier";
import { dayjs, fmtDateTime, fmtNumber, fmtUptime, toIsoEnd, toIsoStart } from "../utils/format";

interface Overview {
  avg_cpu_usage: number;
  avg_memory_usage: number;
  avg_storage_usage: number;
  avg_temperature_c: number;
  avg_latency_ms: number;
  avg_uptime_seconds: number;
  online_devices: number;
  total_devices: number;
  connectivity_pct: number;
  network: { network_type: string; connection_status: string; count: number }[];
  app_crashes_24h: number;
  device_errors_24h: number;
  high_cpu_devices: number;
  high_memory_devices: number;
}

interface HealthPoint {
  timestamp: string;
  cpu_usage: number;
  memory_usage: number;
  storage_usage: number;
  temperature_c: number;
  latency_ms: number;
  reporting_devices: number;
}

const EMPTY_FILTERS = { device_id: "", serial_number: "", severity: "", category: "", search: "", date_from: "", date_to: "" };

export default function MonitoringPage() {
  const navigate = useNavigate();
  const notify = useNotify();
  const [hours, setHours] = useState(24);
  const [metric, setMetric] = useState("cpu_usage");
  const [draft, setDraft] = useState(EMPTY_FILTERS);
  const [filters, setFilters] = useState(EMPTY_FILTERS);
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(25);

  const overview = useQuery({ queryKey: ["monitoring-overview"], queryFn: async () => (await api.get<Overview>("/monitoring/overview")).data, refetchInterval: 15000 });
  const history = useQuery({ queryKey: ["health-history", hours], queryFn: async () => (await api.get<HealthPoint[]>("/monitoring/health-history", { params: { hours } })).data });
  const top = useQuery({
    queryKey: ["top-devices", metric],
    queryFn: async () => (await api.get<{ device_id: string; serial_number: string; model: string; region: string; value: number; health_status: string }[]>("/monitoring/top-devices", { params: { metric } })).data,
    refetchInterval: 15000,
  });
  const logParams = cleanParams({
    ...filters,
    date_from: toIsoStart(filters.date_from),
    date_to: toIsoEnd(filters.date_to),
  });
  const logs = useQuery({
    queryKey: ["diagnostic-logs", logParams, page, pageSize],
    queryFn: async () => (await api.get<Page<DeviceLog>>("/monitoring/logs", { params: { ...logParams, page, page_size: pageSize } })).data,
    placeholderData: keepPreviousData,
  });
  const o = overview.data;
  const network = (type: string, status: string) => o?.network.find((n) => n.network_type === type && n.connection_status === status)?.count ?? 0;

  const apply = () => {
    setFilters(draft);
    setPage(1);
  };

  return (
    <Box data-testid="monitoring-page">
      <PageHeader title="Monitoring & Diagnostics" subtitle="Fleet resource utilisation, connectivity and diagnostic logs from simulated STB telemetry." />
      {overview.isError && <ErrorState error={overview.error} />}
      <Grid container spacing={2} sx={{ mb: 2 }}>
        <Grid size={{ xs: 6, md: 3, xl: 12 / 7 }}><StatCard testId="mon-cpu" label="Avg CPU usage" value={o ? `${o.avg_cpu_usage}%` : "—"} icon={<SpeedIcon />} loading={overview.isLoading} hint={o ? `${o.high_cpu_devices} devices above threshold` : undefined} /></Grid>
        <Grid size={{ xs: 6, md: 3, xl: 12 / 7 }}><StatCard testId="mon-memory" label="Avg memory usage" value={o ? `${o.avg_memory_usage}%` : "—"} icon={<MemoryIcon />} accent="#7b4fc4" loading={overview.isLoading} hint={o ? `${o.high_memory_devices} devices above threshold` : undefined} /></Grid>
        <Grid size={{ xs: 6, md: 3, xl: 12 / 7 }}><StatCard testId="mon-storage" label="Avg storage usage" value={o ? `${o.avg_storage_usage}%` : "—"} icon={<StorageIcon />} accent="#00a3c4" loading={overview.isLoading} /></Grid>
        <Grid size={{ xs: 6, md: 3, xl: 12 / 7 }}><StatCard testId="mon-uptime" label="Avg device uptime" value={o ? fmtUptime(o.avg_uptime_seconds) : "—"} icon={<TimerOutlinedIcon />} accent="#2e9d6a" loading={overview.isLoading} /></Grid>
        <Grid size={{ xs: 6, md: 4, xl: 12 / 7 }}><StatCard testId="mon-connectivity" label="Connectivity" value={o ? `${o.connectivity_pct}%` : "—"} icon={<LanOutlinedIcon />} accent="#1f4f8b" loading={overview.isLoading} hint={o ? `${fmtNumber(o.online_devices)} of ${fmtNumber(o.total_devices)} online` : undefined} /></Grid>
        <Grid size={{ xs: 6, md: 4, xl: 12 / 7 }}><StatCard testId="mon-crashes" label="App crashes (24h)" value={fmtNumber(o?.app_crashes_24h)} icon={<BugReportOutlinedIcon />} accent="#ed8a00" loading={overview.isLoading} /></Grid>
        <Grid size={{ xs: 12, md: 4, xl: 12 / 7 }}><StatCard testId="mon-errors" label="Device errors (24h)" value={fmtNumber(o?.device_errors_24h)} icon={<ErrorOutlineIcon />} accent="#c62828" loading={overview.isLoading} /></Grid>
      </Grid>
      <Grid container spacing={2} sx={{ mb: 2 }}>
        <Grid size={{ xs: 12, lg: 8 }}>
          <ChartCard
            title="Fleet health history"
            subtitle="Average utilisation across reporting devices"
            testId="chart-health-history"
            loading={history.isLoading}
            error={history.error}
            empty={!history.data?.length}
            height={300}
            action={
              <ToggleButtonGroup size="small" exclusive value={hours} onChange={(_, v) => v && setHours(v)}>
                <ToggleButton value={24}>24h</ToggleButton>
                <ToggleButton value={72}>3d</ToggleButton>
                <ToggleButton value={168}>7d</ToggleButton>
              </ToggleButtonGroup>
            }
          >
            <ResponsiveContainer>
              <AreaChart data={history.data?.map((p) => ({ ...p, t: dayjs(p.timestamp).format(hours > 24 ? "MMM D HH:00" : "HH:00") }))}>
                <CartesianGrid strokeDasharray="3 3" vertical={false} />
                <XAxis dataKey="t" fontSize={11} minTickGap={30} />
                <YAxis fontSize={11} domain={[0, 100]} />
                <Tooltip />
                <Legend />
                <Area type="monotone" dataKey="cpu_usage" name="CPU %" stroke="#1f5fa8" fill="#1f5fa8" fillOpacity={0.12} />
                <Area type="monotone" dataKey="memory_usage" name="Memory %" stroke="#e1251b" fill="#e1251b" fillOpacity={0.08} />
                <Area type="monotone" dataKey="storage_usage" name="Storage %" stroke="#2e9d6a" fill="#2e9d6a" fillOpacity={0.05} />
              </AreaChart>
            </ResponsiveContainer>
          </ChartCard>
        </Grid>
        <Grid size={{ xs: 12, lg: 4 }}>
          <Card sx={{ height: "100%" }} data-testid="network-status">
            <CardContent>
              <Typography variant="h6" sx={{ mb: 1 }}>Network status</Typography>
              <Table size="small">
                <TableHead>
                  <TableRow>
                    <TableCell>Interface</TableCell>
                    <TableCell align="right">Online</TableCell>
                    <TableCell align="right">Offline</TableCell>
                    <TableCell align="right">Rebooting</TableCell>
                  </TableRow>
                </TableHead>
                <TableBody>
                  {["ETHERNET", "WIFI"].map((t) => (
                    <TableRow key={t} data-testid={`network-row-${t.toLowerCase()}`}>
                      <TableCell>{t === "WIFI" ? "Wi-Fi" : "Ethernet"}</TableCell>
                      <TableCell align="right">{network(t, "ONLINE")}</TableCell>
                      <TableCell align="right">{network(t, "OFFLINE")}</TableCell>
                      <TableCell align="right">{network(t, "REBOOTING")}</TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
              <Stack spacing={0.5} sx={{ mt: 2 }}>
                <Typography variant="body2">Average latency: <b data-testid="mon-latency">{o?.avg_latency_ms ?? "—"} ms</b></Typography>
                <Typography variant="body2">Average SoC temperature: <b>{o?.avg_temperature_c ?? "—"} °C</b></Typography>
              </Stack>
            </CardContent>
          </Card>
        </Grid>
      </Grid>
      <Card sx={{ mb: 2 }} data-testid="top-devices">
        <CardContent>
          <Stack direction="row" justifyContent="space-between" sx={{ mb: 1 }}>
            <Typography variant="h6">Top devices by utilisation</Typography>
            <TextField select value={metric} onChange={(e) => setMetric(e.target.value)} sx={{ minWidth: 180 }} SelectProps={{ inputProps: { "data-testid": "top-metric" } }}>
              <MenuItem value="cpu_usage">CPU usage</MenuItem>
              <MenuItem value="memory_usage">Memory usage</MenuItem>
              <MenuItem value="storage_usage">Storage usage</MenuItem>
              <MenuItem value="temperature_c">Temperature</MenuItem>
              <MenuItem value="latency_ms">Latency</MenuItem>
            </TextField>
          </Stack>
          <Table size="small">
            <TableHead>
              <TableRow>
                <TableCell>Device ID</TableCell>
                <TableCell>Serial</TableCell>
                <TableCell>Model</TableCell>
                <TableCell>Region</TableCell>
                <TableCell align="right">Value</TableCell>
                <TableCell>Health</TableCell>
                <TableCell />
              </TableRow>
            </TableHead>
            <TableBody>
              {(top.data ?? []).map((d) => (
                <TableRow key={d.device_id} hover data-testid="top-device-row">
                  <TableCell sx={{ fontWeight: 600 }}>{d.device_id}</TableCell>
                  <TableCell>{d.serial_number}</TableCell>
                  <TableCell>{d.model}</TableCell>
                  <TableCell>{d.region}</TableCell>
                  <TableCell align="right">{d.value?.toFixed(1)}{metric === "temperature_c" ? " °C" : metric === "latency_ms" ? " ms" : "%"}</TableCell>
                  <TableCell><StatusChip value={d.health_status} /></TableCell>
                  <TableCell align="right">
                    <Link component="button" onClick={() => navigate(`/monitoring/devices/${d.device_id}`)} data-testid="open-device-diagnostics">
                      Diagnostics
                    </Link>
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </CardContent>
      </Card>
      <Card data-testid="diagnostic-logs">
        <CardContent>
          <Stack direction="row" justifyContent="space-between" alignItems="center" sx={{ mb: 2 }}>
            <Typography variant="h6">Diagnostic logs</Typography>
            <Button
              startIcon={<FileDownloadOutlinedIcon />}
              onClick={async () => {
                try {
                  await downloadFile("/monitoring/logs/export", logParams, "bell-stb-diagnostic-logs.csv");
                  notify("Diagnostic logs exported");
                } catch (e) {
                  notify(errorMessage(e, "Export failed"), "error");
                }
              }}
              data-testid="export-logs"
            >
              Export CSV
            </Button>
          </Stack>
          <Grid container spacing={1.5} sx={{ mb: 2 }}>
            <Grid size={{ xs: 12, sm: 6, md: 2 }}><TextField fullWidth label="Device ID" value={draft.device_id} onChange={(e) => setDraft({ ...draft, device_id: e.target.value })} inputProps={{ "data-testid": "log-filter-device" }} /></Grid>
            <Grid size={{ xs: 12, sm: 6, md: 2 }}><TextField fullWidth label="Serial number" value={draft.serial_number} onChange={(e) => setDraft({ ...draft, serial_number: e.target.value })} inputProps={{ "data-testid": "log-filter-serial" }} /></Grid>
            <Grid size={{ xs: 6, md: 1.5 }}>
              <TextField select fullWidth label="Severity" value={draft.severity} onChange={(e) => setDraft({ ...draft, severity: e.target.value })} SelectProps={{ inputProps: { "data-testid": "log-filter-severity" } }}>
                <MenuItem value="">All</MenuItem>
                {["INFO", "WARNING", "ERROR", "CRITICAL"].map((s) => <MenuItem key={s} value={s}>{s}</MenuItem>)}
              </TextField>
            </Grid>
            <Grid size={{ xs: 6, md: 1.5 }}>
              <TextField select fullWidth label="Category" value={draft.category} onChange={(e) => setDraft({ ...draft, category: e.target.value })} SelectProps={{ inputProps: { "data-testid": "log-filter-category" } }}>
                <MenuItem value="">All</MenuItem>
                {["SYSTEM", "NETWORK", "APPLICATION", "FIRMWARE", "HARDWARE", "SECURITY"].map((s) => <MenuItem key={s} value={s}>{s}</MenuItem>)}
              </TextField>
            </Grid>
            <Grid size={{ xs: 6, md: 1.5 }}><TextField fullWidth type="date" label="From" InputLabelProps={{ shrink: true }} value={draft.date_from} onChange={(e) => setDraft({ ...draft, date_from: e.target.value })} inputProps={{ "data-testid": "log-filter-from" }} /></Grid>
            <Grid size={{ xs: 6, md: 1.5 }}><TextField fullWidth type="date" label="To" InputLabelProps={{ shrink: true }} value={draft.date_to} onChange={(e) => setDraft({ ...draft, date_to: e.target.value })} inputProps={{ "data-testid": "log-filter-to" }} /></Grid>
            <Grid size={{ xs: 12, md: 2 }}>
              <Stack direction="row" spacing={1}>
                <Button variant="contained" onClick={apply} data-testid="log-filter-apply">Apply</Button>
                <Button onClick={() => { setDraft(EMPTY_FILTERS); setFilters(EMPTY_FILTERS); setPage(1); }} data-testid="log-filter-reset">Reset</Button>
              </Stack>
            </Grid>
          </Grid>
          {logs.isLoading ? (
            <LoadingState />
          ) : logs.isError ? (
            <ErrorState error={logs.error} />
          ) : !logs.data?.items.length ? (
            <EmptyState title="No log entries match the filters" />
          ) : (
            <>
              <Typography variant="caption" color="text.secondary" data-testid="log-total">{fmtNumber(logs.data.total)} entries</Typography>
              <TableContainer>
                <Table size="small" data-testid="diagnostic-logs-table">
                  <TableHead>
                    <TableRow>
                      <TableCell>Timestamp</TableCell>
                      <TableCell>Device ID</TableCell>
                      <TableCell>Serial</TableCell>
                      <TableCell>Severity</TableCell>
                      <TableCell>Category</TableCell>
                      <TableCell>Component</TableCell>
                      <TableCell>Message</TableCell>
                    </TableRow>
                  </TableHead>
                  <TableBody>
                    {logs.data.items.map((l) => (
                      <TableRow key={l.id} hover data-testid="diagnostic-log-row" data-severity={l.severity} data-device-id={l.device_id ?? ""} data-timestamp={l.created_at}>
                        <TableCell sx={{ whiteSpace: "nowrap", fontFamily: "monospace", fontSize: 12 }}>{fmtDateTime(l.created_at)}</TableCell>
                        <TableCell>
                          <Link component="button" onClick={() => navigate(`/monitoring/devices/${l.device_id}`)}>{l.device_id}</Link>
                        </TableCell>
                        <TableCell>{l.serial_number}</TableCell>
                        <TableCell><StatusChip value={l.severity} /></TableCell>
                        <TableCell>{l.category}</TableCell>
                        <TableCell sx={{ fontFamily: "monospace", fontSize: 12 }}>{l.component}</TableCell>
                        <TableCell data-testid="diagnostic-log-message">{l.message}</TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </TableContainer>
              <Pager total={logs.data.total} page={page} pageSize={pageSize} onPage={setPage} onPageSize={(s) => { setPageSize(s); setPage(1); }} testId="logs-pagination" />
            </>
          )}
        </CardContent>
      </Card>
    </Box>
  );
}
