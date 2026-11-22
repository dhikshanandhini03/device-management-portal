import { useParams, useNavigate } from "react-router-dom";
import { useQuery } from "@tanstack/react-query";
import { Box, Button, Card, CardContent, Table, TableBody, TableCell, TableHead, TableRow, Typography } from "@mui/material";
import Grid from "@mui/material/Grid2";
import { CartesianGrid, Legend, Line, LineChart, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import { api } from "../api/client";
import type { DeviceDetail, TelemetryPoint } from "../api/types";
import PageHeader from "../components/common/PageHeader";
import StatusChip from "../components/common/StatusChip";
import KeyValueGrid from "../components/common/KeyValueGrid";
import ChartCard from "../components/common/ChartCard";
import { EmptyState, ErrorState, LoadingState } from "../components/common/States";
import { dayjs, fmtDateTime, fmtRelative, fmtUptime } from "../utils/format";

interface Diagnostics {
  device: DeviceDetail;
  checks: { check: string; result: "PASS" | "WARN" | "FAIL"; value: string; detail: string }[];
  app_crashes_24h: number;
  recent_errors: { id: number; severity: string; category: string; component: string; message: string; created_at: string }[];
}

const RESULT_STATUS: Record<string, string> = { PASS: "SUCCESS", WARN: "WARNING", FAIL: "FAILED" };

export default function DeviceDiagnosticsPage() {
  const { deviceId = "" } = useParams();
  const navigate = useNavigate();
  const q = useQuery({ queryKey: ["diagnostics", deviceId], queryFn: async () => (await api.get<Diagnostics>(`/monitoring/devices/${deviceId}/diagnostics`)).data, refetchInterval: 10000 });
  const telemetry = useQuery({
    queryKey: ["device-telemetry", deviceId, 24],
    queryFn: async () => (await api.get<{ points: TelemetryPoint[] }>(`/devices/${deviceId}/telemetry`, { params: { hours: 24 } })).data,
  });
  if (q.isLoading) return <LoadingState />;
  if (q.isError || !q.data) return <ErrorState error={q.error} title="Diagnostics unavailable" />;
  const { device: d, checks, recent_errors } = q.data;
  return (
    <Box data-testid="device-diagnostics-page">
      <PageHeader
        title={`Diagnostics · ${d.device_id}`}
        crumbs={[{ label: "Monitoring & Diagnostics", to: "/monitoring" }, { label: d.device_id }]}
        subtitle={`${d.model} · ${d.serial_number} · last seen ${fmtRelative(d.last_seen_at)}`}
        actions={<Button variant="outlined" onClick={() => navigate(`/devices/${d.device_id}`)} data-testid="open-device-details">Device details</Button>}
      />
      <Grid container spacing={2}>
        <Grid size={{ xs: 12, lg: 5 }}>
          <Card sx={{ height: "100%" }} data-testid="diagnostic-checks">
            <CardContent>
              <Typography variant="h6" sx={{ mb: 1 }}>Health checks</Typography>
              <Table size="small">
                <TableBody>
                  {checks.map((c) => (
                    <TableRow key={c.check} data-testid="diagnostic-check-row" data-result={c.result}>
                      <TableCell sx={{ fontWeight: 600 }}>{c.check}</TableCell>
                      <TableCell>{c.value}</TableCell>
                      <TableCell><StatusChip value={RESULT_STATUS[c.result]} /></TableCell>
                      <TableCell><Typography variant="caption" color="text.secondary">{c.detail}</Typography></TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </CardContent>
          </Card>
        </Grid>
        <Grid size={{ xs: 12, lg: 7 }}>
          <Card sx={{ height: "100%" }}>
            <CardContent>
              <Typography variant="h6" sx={{ mb: 2 }}>Current state</Typography>
              <KeyValueGrid
                columns={3}
                items={[
                  { label: "Connectivity", value: <StatusChip value={d.connection_status} />, testId: "diag-status" },
                  { label: "Health", value: <StatusChip value={d.health_status} /> },
                  { label: "Uptime", value: fmtUptime(d.uptime_seconds), testId: "diag-uptime" },
                  { label: "CPU", value: `${d.cpu_usage.toFixed(1)}%`, testId: "diag-cpu" },
                  { label: "Memory", value: `${d.memory_usage.toFixed(1)}%`, testId: "diag-memory" },
                  { label: "Storage", value: `${d.storage_usage.toFixed(1)}%`, testId: "diag-storage" },
                  { label: "Temperature", value: d.temperature_c !== null ? `${d.temperature_c.toFixed(1)} °C` : "—" },
                  { label: "Network", value: `${d.network_type === "WIFI" ? "Wi-Fi" : "Ethernet"} · ${d.latency_ms.toFixed(0)} ms`, testId: "diag-network" },
                  { label: "App crashes (24h)", value: q.data.app_crashes_24h, testId: "diag-crashes" },
                  { label: "Firmware", value: d.firmware_version },
                  { label: "Open alerts", value: d.open_alerts },
                  { label: "Last boot", value: fmtDateTime(d.last_boot_at) },
                ]}
              />
            </CardContent>
          </Card>
        </Grid>
        <Grid size={12}>
          <ChartCard title="Telemetry (24 hours)" testId="diag-telemetry-chart" loading={telemetry.isLoading} error={telemetry.error} empty={!telemetry.data?.points.length} height={280}>
            <ResponsiveContainer>
              <LineChart data={telemetry.data?.points.map((p) => ({ ...p, t: dayjs(p.timestamp).format("HH:mm") }))}>
                <CartesianGrid strokeDasharray="3 3" vertical={false} />
                <XAxis dataKey="t" fontSize={11} minTickGap={30} />
                <YAxis fontSize={11} />
                <Tooltip />
                <Legend />
                <Line dataKey="cpu_usage" name="CPU %" stroke="#1f5fa8" dot={false} strokeWidth={2} />
                <Line dataKey="memory_usage" name="Memory %" stroke="#e1251b" dot={false} strokeWidth={2} />
                <Line dataKey="latency_ms" name="Latency ms" stroke="#f2a516" dot={false} />
              </LineChart>
            </ResponsiveContainer>
          </ChartCard>
        </Grid>
        <Grid size={12}>
          <Card data-testid="diag-recent-errors">
            <CardContent>
              <Typography variant="h6" sx={{ mb: 1 }}>Recent errors</Typography>
              {!recent_errors.length ? (
                <EmptyState title="No errors reported" />
              ) : (
                <Table size="small">
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
                    {recent_errors.map((e) => (
                      <TableRow key={e.id} data-testid="diag-error-row">
                        <TableCell sx={{ whiteSpace: "nowrap" }}>{fmtDateTime(e.created_at)}</TableCell>
                        <TableCell><StatusChip value={e.severity} /></TableCell>
                        <TableCell>{e.category}</TableCell>
                        <TableCell>{e.component}</TableCell>
                        <TableCell>{e.message}</TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              )}
            </CardContent>
          </Card>
        </Grid>
      </Grid>
    </Box>
  );
}
