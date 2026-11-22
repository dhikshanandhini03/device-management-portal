import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Box, Button, Card, MenuItem, Stack, TextField, ToggleButton, ToggleButtonGroup } from "@mui/material";
import Grid from "@mui/material/Grid2";
import FileDownloadOutlinedIcon from "@mui/icons-material/FileDownloadOutlined";
import {
  Area,
  AreaChart,
  Bar,
  BarChart,
  CartesianGrid,
  Cell,
  Legend,
  Line,
  LineChart,
  Pie,
  PieChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import { api, downloadFile, errorMessage } from "../api/client";
import PageHeader from "../components/common/PageHeader";
import StatCard from "../components/common/StatCard";
import ChartCard from "../components/common/ChartCard";
import { ErrorState } from "../components/common/States";
import { useNotify } from "../components/common/Notifier";
import { CHART_COLORS } from "../theme";
import { dayjs, fmtNumber, toIsoEnd, toIsoStart } from "../utils/format";

interface Report {
  summary: {
    total_devices: number;
    new_registrations: number;
    avg_availability_pct: number;
    failure_events: number;
    commands_executed: number;
    command_success_pct: number;
  };
  availability: { date: string; online: number; offline: number; total: number; availability_pct: number }[];
  registrations: { date: string; registrations: number }[];
  firmware: { version: string; model: string; is_latest: boolean; devices: number }[];
  models: { model: string; devices: number; online: number; avg_cpu: number; avg_memory: number }[];
  uptime: { distribution: { bucket: string; devices: number }[]; by_model: { model: string; avg_uptime_hours: number }[] };
  failures: { date: string; app_crashes: number; critical_errors: number; disconnections: number; operation_failures: number }[];
  applications: { application: string; installations: number; usage_hours_7d: number; crashes_7d: number }[];
  activity: ({ date: string; total: number } & Record<string, number | string>)[];
}

const REPORTS = [
  { value: "availability", label: "Device availability" },
  { value: "registrations", label: "Registrations" },
  { value: "firmware", label: "Firmware distribution" },
  { value: "models", label: "Device models" },
  { value: "uptime", label: "Device uptime" },
  { value: "failures", label: "Failure trends" },
  { value: "applications", label: "Application usage" },
  { value: "activity", label: "Device activity" },
];

const d = (v: string) => dayjs(v).format("MMM D");

export default function AnalyticsPage() {
  const notify = useNotify();
  const [from, setFrom] = useState(dayjs().subtract(30, "day").format("YYYY-MM-DD"));
  const [to, setTo] = useState(dayjs().format("YYYY-MM-DD"));
  const [report, setReport] = useState("availability");
  const [exporting, setExporting] = useState(false);
  const invalid = !from || !to || dayjs(from).isAfter(dayjs(to));
  const range = { date_from: toIsoStart(from), date_to: toIsoEnd(to) };

  const q = useQuery({
    queryKey: ["analytics", from, to],
    queryFn: async () => (await api.get<Report>("/analytics/report", { params: range })).data,
    enabled: !invalid,
  });
  const r = q.data;
  const preset = (days: number) => {
    setFrom(dayjs().subtract(days, "day").format("YYYY-MM-DD"));
    setTo(dayjs().format("YYYY-MM-DD"));
  };
  const presetValue = to === dayjs().format("YYYY-MM-DD") ? [7, 30, 90].find((n) => from === dayjs().subtract(n, "day").format("YYYY-MM-DD")) ?? null : null;

  const exportReport = async () => {
    setExporting(true);
    try {
      await downloadFile("/analytics/export", { report, ...range }, `bell-stb-${report}-report.csv`);
      notify("Report exported");
    } catch (e) {
      notify(errorMessage(e, "Export failed"), "error");
    } finally {
      setExporting(false);
    }
  };

  const loading = q.isLoading;
  return (
    <Box data-testid="analytics-page">
      <PageHeader title="Analytics & Reports" subtitle="Fleet trends aggregated from the device database (simulated data)." />
      <Card sx={{ p: 2, mb: 2 }}>
        <Stack direction={{ xs: "column", md: "row" }} spacing={1.5} alignItems={{ md: "center" }} justifyContent="space-between">
          <Stack direction="row" spacing={1.5} alignItems="center" flexWrap="wrap" useFlexGap>
            <ToggleButtonGroup size="small" exclusive value={presetValue} onChange={(_, v) => v && preset(v)}>
              <ToggleButton value={7} data-testid="range-7d">7 days</ToggleButton>
              <ToggleButton value={30} data-testid="range-30d">30 days</ToggleButton>
              <ToggleButton value={90} data-testid="range-90d">90 days</ToggleButton>
            </ToggleButtonGroup>
            <TextField type="date" label="From" InputLabelProps={{ shrink: true }} value={from} onChange={(e) => setFrom(e.target.value)} error={invalid} inputProps={{ "data-testid": "analytics-from" }} />
            <TextField type="date" label="To" InputLabelProps={{ shrink: true }} value={to} onChange={(e) => setTo(e.target.value)} error={invalid} helperText={invalid ? "From must be before To" : undefined} inputProps={{ "data-testid": "analytics-to" }} />
          </Stack>
          <Stack direction="row" spacing={1.5} alignItems="center">
            <TextField select label="Report" value={report} onChange={(e) => setReport(e.target.value)} sx={{ minWidth: 200 }} SelectProps={{ inputProps: { "data-testid": "report-type" } }}>
              {REPORTS.map((x) => <MenuItem key={x.value} value={x.value}>{x.label}</MenuItem>)}
            </TextField>
            <Button variant="contained" startIcon={<FileDownloadOutlinedIcon />} onClick={exportReport} disabled={exporting || invalid} data-testid="export-report">
              Export CSV
            </Button>
          </Stack>
        </Stack>
      </Card>
      {q.isError && <ErrorState error={q.error} onRetry={() => q.refetch()} />}
      <Grid container spacing={2} sx={{ mb: 2 }}>
        <Grid size={{ xs: 6, md: 2 }}><StatCard testId="an-total" label="Total fleet" value={fmtNumber(r?.summary.total_devices)} loading={loading} /></Grid>
        <Grid size={{ xs: 6, md: 2 }}><StatCard testId="an-registrations" label="New registrations" value={fmtNumber(r?.summary.new_registrations)} loading={loading} accent="#00a3c4" /></Grid>
        <Grid size={{ xs: 6, md: 2 }}><StatCard testId="an-availability" label="Avg availability" value={r ? `${r.summary.avg_availability_pct}%` : "—"} loading={loading} accent="#2e9d6a" /></Grid>
        <Grid size={{ xs: 6, md: 2 }}><StatCard testId="an-failures" label="Failure events" value={fmtNumber(r?.summary.failure_events)} loading={loading} accent="#c62828" /></Grid>
        <Grid size={{ xs: 6, md: 2 }}><StatCard testId="an-commands" label="Commands executed" value={fmtNumber(r?.summary.commands_executed)} loading={loading} accent="#7b4fc4" /></Grid>
        <Grid size={{ xs: 6, md: 2 }}><StatCard testId="an-command-success" label="Command success" value={r ? `${r.summary.command_success_pct}%` : "—"} loading={loading} accent="#e1251b" /></Grid>
      </Grid>
      <Grid container spacing={2}>
        <Grid size={{ xs: 12, lg: 8 }}>
          <ChartCard title="Online / offline trend" subtitle="Daily average device counts" testId="chart-availability" loading={loading} empty={!r?.availability.length}>
            <ResponsiveContainer>
              <AreaChart data={r?.availability.map((x) => ({ ...x, day: d(x.date) }))}>
                <CartesianGrid strokeDasharray="3 3" vertical={false} />
                <XAxis dataKey="day" fontSize={11} minTickGap={20} />
                <YAxis fontSize={11} />
                <Tooltip />
                <Legend />
                <Area type="monotone" dataKey="online" stackId="1" name="Online" stroke="#2e9d6a" fill="#2e9d6a" fillOpacity={0.35} />
                <Area type="monotone" dataKey="offline" stackId="1" name="Offline" stroke="#8a96a8" fill="#8a96a8" fillOpacity={0.35} />
              </AreaChart>
            </ResponsiveContainer>
          </ChartCard>
        </Grid>
        <Grid size={{ xs: 12, lg: 4 }}>
          <ChartCard title="Availability %" testId="chart-availability-pct" loading={loading} empty={!r?.availability.length}>
            <ResponsiveContainer>
              <LineChart data={r?.availability.map((x) => ({ ...x, day: d(x.date) }))}>
                <CartesianGrid strokeDasharray="3 3" vertical={false} />
                <XAxis dataKey="day" fontSize={11} minTickGap={20} />
                <YAxis fontSize={11} domain={[70, 100]} />
                <Tooltip />
                <Line type="monotone" dataKey="availability_pct" name="Availability %" stroke="#1f5fa8" dot={false} strokeWidth={2} />
              </LineChart>
            </ResponsiveContainer>
          </ChartCard>
        </Grid>
        <Grid size={{ xs: 12, md: 6 }}>
          <ChartCard title="Firmware distribution" testId="chart-an-firmware" loading={loading} empty={!r?.firmware.length}>
            <ResponsiveContainer>
              <BarChart data={r?.firmware.slice(0, 12).map((x) => ({ ...x, label: `${x.version}` }))}>
                <CartesianGrid strokeDasharray="3 3" vertical={false} />
                <XAxis dataKey="label" fontSize={10} interval={0} angle={-30} textAnchor="end" height={50} />
                <YAxis fontSize={11} />
                <Tooltip />
                <Bar dataKey="devices" name="Devices" radius={[3, 3, 0, 0]}>
                  {(r?.firmware.slice(0, 12) ?? []).map((x) => <Cell key={x.model + x.version} fill={x.is_latest ? "#2e9d6a" : "#1f5fa8"} />)}
                </Bar>
              </BarChart>
            </ResponsiveContainer>
          </ChartCard>
        </Grid>
        <Grid size={{ xs: 12, md: 6 }}>
          <ChartCard title="Device model distribution" testId="chart-an-models" loading={loading} empty={!r?.models.length}>
            <ResponsiveContainer>
              <PieChart>
                <Pie data={r?.models ?? []} dataKey="devices" nameKey="model" outerRadius={95} label={({ value }) => value}>
                  {(r?.models ?? []).map((m, i) => <Cell key={m.model} fill={CHART_COLORS[i % CHART_COLORS.length]} />)}
                </Pie>
                <Tooltip />
                <Legend layout="vertical" align="right" verticalAlign="middle" wrapperStyle={{ fontSize: 12 }} />
              </PieChart>
            </ResponsiveContainer>
          </ChartCard>
        </Grid>
        <Grid size={{ xs: 12, md: 6 }}>
          <ChartCard title="Device uptime" subtitle="Online devices by time since last boot" testId="chart-an-uptime" loading={loading}>
            <ResponsiveContainer>
              <BarChart data={r?.uptime.distribution}>
                <CartesianGrid strokeDasharray="3 3" vertical={false} />
                <XAxis dataKey="bucket" fontSize={11} />
                <YAxis fontSize={11} />
                <Tooltip />
                <Bar dataKey="devices" name="Devices" fill="#00a3c4" radius={[3, 3, 0, 0]} />
              </BarChart>
            </ResponsiveContainer>
          </ChartCard>
        </Grid>
        <Grid size={{ xs: 12, md: 6 }}>
          <ChartCard title="Device failure trends" testId="chart-an-failures" loading={loading} empty={!r?.failures.length}>
            <ResponsiveContainer>
              <BarChart data={r?.failures.map((x) => ({ ...x, day: d(x.date) }))}>
                <CartesianGrid strokeDasharray="3 3" vertical={false} />
                <XAxis dataKey="day" fontSize={11} minTickGap={20} />
                <YAxis fontSize={11} />
                <Tooltip />
                <Legend wrapperStyle={{ fontSize: 12 }} />
                <Bar dataKey="app_crashes" stackId="a" name="App crashes" fill="#ed8a00" />
                <Bar dataKey="critical_errors" stackId="a" name="Critical errors" fill="#c62828" />
                <Bar dataKey="operation_failures" stackId="a" name="Operation failures" fill="#7b4fc4" />
              </BarChart>
            </ResponsiveContainer>
          </ChartCard>
        </Grid>
        <Grid size={{ xs: 12, md: 6 }}>
          <ChartCard title="Application usage (last 7 days)" testId="chart-an-applications" loading={loading} empty={!r?.applications.length} height={300}>
            <ResponsiveContainer>
              <BarChart data={r?.applications} layout="vertical" margin={{ left: 30 }}>
                <CartesianGrid strokeDasharray="3 3" horizontal={false} />
                <XAxis type="number" fontSize={11} />
                <YAxis type="category" dataKey="application" fontSize={11} width={110} />
                <Tooltip />
                <Bar dataKey="usage_hours_7d" name="Viewing hours" fill="#1f5fa8" />
              </BarChart>
            </ResponsiveContainer>
          </ChartCard>
        </Grid>
        <Grid size={{ xs: 12, md: 6 }}>
          <ChartCard title="Device activity trend" testId="chart-an-activity" loading={loading} empty={!r?.activity.length} height={300}>
            <ResponsiveContainer>
              <LineChart data={r?.activity.map((x) => ({ ...x, day: d(String(x.date)) }))}>
                <CartesianGrid strokeDasharray="3 3" vertical={false} />
                <XAxis dataKey="day" fontSize={11} minTickGap={20} />
                <YAxis fontSize={11} />
                <Tooltip />
                <Legend wrapperStyle={{ fontSize: 12 }} />
                <Line dataKey="total" name="All events" stroke="#1f5fa8" dot={false} strokeWidth={2} />
                <Line dataKey="REBOOT" name="Reboots" stroke="#2e9d6a" dot={false} />
                <Line dataKey="DISCONNECTED" name="Disconnections" stroke="#e1251b" dot={false} />
              </LineChart>
            </ResponsiveContainer>
          </ChartCard>
        </Grid>
        <Grid size={12}>
          <ChartCard title="Device registrations" testId="chart-an-registrations" loading={loading} empty={!r?.registrations.length} height={220}>
            <ResponsiveContainer>
              <BarChart data={r?.registrations.map((x) => ({ ...x, day: d(x.date) }))}>
                <CartesianGrid strokeDasharray="3 3" vertical={false} />
                <XAxis dataKey="day" fontSize={11} minTickGap={20} />
                <YAxis fontSize={11} allowDecimals={false} />
                <Tooltip />
                <Bar dataKey="registrations" name="Registrations" fill="#e1251b" />
              </BarChart>
            </ResponsiveContainer>
          </ChartCard>
        </Grid>
      </Grid>
    </Box>
  );
}
