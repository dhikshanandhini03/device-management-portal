import { useNavigate } from "react-router-dom";
import { useQuery } from "@tanstack/react-query";
import {
  Box,
  Card,
  CardContent,
  Chip,
  List,
  ListItem,
  ListItemText,
  Stack,
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableRow,
  Typography,
} from "@mui/material";
import Grid from "@mui/material/Grid2";
import DevicesOtherOutlinedIcon from "@mui/icons-material/DevicesOtherOutlined";
import WifiIcon from "@mui/icons-material/Wifi";
import WifiOffIcon from "@mui/icons-material/WifiOff";
import WarningAmberIcon from "@mui/icons-material/WarningAmber";
import ErrorOutlineIcon from "@mui/icons-material/ErrorOutline";
import SystemUpdateAltIcon from "@mui/icons-material/SystemUpdateAlt";
import {
  Area,
  AreaChart,
  Bar,
  BarChart,
  CartesianGrid,
  Cell,
  Legend,
  Pie,
  PieChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import { api } from "../api/client";
import type { Alert, LabelValue } from "../api/types";
import PageHeader from "../components/common/PageHeader";
import StatCard from "../components/common/StatCard";
import ChartCard from "../components/common/ChartCard";
import StatusChip from "../components/common/StatusChip";
import { EmptyState, ErrorState, LoadingState } from "../components/common/States";
import { CHART_COLORS } from "../theme";
import { dayjs, fmtNumber, fmtRelative, humanize } from "../utils/format";

interface Summary {
  total_devices: number;
  online_devices: number;
  offline_devices: number;
  rebooting_devices: number;
  warning_devices: number;
  critical_devices: number;
  healthy_devices: number;
  firmware_update_available: number;
  open_alerts: number;
  generated_at: string;
}

interface Charts {
  online_offline: LabelValue[];
  registration_trend: { timestamp: string; value: number }[];
  firmware_distribution: LabelValue[];
  model_distribution: LabelValue[];
  health_overview: LabelValue[];
  recent_events: { timestamp: string; INFO: number; WARNING: number; ERROR: number; CRITICAL: number }[];
}

interface DeviceRef {
  device_id: string;
  serial_number: string;
  model: string;
  region: string;
  timestamp: string;
}

interface Activity {
  recent_alerts: Alert[];
  recently_connected: DeviceRef[];
  recently_disconnected: DeviceRef[];
  recent_admin_activity: { id: number; username: string; action: string; target_id: string | null; result: string; created_at: string }[];
  recent_device_events: { id: number; device_id: string; event_type: string; severity: string; description: string; created_at: string }[];
  status_distribution: { connection_status: string; health_status: string; count: number }[];
}

const STATUS_COLORS: Record<string, string> = { Online: "#2e9d6a", Offline: "#8a96a8", Rebooting: "#0277bd", Healthy: "#2e9d6a", Warning: "#ed8a00", Critical: "#c62828" };

function DeviceList({ title, rows, testId, emptyText }: { title: string; rows: DeviceRef[]; testId: string; emptyText: string }) {
  const navigate = useNavigate();
  return (
    <Card sx={{ height: "100%" }} data-testid={testId}>
      <CardContent>
        <Typography variant="h6" sx={{ mb: 1 }}>
          {title}
        </Typography>
        {rows.length === 0 ? (
          <EmptyState title={emptyText} />
        ) : (
          <List dense disablePadding>
            {rows.map((r) => (
              <ListItem key={r.device_id + r.timestamp} disableGutters divider sx={{ cursor: "pointer" }} onClick={() => navigate(`/devices/${r.device_id}`)} data-testid={`${testId}-item`}>
                <ListItemText
                  primary={<Typography variant="body2" fontWeight={600}>{r.device_id}</Typography>}
                  secondary={`${r.model} · ${r.region}`}
                />
                <Typography variant="caption" color="text.secondary">
                  {fmtRelative(r.timestamp)}
                </Typography>
              </ListItem>
            ))}
          </List>
        )}
      </CardContent>
    </Card>
  );
}

export default function DashboardPage() {
  const navigate = useNavigate();
  const summary = useQuery({ queryKey: ["dashboard-summary"], queryFn: async () => (await api.get<Summary>("/dashboard/summary")).data, refetchInterval: 30000 });
  const charts = useQuery({ queryKey: ["dashboard-charts"], queryFn: async () => (await api.get<Charts>("/dashboard/charts")).data, refetchInterval: 60000 });
  const activity = useQuery({ queryKey: ["dashboard-activity"], queryFn: async () => (await api.get<Activity>("/dashboard/activity")).data, refetchInterval: 30000 });
  const s = summary.data;
  const c = charts.data;
  const a = activity.data;

  return (
    <Box data-testid="dashboard-page">
      <PageHeader
        title="Fleet Dashboard"
        subtitle={s ? `Live fleet overview · updated ${dayjs(s.generated_at).format("HH:mm:ss")}` : "Live fleet overview"}
        actions={<Chip label="Simulated data" size="small" variant="outlined" />}
      />
      {summary.isError && <ErrorState error={summary.error} onRetry={() => summary.refetch()} />}
      <Grid container spacing={2} sx={{ mb: 2 }}>
        {[
          { id: "stat-total-devices", label: "Total Registered Devices", value: s?.total_devices, icon: <DevicesOtherOutlinedIcon />, accent: "#1f4f8b", to: "/devices" },
          { id: "stat-online-devices", label: "Online Devices", value: s?.online_devices, icon: <WifiIcon />, accent: "#2e9d6a", to: "/devices?status=ONLINE" },
          { id: "stat-offline-devices", label: "Offline Devices", value: s?.offline_devices, icon: <WifiOffIcon />, accent: "#8a96a8", to: "/devices?status=OFFLINE" },
          { id: "stat-warning-devices", label: "Devices With Warnings", value: s?.warning_devices, icon: <WarningAmberIcon />, accent: "#ed8a00", to: "/devices?health=WARNING" },
          { id: "stat-critical-devices", label: "Critical Errors", value: s?.critical_devices, icon: <ErrorOutlineIcon />, accent: "#c62828", to: "/devices?health=CRITICAL" },
          { id: "stat-firmware-updates", label: "Firmware Update Available", value: s?.firmware_update_available, icon: <SystemUpdateAltIcon />, accent: "#e1251b", to: "/devices?update_available=true" },
        ].map((card) => (
          <Grid key={card.id} size={{ xs: 12, sm: 6, md: 4, xl: 2 }}>
            <StatCard testId={card.id} label={card.label} value={fmtNumber(card.value)} icon={card.icon} accent={card.accent} loading={summary.isLoading} onClick={() => navigate(card.to)} />
          </Grid>
        ))}
      </Grid>

      <Grid container spacing={2}>
        <Grid size={{ xs: 12, md: 4 }}>
          <ChartCard title="Online vs Offline Devices" testId="chart-online-offline" loading={charts.isLoading} error={charts.error} onRetry={() => charts.refetch()}>
            <ResponsiveContainer>
              <PieChart>
                <Pie data={c?.online_offline.filter((x) => x.value > 0) ?? []} dataKey="value" nameKey="label" innerRadius={60} outerRadius={95} paddingAngle={2}>
                  {(c?.online_offline.filter((x) => x.value > 0) ?? []).map((e) => (
                    <Cell key={e.label} fill={STATUS_COLORS[e.label] ?? "#999"} />
                  ))}
                </Pie>
                <Tooltip />
                <Legend />
              </PieChart>
            </ResponsiveContainer>
          </ChartCard>
        </Grid>
        <Grid size={{ xs: 12, md: 8 }}>
          <ChartCard title="Device Registration Trend" subtitle="New devices registered per month (last 12 months)" testId="chart-registration-trend" loading={charts.isLoading} error={charts.error} empty={!c?.registration_trend.length}>
            <ResponsiveContainer>
              <AreaChart data={c?.registration_trend.map((p) => ({ month: dayjs(p.timestamp).format("MMM YY"), devices: p.value }))}>
                <CartesianGrid strokeDasharray="3 3" vertical={false} />
                <XAxis dataKey="month" fontSize={11} />
                <YAxis fontSize={11} allowDecimals={false} />
                <Tooltip />
                <Area type="monotone" dataKey="devices" stroke="#1f5fa8" fill="#1f5fa8" fillOpacity={0.15} strokeWidth={2} />
              </AreaChart>
            </ResponsiveContainer>
          </ChartCard>
        </Grid>
        <Grid size={{ xs: 12, md: 6 }}>
          <ChartCard title="Firmware Version Distribution" testId="chart-firmware-distribution" loading={charts.isLoading} error={charts.error}>
            <ResponsiveContainer>
              <BarChart data={c?.firmware_distribution} layout="vertical" margin={{ left: 20 }}>
                <CartesianGrid strokeDasharray="3 3" horizontal={false} />
                <XAxis type="number" fontSize={11} allowDecimals={false} />
                <YAxis type="category" dataKey="label" fontSize={11} width={70} />
                <Tooltip />
                <Bar dataKey="value" name="Devices" fill="#1f5fa8" radius={[0, 3, 3, 0]} />
              </BarChart>
            </ResponsiveContainer>
          </ChartCard>
        </Grid>
        <Grid size={{ xs: 12, md: 6 }}>
          <ChartCard title="Device Model Distribution" testId="chart-model-distribution" loading={charts.isLoading} error={charts.error}>
            <ResponsiveContainer>
              <PieChart>
                <Pie data={c?.model_distribution ?? []} dataKey="value" nameKey="label" outerRadius={90}>
                  {(c?.model_distribution ?? []).map((e, i) => (
                    <Cell key={e.label} fill={CHART_COLORS[i % CHART_COLORS.length]} />
                  ))}
                </Pie>
                <Tooltip />
                <Legend layout="vertical" align="right" verticalAlign="middle" wrapperStyle={{ fontSize: 12 }} />
              </PieChart>
            </ResponsiveContainer>
          </ChartCard>
        </Grid>
        <Grid size={{ xs: 12, md: 4 }}>
          <ChartCard title="Device Health Overview" testId="chart-health-overview" loading={charts.isLoading} error={charts.error}>
            <ResponsiveContainer>
              <BarChart data={c?.health_overview}>
                <CartesianGrid strokeDasharray="3 3" vertical={false} />
                <XAxis dataKey="label" fontSize={11} />
                <YAxis fontSize={11} allowDecimals={false} />
                <Tooltip />
                <Bar dataKey="value" name="Devices" radius={[3, 3, 0, 0]}>
                  {(c?.health_overview ?? []).map((e) => (
                    <Cell key={e.label} fill={STATUS_COLORS[e.label]} />
                  ))}
                </Bar>
              </BarChart>
            </ResponsiveContainer>
          </ChartCard>
        </Grid>
        <Grid size={{ xs: 12, md: 8 }}>
          <ChartCard title="Recent Device Events" subtitle="Events per hour by severity (last 24 hours)" testId="chart-recent-events" loading={charts.isLoading} error={charts.error} empty={!c?.recent_events.length}>
            <ResponsiveContainer>
              <BarChart data={c?.recent_events.map((e) => ({ ...e, hour: dayjs(e.timestamp).format("HH:00") }))}>
                <CartesianGrid strokeDasharray="3 3" vertical={false} />
                <XAxis dataKey="hour" fontSize={11} />
                <YAxis fontSize={11} allowDecimals={false} />
                <Tooltip />
                <Legend wrapperStyle={{ fontSize: 12 }} />
                <Bar dataKey="INFO" stackId="a" fill="#0277bd" name="Info" />
                <Bar dataKey="WARNING" stackId="a" fill="#ed8a00" name="Warning" />
                <Bar dataKey="ERROR" stackId="a" fill="#e1251b" name="Error" />
                <Bar dataKey="CRITICAL" stackId="a" fill="#7a1010" name="Critical" />
              </BarChart>
            </ResponsiveContainer>
          </ChartCard>
        </Grid>

        <Grid size={{ xs: 12, lg: 6 }}>
          <Card data-testid="recent-alerts" sx={{ height: "100%" }}>
            <CardContent>
              <Stack direction="row" justifyContent="space-between" alignItems="center" sx={{ mb: 1 }}>
                <Typography variant="h6">Recent Alerts</Typography>
                <Chip label={`${fmtNumber(s?.open_alerts)} open`} size="small" color="secondary" onClick={() => navigate("/alerts")} />
              </Stack>
              {activity.isLoading ? (
                <LoadingState />
              ) : activity.isError ? (
                <ErrorState error={activity.error} />
              ) : !a?.recent_alerts.length ? (
                <EmptyState title="No open alerts" />
              ) : (
                <Table size="small">
                  <TableBody>
                    {a.recent_alerts.map((al) => (
                      <TableRow key={al.id} hover sx={{ cursor: "pointer" }} onClick={() => navigate(`/devices/${al.device_id}`)} data-testid="recent-alert-row">
                        <TableCell width={90}>
                          <StatusChip value={al.severity} />
                        </TableCell>
                        <TableCell>
                          <Typography variant="body2" fontWeight={600}>
                            {al.title}
                          </Typography>
                          <Typography variant="caption" color="text.secondary">
                            {al.device_id} · {al.description}
                          </Typography>
                        </TableCell>
                        <TableCell align="right" sx={{ whiteSpace: "nowrap" }}>
                          <Typography variant="caption">{fmtRelative(al.created_at)}</Typography>
                        </TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              )}
            </CardContent>
          </Card>
        </Grid>
        <Grid size={{ xs: 12, lg: 6 }}>
          <Card data-testid="recent-device-activity" sx={{ height: "100%" }}>
            <CardContent>
              <Typography variant="h6" sx={{ mb: 1 }}>
                Recent Device Activity
              </Typography>
              {activity.isLoading ? (
                <LoadingState />
              ) : !a?.recent_device_events.length ? (
                <EmptyState title="No recent events" />
              ) : (
                <Table size="small">
                  <TableBody>
                    {a.recent_device_events.map((e) => (
                      <TableRow key={e.id} hover data-testid="recent-device-event-row">
                        <TableCell width={150}>
                          <Typography variant="body2" fontWeight={600}>
                            {e.device_id}
                          </Typography>
                        </TableCell>
                        <TableCell>
                          <Typography variant="body2">{humanize(e.event_type)}</Typography>
                          <Typography variant="caption" color="text.secondary">
                            {e.description}
                          </Typography>
                        </TableCell>
                        <TableCell align="right" sx={{ whiteSpace: "nowrap" }}>
                          <Typography variant="caption">{fmtRelative(e.created_at)}</Typography>
                        </TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              )}
            </CardContent>
          </Card>
        </Grid>
        <Grid size={{ xs: 12, md: 6, lg: 4 }}>
          <DeviceList title="Recently Connected" rows={a?.recently_connected ?? []} testId="recently-connected" emptyText="No recent connections" />
        </Grid>
        <Grid size={{ xs: 12, md: 6, lg: 4 }}>
          <DeviceList title="Recently Disconnected" rows={a?.recently_disconnected ?? []} testId="recently-disconnected" emptyText="No recent disconnections" />
        </Grid>
        <Grid size={{ xs: 12, lg: 4 }}>
          <Card data-testid="recent-admin-activity" sx={{ height: "100%" }}>
            <CardContent>
              <Typography variant="h6" sx={{ mb: 1 }}>
                Recent Administrative Activity
              </Typography>
              {!a?.recent_admin_activity.length ? (
                <EmptyState title="No administrative activity" />
              ) : (
                <List dense disablePadding>
                  {a.recent_admin_activity.map((x) => (
                    <ListItem key={x.id} disableGutters divider>
                      <ListItemText
                        primary={<Typography variant="body2" fontWeight={600}>{humanize(x.action)}</Typography>}
                        secondary={`${x.username}${x.target_id ? ` → ${x.target_id}` : ""}`}
                      />
                      <Stack alignItems="flex-end" spacing={0.25}>
                        <StatusChip value={x.result} />
                        <Typography variant="caption" color="text.secondary">
                          {fmtRelative(x.created_at)}
                        </Typography>
                      </Stack>
                    </ListItem>
                  ))}
                </List>
              )}
            </CardContent>
          </Card>
        </Grid>
        <Grid size={12}>
          <Card data-testid="status-distribution">
            <CardContent>
              <Typography variant="h6" sx={{ mb: 1 }}>
                Device Status Distribution
              </Typography>
              <Table size="small">
                <TableHead>
                  <TableRow>
                    <TableCell>Connection</TableCell>
                    <TableCell>Healthy</TableCell>
                    <TableCell>Warning</TableCell>
                    <TableCell>Critical</TableCell>
                    <TableCell>Total</TableCell>
                  </TableRow>
                </TableHead>
                <TableBody>
                  {["ONLINE", "OFFLINE", "REBOOTING"].map((cs) => {
                    const rows = a?.status_distribution.filter((r) => r.connection_status === cs) ?? [];
                    const get = (h: string) => rows.find((r) => r.health_status === h)?.count ?? 0;
                    return (
                      <TableRow key={cs}>
                        <TableCell>
                          <StatusChip value={cs} />
                        </TableCell>
                        <TableCell>{get("HEALTHY")}</TableCell>
                        <TableCell>{get("WARNING")}</TableCell>
                        <TableCell>{get("CRITICAL")}</TableCell>
                        <TableCell sx={{ fontWeight: 600 }}>{rows.reduce((t, r) => t + r.count, 0)}</TableCell>
                      </TableRow>
                    );
                  })}
                </TableBody>
              </Table>
            </CardContent>
          </Card>
        </Grid>
      </Grid>
    </Box>
  );
}
