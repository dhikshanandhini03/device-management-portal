import { ChangeEvent, useMemo, useState } from "react";
import { useNavigate, useSearchParams } from "react-router-dom";
import { keepPreviousData, useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  Box,
  Button,
  Card,
  Chip,
  Dialog,
  DialogActions,
  DialogContent,
  DialogTitle,
  IconButton,
  InputAdornment,
  LinearProgress,
  MenuItem,
  Stack,
  Table,
  TableBody,
  TableCell,
  TableContainer,
  TableHead,
  TableRow,
  TableSortLabel,
  TextField,
  Tooltip,
  Typography,
  Alert,
} from "@mui/material";
import Grid from "@mui/material/Grid2";
import SearchIcon from "@mui/icons-material/Search";
import FileDownloadOutlinedIcon from "@mui/icons-material/FileDownloadOutlined";
import FilterAltOffOutlinedIcon from "@mui/icons-material/FilterAltOffOutlined";
import VisibilityOutlinedIcon from "@mui/icons-material/VisibilityOutlined";
import SettingsRemoteOutlinedIcon from "@mui/icons-material/SettingsRemoteOutlined";
import AddIcon from "@mui/icons-material/Add";
import { api, cleanParams, downloadFile, errorMessage } from "../api/client";
import type { Device, DeviceDetail, Page } from "../api/types";
import PageHeader from "../components/common/PageHeader";
import StatusChip from "../components/common/StatusChip";
import Pager from "../components/common/Pager";
import { EmptyState, ErrorState, LoadingState } from "../components/common/States";
import { useNotify } from "../components/common/Notifier";
import { useAuth } from "../auth/AuthContext";
import { fmtDateTime, fmtNumber, fmtRelative } from "../utils/format";

interface Filters {
  models: string[];
  firmware_versions: string[];
  regions: string[];
}

const COLUMNS: { id: string; label: string; sortable?: boolean }[] = [
  { id: "device_id", label: "Device ID", sortable: true },
  { id: "serial_number", label: "Serial Number", sortable: true },
  { id: "mac_address", label: "MAC Address", sortable: true },
  { id: "model", label: "Model", sortable: true },
  { id: "hardware_version", label: "HW", sortable: true },
  { id: "firmware_version", label: "Firmware", sortable: true },
  { id: "ip_address", label: "IP Address", sortable: true },
  { id: "connection_status", label: "Status", sortable: true },
  { id: "last_seen_at", label: "Last Seen", sortable: true },
  { id: "customer_ref", label: "Account", sortable: true },
  { id: "region", label: "Region", sortable: true },
  { id: "actions", label: "Actions" },
];

function RegisterDeviceDialog({ open, onClose, models, regions }: { open: boolean; onClose: () => void; models: string[]; regions: string[] }) {
  const notify = useNotify();
  const navigate = useNavigate();
  const qc = useQueryClient();
  const empty = { serial_number: "", mac_address: "", model: "", hardware_version: "", ip_address: "", customer_ref: "", region: "", city: "", simulation_profile: "STANDARD", initial_status: "OFFLINE" };
  const [form, setForm] = useState(empty);
  const [error, setError] = useState<string | null>(null);
  const set = (k: keyof typeof empty) => (e: ChangeEvent<HTMLInputElement>) => setForm((f) => ({ ...f, [k]: e.target.value }));
  const mutation = useMutation({
    mutationFn: async () => (await api.post<DeviceDetail>("/devices", form)).data,
    onSuccess: (d) => {
      notify(`Device ${d.device_id} registered`);
      qc.invalidateQueries({ queryKey: ["devices"] });
      setForm(empty);
      onClose();
      navigate(`/devices/${d.device_id}`);
    },
    onError: (e) => setError(errorMessage(e, "Registration failed")),
  });
  const valid = Object.values(form).every((v) => v.trim() !== "");
  return (
    <Dialog open={open} onClose={onClose} maxWidth="sm" fullWidth data-testid="register-device-dialog">
      <DialogTitle>Register device</DialogTitle>
      <DialogContent>
        <Grid container spacing={2} sx={{ mt: 0.5 }}>
          <Grid size={6}><TextField fullWidth label="Serial number" value={form.serial_number} onChange={set("serial_number")} inputProps={{ "data-testid": "reg-serial" }} helperText="8-20 uppercase letters/digits" /></Grid>
          <Grid size={6}><TextField fullWidth label="MAC address" value={form.mac_address} onChange={set("mac_address")} inputProps={{ "data-testid": "reg-mac" }} helperText="AA:BB:CC:DD:EE:FF" /></Grid>
          <Grid size={6}>
            <TextField select fullWidth label="Model" value={form.model} onChange={set("model")} SelectProps={{ inputProps: { "data-testid": "reg-model" } }}>
              {models.map((m) => <MenuItem key={m} value={m}>{m}</MenuItem>)}
            </TextField>
          </Grid>
          <Grid size={6}><TextField fullWidth label="Hardware version" value={form.hardware_version} onChange={set("hardware_version")} inputProps={{ "data-testid": "reg-hw" }} /></Grid>
          <Grid size={6}><TextField fullWidth label="IP address" value={form.ip_address} onChange={set("ip_address")} inputProps={{ "data-testid": "reg-ip" }} /></Grid>
          <Grid size={6}><TextField fullWidth label="Customer account" value={form.customer_ref} onChange={set("customer_ref")} inputProps={{ "data-testid": "reg-account" }} /></Grid>
          <Grid size={6}>
            <TextField select fullWidth label="Region" value={form.region} onChange={set("region")} SelectProps={{ inputProps: { "data-testid": "reg-region" } }}>
              {regions.map((m) => <MenuItem key={m} value={m}>{m}</MenuItem>)}
            </TextField>
          </Grid>
          <Grid size={6}><TextField fullWidth label="City" value={form.city} onChange={set("city")} inputProps={{ "data-testid": "reg-city" }} /></Grid>
          <Grid size={6}>
            <TextField select fullWidth label="Simulation profile" value={form.simulation_profile} onChange={set("simulation_profile")}>
              <MenuItem value="STANDARD">Standard (random behaviour)</MenuItem>
              <MenuItem value="STABLE_ONLINE">Stable online (lab device)</MenuItem>
              <MenuItem value="STABLE_OFFLINE">Stable offline</MenuItem>
            </TextField>
          </Grid>
          <Grid size={6}>
            <TextField select fullWidth label="Initial status" value={form.initial_status} onChange={set("initial_status")}>
              <MenuItem value="OFFLINE">Offline (awaiting first heartbeat)</MenuItem>
              <MenuItem value="ONLINE">Online</MenuItem>
            </TextField>
          </Grid>
        </Grid>
        {error && <Alert severity="error" sx={{ mt: 2 }} data-testid="register-device-error">{error}</Alert>}
      </DialogContent>
      <DialogActions sx={{ px: 3, pb: 2 }}>
        <Button onClick={onClose}>Cancel</Button>
        <Button variant="contained" disabled={!valid || mutation.isPending} onClick={() => { setError(null); mutation.mutate(); }} data-testid="register-device-submit">
          Register
        </Button>
      </DialogActions>
    </Dialog>
  );
}

export default function DeviceInventoryPage() {
  const navigate = useNavigate();
  const notify = useNotify();
  const { can } = useAuth();
  const [params, setParams] = useSearchParams();
  const [searchInput, setSearchInput] = useState(params.get("search") ?? "");
  const [exporting, setExporting] = useState(false);
  const [registerOpen, setRegisterOpen] = useState(false);

  const q = useMemo(
    () => ({
      search: params.get("search") ?? "",
      status: params.get("status") ?? "",
      model: params.get("model") ?? "",
      firmware: params.get("firmware") ?? "",
      region: params.get("region") ?? "",
      health: params.get("health") ?? "",
      update_available: params.get("update_available") ?? "",
      sort_by: params.get("sort_by") ?? "device_id",
      sort_dir: (params.get("sort_dir") ?? "asc") as "asc" | "desc",
      page: Number(params.get("page") ?? 1),
      page_size: Number(params.get("page_size") ?? 25),
    }),
    [params],
  );

  const update = (patch: Record<string, string | number | undefined>, resetPage = true) => {
    const next = new URLSearchParams(params);
    for (const [k, v] of Object.entries(patch)) {
      if (v === undefined || v === "") next.delete(k);
      else next.set(k, String(v));
    }
    if (resetPage && !("page" in patch)) next.delete("page");
    setParams(next);
  };

  const filters = useQuery({ queryKey: ["device-filters"], queryFn: async () => (await api.get<Filters>("/devices/filters")).data, staleTime: 300000 });
  const devices = useQuery({
    queryKey: ["devices", q],
    queryFn: async () => (await api.get<Page<Device>>("/devices", { params: cleanParams(q) })).data,
    placeholderData: keepPreviousData,
    refetchInterval: 30000,
  });

  const hasFilters = !!(q.search || q.status || q.model || q.firmware || q.region || q.health || q.update_available);

  const exportCsv = async () => {
    setExporting(true);
    try {
      const { page: _p, page_size: _s, ...rest } = q;
      await downloadFile("/devices/export", cleanParams(rest), "bell-stb-devices.csv");
      notify("Device inventory exported");
    } catch (e) {
      notify(errorMessage(e, "Export failed"), "error");
    } finally {
      setExporting(false);
    }
  };

  const select = (key: string, label: string, options: string[], testId: string, labels?: Record<string, string>) => (
    <TextField
      select
      label={label}
      value={(q as Record<string, unknown>)[key] as string}
      onChange={(e) => update({ [key]: e.target.value })}
      sx={{ minWidth: 150 }}
      SelectProps={{ inputProps: { "data-testid": testId } }}
    >
      <MenuItem value="">All</MenuItem>
      {options.map((o) => (
        <MenuItem key={o} value={o}>
          {labels?.[o] ?? o}
        </MenuItem>
      ))}
    </TextField>
  );

  return (
    <Box data-testid="device-inventory-page">
      <PageHeader
        title="Device Inventory"
        subtitle={devices.data ? `${fmtNumber(devices.data.total)} devices match the current filters · simulated fleet data` : "Registered set-top boxes"}
        actions={
          <>
            {can("devices:manage") && (
              <Button variant="outlined" startIcon={<AddIcon />} onClick={() => setRegisterOpen(true)} data-testid="register-device-button">
                Register device
              </Button>
            )}
            <Button variant="contained" startIcon={<FileDownloadOutlinedIcon />} onClick={exportCsv} disabled={exporting} data-testid="export-csv">
              {exporting ? "Exporting…" : "Export CSV"}
            </Button>
          </>
        }
      />
      <Card sx={{ p: 2, mb: 2 }}>
        <Stack direction="row" spacing={1.5} flexWrap="wrap" useFlexGap alignItems="center">
          <TextField
            placeholder="Search serial, MAC, device ID, account, IP"
            value={searchInput}
            onChange={(e) => setSearchInput(e.target.value)}
            onKeyDown={(e) => e.key === "Enter" && update({ search: searchInput.trim() })}
            onBlur={() => searchInput.trim() !== q.search && update({ search: searchInput.trim() })}
            sx={{ minWidth: 320, flex: 1 }}
            inputProps={{ "data-testid": "device-search", "aria-label": "Search devices" }}
            InputProps={{ startAdornment: <InputAdornment position="start"><SearchIcon fontSize="small" /></InputAdornment> }}
          />
          {select("status", "Status", ["ONLINE", "OFFLINE", "REBOOTING"], "filter-status", { ONLINE: "Online", OFFLINE: "Offline", REBOOTING: "Rebooting" })}
          {select("model", "Model", filters.data?.models ?? [], "filter-model")}
          {select("firmware", "Firmware", filters.data?.firmware_versions ?? [], "filter-firmware")}
          {select("region", "Region", filters.data?.regions ?? [], "filter-region")}
          {select("health", "Health", ["HEALTHY", "WARNING", "CRITICAL"], "filter-health", { HEALTHY: "Healthy", WARNING: "Warning", CRITICAL: "Critical" })}
          <Button
            startIcon={<FilterAltOffOutlinedIcon />}
            disabled={!hasFilters}
            onClick={() => {
              setSearchInput("");
              setParams(new URLSearchParams());
            }}
            data-testid="clear-filters"
          >
            Clear filters
          </Button>
        </Stack>
        {q.update_available && (
          <Chip sx={{ mt: 1.5 }} label="Firmware update available" onDelete={() => update({ update_available: "" })} size="small" />
        )}
      </Card>

      <Card>
        {devices.isFetching && <LinearProgress sx={{ height: 2 }} />}
        {devices.isLoading ? (
          <LoadingState label="Loading device inventory…" />
        ) : devices.isError ? (
          <Box sx={{ p: 2 }}>
            <ErrorState error={devices.error} onRetry={() => devices.refetch()} />
          </Box>
        ) : devices.data && devices.data.items.length === 0 ? (
          <EmptyState title="No devices found" description="Try adjusting the search or filters." />
        ) : (
          <>
            <TableContainer>
              <Table size="small" data-testid="devices-table">
                <TableHead>
                  <TableRow>
                    {COLUMNS.map((c) => (
                      <TableCell key={c.id} sortDirection={q.sort_by === c.id ? q.sort_dir : false}>
                        {c.sortable ? (
                          <TableSortLabel
                            active={q.sort_by === c.id}
                            direction={q.sort_by === c.id ? q.sort_dir : "asc"}
                            onClick={() => update({ sort_by: c.id, sort_dir: q.sort_by === c.id && q.sort_dir === "asc" ? "desc" : "asc" })}
                            data-testid={`sort-${c.id}`}
                          >
                            {c.label}
                          </TableSortLabel>
                        ) : (
                          c.label
                        )}
                      </TableCell>
                    ))}
                  </TableRow>
                </TableHead>
                <TableBody>
                  {devices.data?.items.map((d) => (
                    <TableRow key={d.id} hover sx={{ cursor: "pointer" }} onClick={() => navigate(`/devices/${d.device_id}`)} data-testid="device-row" data-device-id={d.device_id}>
                      <TableCell sx={{ fontWeight: 600, color: "primary.main" }} data-testid="cell-device-id">{d.device_id}</TableCell>
                      <TableCell data-testid="cell-serial">{d.serial_number}</TableCell>
                      <TableCell sx={{ fontFamily: "monospace" }} data-testid="cell-mac">{d.mac_address}</TableCell>
                      <TableCell data-testid="cell-model">{d.model}</TableCell>
                      <TableCell>{d.hardware_version}</TableCell>
                      <TableCell data-testid="cell-firmware">
                        <Stack direction="row" spacing={0.5} alignItems="center">
                          <span>{d.firmware_version}</span>
                          {d.update_available && (
                            <Tooltip title={`Update ${d.latest_firmware_version} available`}>
                              <Box component="span" sx={{ width: 7, height: 7, borderRadius: "50%", bgcolor: "secondary.main", display: "inline-block" }} />
                            </Tooltip>
                          )}
                        </Stack>
                      </TableCell>
                      <TableCell sx={{ fontFamily: "monospace" }}>{d.ip_address}</TableCell>
                      <TableCell data-testid="cell-status">
                        <StatusChip value={d.connection_status} />
                      </TableCell>
                      <TableCell>
                        <Tooltip title={fmtDateTime(d.last_seen_at)}>
                          <Typography variant="body2" component="span" data-testid="cell-last-seen" data-value={d.last_seen_at ?? ""}>{fmtRelative(d.last_seen_at)}</Typography>
                        </Tooltip>
                      </TableCell>
                      <TableCell>{d.customer_ref}</TableCell>
                      <TableCell data-testid="cell-region">{d.region}</TableCell>
                      <TableCell onClick={(e) => e.stopPropagation()} sx={{ whiteSpace: "nowrap" }}>
                        <Tooltip title="View details">
                          <IconButton size="small" onClick={() => navigate(`/devices/${d.device_id}`)} data-testid="action-view" aria-label={`View ${d.device_id}`}>
                            <VisibilityOutlinedIcon fontSize="small" />
                          </IconButton>
                        </Tooltip>
                        <Tooltip title="Remote operations">
                          <IconButton size="small" onClick={() => navigate(`/device-management?device=${d.device_id}`)} data-testid="action-remote" aria-label={`Remote operations for ${d.device_id}`}>
                            <SettingsRemoteOutlinedIcon fontSize="small" />
                          </IconButton>
                        </Tooltip>
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </TableContainer>
            <Pager total={devices.data?.total ?? 0} page={q.page} pageSize={q.page_size} onPage={(p) => update({ page: p }, false)} onPageSize={(s) => update({ page_size: s })} />
          </>
        )}
      </Card>
      {registerOpen && (
        <RegisterDeviceDialog open={registerOpen} onClose={() => setRegisterOpen(false)} models={filters.data?.models ?? []} regions={filters.data?.regions ?? []} />
      )}
    </Box>
  );
}
