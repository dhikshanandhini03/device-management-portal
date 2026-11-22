import { useState } from "react";
import { Link as RouterLink } from "react-router-dom";
import { keepPreviousData, useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  Box,
  Button,
  Card,
  CardContent,
  Chip,
  Dialog,
  DialogActions,
  DialogContent,
  DialogTitle,
  InputAdornment,
  Link,
  MenuItem,
  Stack,
  Table,
  TableBody,
  TableCell,
  TableContainer,
  TableHead,
  TableRow,
  TextField,
  Typography,
} from "@mui/material";
import Grid from "@mui/material/Grid2";
import SearchIcon from "@mui/icons-material/Search";
import FileDownloadOutlinedIcon from "@mui/icons-material/FileDownloadOutlined";
import { api, cleanParams, downloadFile, errorMessage } from "../api/client";
import type { Alert, Page } from "../api/types";
import PageHeader from "../components/common/PageHeader";
import StatCard from "../components/common/StatCard";
import StatusChip from "../components/common/StatusChip";
import Pager from "../components/common/Pager";
import ConfirmDialog from "../components/common/ConfirmDialog";
import KeyValueGrid from "../components/common/KeyValueGrid";
import { EmptyState, ErrorState, LoadingState } from "../components/common/States";
import { useNotify } from "../components/common/Notifier";
import { useAuth } from "../auth/AuthContext";
import { fmtDateTime, fmtRelative, humanize } from "../utils/format";

interface Summary {
  open: number;
  acknowledged: number;
  resolved: number;
  critical_active: number;
  warning_active: number;
  info_active: number;
  by_category: { category: string; count: number }[];
}

const CATEGORIES = ["DEVICE_OFFLINE", "HIGH_CPU", "HIGH_MEMORY", "FIRMWARE_UPDATE", "APP_CRASH", "NETWORK_DISCONNECT", "CRITICAL_ERROR"];
const STATUS_OPTIONS = [
  { value: "OPEN,ACKNOWLEDGED", label: "Active (open + acknowledged)" },
  { value: "OPEN", label: "Open" },
  { value: "ACKNOWLEDGED", label: "Acknowledged" },
  { value: "RESOLVED", label: "Resolved" },
  { value: "", label: "All statuses" },
];

export default function AlertsPage() {
  const { can } = useAuth();
  const notify = useNotify();
  const qc = useQueryClient();
  const [filters, setFilters] = useState({ severity: "", status: "OPEN,ACKNOWLEDGED", category: "", search: "" });
  const [searchInput, setSearchInput] = useState("");
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(25);
  const [resolveTarget, setResolveTarget] = useState<Alert | null>(null);
  const [note, setNote] = useState("");
  const [detail, setDetail] = useState<Alert | null>(null);
  const [error, setError] = useState<string | null>(null);
  const manage = can("alerts:manage");

  const summary = useQuery({ queryKey: ["alert-summary"], queryFn: async () => (await api.get<Summary>("/alerts/summary")).data, refetchInterval: 15000 });
  const alerts = useQuery({
    queryKey: ["alerts", filters, page, pageSize],
    queryFn: async () => (await api.get<Page<Alert>>("/alerts", { params: cleanParams({ ...filters, page, page_size: pageSize }) })).data,
    placeholderData: keepPreviousData,
    refetchInterval: 15000,
  });

  const refresh = () => {
    qc.invalidateQueries({ queryKey: ["alerts"] });
    qc.invalidateQueries({ queryKey: ["alert-summary"] });
    qc.invalidateQueries({ queryKey: ["topbar-alerts"] });
  };
  const ack = useMutation({
    mutationFn: async (a: Alert) => (await api.post<Alert>(`/alerts/${a.alert_code}/acknowledge`)).data,
    onSuccess: (a) => {
      notify(`Alert ${a.alert_code} acknowledged`);
      refresh();
    },
    onError: (e) => notify(errorMessage(e, "Acknowledge failed"), "error"),
  });
  const resolve = useMutation({
    mutationFn: async (a: Alert) => (await api.post<Alert>(`/alerts/${a.alert_code}/resolve`, { note: note || null })).data,
    onSuccess: (a) => {
      notify(`Alert ${a.alert_code} resolved`);
      setResolveTarget(null);
      refresh();
    },
    onError: (e) => setError(errorMessage(e, "Resolve failed")),
  });
  const set = (patch: Partial<typeof filters>) => {
    setFilters((f) => ({ ...f, ...patch }));
    setPage(1);
  };
  const s = summary.data;

  return (
    <Box data-testid="alerts-page">
      <PageHeader
        title="Alerts & Notifications"
        subtitle="Operational alerts raised from simulated device telemetry and events."
        actions={
          <Button
            startIcon={<FileDownloadOutlinedIcon />}
            onClick={async () => {
              try {
                await downloadFile("/alerts/export", cleanParams(filters), "bell-stb-alerts.csv");
                notify("Alerts exported");
              } catch (e) {
                notify(errorMessage(e, "Export failed"), "error");
              }
            }}
            data-testid="export-alerts"
          >
            Export CSV
          </Button>
        }
      />
      <Grid container spacing={2} sx={{ mb: 2 }}>
        <Grid size={{ xs: 6, md: 2.4 }}><StatCard testId="alerts-open" label="Open" value={s?.open ?? "—"} accent="#c62828" loading={summary.isLoading} onClick={() => set({ status: "OPEN" })} /></Grid>
        <Grid size={{ xs: 6, md: 2.4 }}><StatCard testId="alerts-acknowledged" label="Acknowledged" value={s?.acknowledged ?? "—"} accent="#ed8a00" loading={summary.isLoading} onClick={() => set({ status: "ACKNOWLEDGED" })} /></Grid>
        <Grid size={{ xs: 6, md: 2.4 }}><StatCard testId="alerts-resolved" label="Resolved" value={s?.resolved ?? "—"} accent="#2e9d6a" loading={summary.isLoading} onClick={() => set({ status: "RESOLVED" })} /></Grid>
        <Grid size={{ xs: 6, md: 2.4 }}><StatCard testId="alerts-critical" label="Critical (active)" value={s?.critical_active ?? "—"} accent="#7a1010" loading={summary.isLoading} onClick={() => set({ severity: "CRITICAL", status: "OPEN,ACKNOWLEDGED" })} /></Grid>
        <Grid size={{ xs: 12, md: 2.4 }}><StatCard testId="alerts-warning" label="Warning (active)" value={s?.warning_active ?? "—"} accent="#ed8a00" loading={summary.isLoading} onClick={() => set({ severity: "WARNING", status: "OPEN,ACKNOWLEDGED" })} /></Grid>
      </Grid>
      <Card>
        <CardContent>
          <Stack direction="row" spacing={1.5} sx={{ mb: 2 }} flexWrap="wrap" useFlexGap>
            <TextField
              placeholder="Search device ID, serial or alert ID"
              value={searchInput}
              onChange={(e) => setSearchInput(e.target.value)}
              onKeyDown={(e) => e.key === "Enter" && set({ search: searchInput.trim() })}
              onBlur={() => searchInput.trim() !== filters.search && set({ search: searchInput.trim() })}
              sx={{ minWidth: 280 }}
              inputProps={{ "data-testid": "alert-search" }}
              InputProps={{ startAdornment: <InputAdornment position="start"><SearchIcon fontSize="small" /></InputAdornment> }}
            />
            <TextField select label="Severity" value={filters.severity} onChange={(e) => set({ severity: e.target.value })} sx={{ minWidth: 150 }} SelectProps={{ inputProps: { "data-testid": "alert-severity-filter" } }}>
              <MenuItem value="">All severities</MenuItem>
              {["CRITICAL", "WARNING", "INFO"].map((v) => <MenuItem key={v} value={v}>{humanize(v)}</MenuItem>)}
            </TextField>
            <TextField select label="Status" value={filters.status} onChange={(e) => set({ status: e.target.value })} sx={{ minWidth: 230 }} SelectProps={{ inputProps: { "data-testid": "alert-status-filter" } }}>
              {STATUS_OPTIONS.map((o) => <MenuItem key={o.label} value={o.value}>{o.label}</MenuItem>)}
            </TextField>
            <TextField select label="Category" value={filters.category} onChange={(e) => set({ category: e.target.value })} sx={{ minWidth: 200 }} SelectProps={{ inputProps: { "data-testid": "alert-category-filter" } }}>
              <MenuItem value="">All categories</MenuItem>
              {CATEGORIES.map((v) => <MenuItem key={v} value={v}>{humanize(v)}</MenuItem>)}
            </TextField>
          </Stack>
          {alerts.isLoading ? (
            <LoadingState />
          ) : alerts.isError ? (
            <ErrorState error={alerts.error} onRetry={() => alerts.refetch()} />
          ) : !alerts.data?.items.length ? (
            <EmptyState title="No alerts match the filters" />
          ) : (
            <>
              <Typography variant="caption" color="text.secondary" data-testid="alerts-total">{alerts.data.total} alerts</Typography>
              <TableContainer>
                <Table size="small" data-testid="alerts-table">
                  <TableHead>
                    <TableRow>
                      <TableCell>Alert ID</TableCell>
                      <TableCell>Severity</TableCell>
                      <TableCell>Category</TableCell>
                      <TableCell>Device</TableCell>
                      <TableCell>Description</TableCell>
                      <TableCell>Created</TableCell>
                      <TableCell>Status</TableCell>
                      <TableCell align="right">Actions</TableCell>
                    </TableRow>
                  </TableHead>
                  <TableBody>
                    {alerts.data.items.map((a) => (
                      <TableRow key={a.id} hover data-testid="alert-row" data-alert-code={a.alert_code} data-severity={a.severity} data-status={a.status} sx={{ cursor: "pointer" }} onClick={() => setDetail(a)}>
                        <TableCell sx={{ fontFamily: "monospace", fontWeight: 600 }}>{a.alert_code}</TableCell>
                        <TableCell><StatusChip value={a.severity} testId="alert-severity" /></TableCell>
                        <TableCell>{humanize(a.category)}</TableCell>
                        <TableCell onClick={(e) => e.stopPropagation()}>
                          <Link component={RouterLink} to={`/devices/${a.device_id}`} underline="hover" data-testid="alert-device">{a.device_id}</Link>
                          <Typography variant="caption" display="block" color="text.secondary">{a.serial_number}</Typography>
                        </TableCell>
                        <TableCell sx={{ maxWidth: 320 }}>
                          <Typography variant="body2" fontWeight={600}>{a.title}</Typography>
                          <Typography variant="caption" color="text.secondary">{a.description}</Typography>
                        </TableCell>
                        <TableCell sx={{ whiteSpace: "nowrap" }} title={fmtDateTime(a.created_at)}>{fmtRelative(a.created_at)}</TableCell>
                        <TableCell><StatusChip value={a.status} testId="alert-status" /></TableCell>
                        <TableCell align="right" onClick={(e) => e.stopPropagation()} sx={{ whiteSpace: "nowrap" }}>
                          {manage && a.status === "OPEN" && (
                            <Button size="small" onClick={() => ack.mutate(a)} disabled={ack.isPending} data-testid="alert-acknowledge">
                              Acknowledge
                            </Button>
                          )}
                          {manage && a.status !== "RESOLVED" && (
                            <Button size="small" color="success" onClick={() => { setNote(""); setError(null); setResolveTarget(a); }} data-testid="alert-resolve">
                              Resolve
                            </Button>
                          )}
                        </TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </TableContainer>
              <Pager total={alerts.data.total} page={page} pageSize={pageSize} onPage={setPage} onPageSize={(v) => { setPageSize(v); setPage(1); }} testId="alerts-pagination" />
            </>
          )}
        </CardContent>
      </Card>
      <ConfirmDialog
        open={!!resolveTarget}
        title={`Resolve ${resolveTarget?.alert_code ?? ""}?`}
        message={`${resolveTarget?.title ?? ""} on ${resolveTarget?.device_id ?? ""}`}
        confirmLabel="Resolve alert"
        loading={resolve.isPending}
        error={error}
        onConfirm={() => resolveTarget && resolve.mutate(resolveTarget)}
        onClose={() => setResolveTarget(null)}
        testId="resolve-dialog"
      >
        <TextField fullWidth multiline minRows={2} sx={{ mt: 2 }} label="Resolution note (optional)" value={note} onChange={(e) => setNote(e.target.value)} inputProps={{ "data-testid": "resolve-note", maxLength: 1000 }} />
      </ConfirmDialog>
      <Dialog open={!!detail} onClose={() => setDetail(null)} maxWidth="sm" fullWidth data-testid="alert-detail-dialog">
        <DialogTitle>
          {detail?.alert_code} <Chip size="small" label={humanize(detail?.category)} sx={{ ml: 1 }} />
        </DialogTitle>
        <DialogContent>
          {detail && (
            <KeyValueGrid
              columns={2}
              items={[
                { label: "Device", value: detail.device_id },
                { label: "Severity", value: <StatusChip value={detail.severity} /> },
                { label: "Status", value: <StatusChip value={detail.status} /> },
                { label: "Created", value: fmtDateTime(detail.created_at) },
                { label: "Acknowledged", value: detail.acknowledged_at ? `${fmtDateTime(detail.acknowledged_at)} by ${detail.acknowledged_by ?? "system"}` : "—", testId: "alert-history-ack" },
                { label: "Resolved", value: detail.resolved_at ? `${fmtDateTime(detail.resolved_at)} by ${detail.resolved_by ?? "system"}` : "—", testId: "alert-history-resolved" },
                { label: "Description", value: detail.description },
                { label: "Resolution note", value: detail.resolution_note ?? "—" },
              ]}
            />
          )}
        </DialogContent>
        <DialogActions>
          <Button onClick={() => setDetail(null)}>Close</Button>
        </DialogActions>
      </Dialog>
    </Box>
  );
}
