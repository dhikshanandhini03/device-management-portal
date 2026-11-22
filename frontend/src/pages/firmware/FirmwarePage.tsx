import { useState } from "react";
import { useNavigate, useSearchParams } from "react-router-dom";
import { keepPreviousData, useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  Alert,
  Box,
  Button,
  Card,
  CardContent,
  Checkbox,
  Chip,
  Dialog,
  DialogActions,
  DialogContent,
  DialogTitle,
  FormControlLabel,
  InputAdornment,
  LinearProgress,
  MenuItem,
  Radio,
  RadioGroup,
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
  Typography,
} from "@mui/material";
import Grid from "@mui/material/Grid2";
import AddIcon from "@mui/icons-material/Add";
import SearchIcon from "@mui/icons-material/Search";
import { Bar, BarChart, CartesianGrid, ResponsiveContainer, Tooltip, XAxis, YAxis, Legend } from "recharts";
import { api, cleanParams, errorMessage } from "../../api/client";
import type { Deployment, Device, Firmware, Page } from "../../api/types";
import PageHeader from "../../components/common/PageHeader";
import StatusChip from "../../components/common/StatusChip";
import Pager from "../../components/common/Pager";
import ChartCard from "../../components/common/ChartCard";
import { EmptyState, ErrorState, LoadingState } from "../../components/common/States";
import { useNotify } from "../../components/common/Notifier";
import { useAuth } from "../../auth/AuthContext";
import { dayjs, fmtDate, fmtDateTime, fmtNumber, humanize } from "../../utils/format";

function InventoryTab() {
  const [search, setSearch] = useState("");
  const [model, setModel] = useState("");
  const [status, setStatus] = useState("");
  const q = useQuery({
    queryKey: ["firmware", search, model, status],
    queryFn: async () => (await api.get<Firmware[]>("/firmware", { params: cleanParams({ search, model, status }) })).data,
    placeholderData: keepPreviousData,
  });
  const models = Array.from(new Set((q.data ?? []).map((f) => f.model))).sort();
  return (
    <Card>
      <CardContent>
        <Stack direction="row" spacing={1.5} sx={{ mb: 2 }} flexWrap="wrap" useFlexGap>
          <TextField placeholder="Search version or model" value={search} onChange={(e) => setSearch(e.target.value)} inputProps={{ "data-testid": "firmware-search" }} InputProps={{ startAdornment: <InputAdornment position="start"><SearchIcon fontSize="small" /></InputAdornment> }} sx={{ minWidth: 260 }} />
          <TextField select label="Model" value={model} onChange={(e) => setModel(e.target.value)} sx={{ minWidth: 220 }} SelectProps={{ inputProps: { "data-testid": "firmware-model-filter" } }}>
            <MenuItem value="">All models</MenuItem>
            {models.map((m) => <MenuItem key={m} value={m}>{m}</MenuItem>)}
          </TextField>
          <TextField select label="Status" value={status} onChange={(e) => setStatus(e.target.value)} sx={{ minWidth: 150 }} SelectProps={{ inputProps: { "data-testid": "firmware-status-filter" } }}>
            <MenuItem value="">All</MenuItem>
            {["ACTIVE", "BETA", "DEPRECATED"].map((s) => <MenuItem key={s} value={s}>{humanize(s)}</MenuItem>)}
          </TextField>
        </Stack>
        {q.isLoading ? (
          <LoadingState />
        ) : q.isError ? (
          <ErrorState error={q.error} />
        ) : !q.data?.length ? (
          <EmptyState title="No firmware versions match" />
        ) : (
          <TableContainer>
            <Table size="small" data-testid="firmware-table">
              <TableHead>
                <TableRow>
                  <TableCell>Version</TableCell>
                  <TableCell>Model</TableCell>
                  <TableCell>OS</TableCell>
                  <TableCell>Release date</TableCell>
                  <TableCell>Size</TableCell>
                  <TableCell>Status</TableCell>
                  <TableCell align="right">Devices</TableCell>
                  <TableCell>Release notes</TableCell>
                </TableRow>
              </TableHead>
              <TableBody>
                {q.data.map((f) => (
                  <TableRow key={f.id} hover data-testid="firmware-row" data-version={f.version} data-model={f.model}>
                    <TableCell sx={{ fontWeight: 600 }} data-testid="cell-fw-version">
                      {f.version} {f.is_latest && <Chip label="Latest" size="small" color="secondary" sx={{ ml: 0.5, height: 18 }} />}
                    </TableCell>
                    <TableCell data-testid="cell-fw-model">{f.model}</TableCell>
                    <TableCell>{f.os_version}</TableCell>
                    <TableCell>{fmtDate(f.release_date)}</TableCell>
                    <TableCell>{f.file_size_mb.toFixed(0)} MB</TableCell>
                    <TableCell data-testid="cell-fw-status"><StatusChip value={f.status} /></TableCell>
                    <TableCell align="right" data-testid="cell-fw-devices">{fmtNumber(f.device_count)}</TableCell>
                    <TableCell sx={{ maxWidth: 360 }}><Typography variant="caption">{f.release_notes}</Typography></TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </TableContainer>
        )}
      </CardContent>
    </Card>
  );
}

function DistributionTab() {
  const q = useQuery({
    queryKey: ["firmware-distribution"],
    queryFn: async () => (await api.get<{ version: string; model: string; is_latest: boolean; device_count: number }[]>("/firmware/distribution")).data,
  });
  const byModel = Object.values(
    (q.data ?? []).reduce<Record<string, { model: string; latest: number; outdated: number }>>((acc, r) => {
      const m = (acc[r.model] ??= { model: r.model, latest: 0, outdated: 0 });
      if (r.is_latest) m.latest += r.device_count;
      else m.outdated += r.device_count;
      return acc;
    }, {}),
  );
  return (
    <Grid container spacing={2}>
      <Grid size={{ xs: 12, lg: 6 }}>
        <ChartCard title="Update availability by model" testId="chart-update-availability" loading={q.isLoading} error={q.error} height={320}>
          <ResponsiveContainer>
            <BarChart data={byModel}>
              <CartesianGrid strokeDasharray="3 3" vertical={false} />
              <XAxis dataKey="model" fontSize={10} interval={0} tickFormatter={(v: string) => v.split(" (")[0]} />
              <YAxis fontSize={11} allowDecimals={false} />
              <Tooltip />
              <Legend />
              <Bar dataKey="latest" stackId="a" name="On latest firmware" fill="#2e9d6a" />
              <Bar dataKey="outdated" stackId="a" name="Update available" fill="#e1251b" />
            </BarChart>
          </ResponsiveContainer>
        </ChartCard>
      </Grid>
      <Grid size={{ xs: 12, lg: 6 }}>
        <Card>
          <CardContent>
            <Typography variant="h6" sx={{ mb: 1 }}>Device firmware distribution</Typography>
            <Table size="small" data-testid="firmware-distribution-table">
              <TableHead>
                <TableRow>
                  <TableCell>Model</TableCell>
                  <TableCell>Version</TableCell>
                  <TableCell align="right">Devices</TableCell>
                  <TableCell>Update</TableCell>
                </TableRow>
              </TableHead>
              <TableBody>
                {(q.data ?? []).map((r) => (
                  <TableRow key={r.model + r.version}>
                    <TableCell>{r.model}</TableCell>
                    <TableCell sx={{ fontWeight: 600 }}>{r.version}</TableCell>
                    <TableCell align="right">{r.device_count}</TableCell>
                    <TableCell>{r.is_latest ? <Chip size="small" color="success" label="Latest" /> : <Chip size="small" color="warning" label="Update available" />}</TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </CardContent>
        </Card>
      </Grid>
    </Grid>
  );
}

function CreateDeploymentDialog({ open, onClose }: { open: boolean; onClose: () => void }) {
  const notify = useNotify();
  const navigate = useNavigate();
  const qc = useQueryClient();
  const [name, setName] = useState("");
  const [fwId, setFwId] = useState<number | "">("");
  const [selected, setSelected] = useState<string[]>([]);
  const [search, setSearch] = useState("");
  const [region, setRegion] = useState("");
  const [status, setStatus] = useState("");
  const [page, setPage] = useState(1);
  const [schedule, setSchedule] = useState("");
  const [policy, setPolicy] = useState("WAIT");
  const [error, setError] = useState<string | null>(null);

  const firmware = useQuery({ queryKey: ["firmware-deployable"], queryFn: async () => (await api.get<Firmware[]>("/firmware")).data.filter((f) => f.status !== "DEPRECATED") });
  const regions = useQuery({ queryKey: ["device-filters"], queryFn: async () => (await api.get<{ regions: string[] }>("/devices/filters")).data });
  const eligible = useQuery({
    queryKey: ["eligible", fwId, search, region, status, page],
    queryFn: async () => (await api.get<Page<Device>>("/firmware/eligible-devices", { params: cleanParams({ firmware_version_id: fwId, search, region, status, page, page_size: 10 }) })).data,
    enabled: fwId !== "",
    placeholderData: keepPreviousData,
  });
  const fw = firmware.data?.find((f) => f.id === fwId);
  const pageIds = eligible.data?.items.map((d) => d.device_id) ?? [];
  const allOnPage = pageIds.length > 0 && pageIds.every((id) => selected.includes(id));

  const mutation = useMutation({
    mutationFn: async () =>
      (
        await api.post<Deployment>("/firmware/deployments", {
          name,
          firmware_version_id: fwId,
          device_ids: selected,
          scheduled_at: schedule ? dayjs(schedule).toISOString() : undefined,
          offline_policy: policy,
        })
      ).data,
    onSuccess: (dep) => {
      notify(`Deployment ${dep.deployment_code} created for ${dep.target_count} devices`);
      qc.invalidateQueries({ queryKey: ["deployments"] });
      onClose();
      navigate(`/firmware/deployments/${dep.deployment_code}`);
    },
    onError: (e) => setError(errorMessage(e, "Deployment could not be created")),
  });

  const nameError = name.length > 0 && name.trim().length < 3;
  return (
    <Dialog open={open} onClose={onClose} maxWidth="md" fullWidth data-testid="create-deployment-dialog">
      <DialogTitle>Create firmware deployment</DialogTitle>
      <DialogContent>
        <Alert severity="info" sx={{ mb: 2 }}>
          Deployments are executed by the device simulator. No firmware is installed on real Bell devices.
        </Alert>
        <Grid container spacing={2}>
          <Grid size={{ xs: 12, md: 6 }}>
            <TextField fullWidth label="Deployment name" value={name} onChange={(e) => setName(e.target.value)} error={nameError} helperText={nameError ? "At least 3 characters" : " "} inputProps={{ "data-testid": "deployment-name" }} />
          </Grid>
          <Grid size={{ xs: 12, md: 6 }}>
            <TextField select fullWidth label="Firmware version" value={fwId} onChange={(e) => { setFwId(Number(e.target.value)); setSelected([]); setPage(1); }} SelectProps={{ inputProps: { "data-testid": "deployment-firmware" } }}>
              {(firmware.data ?? []).map((f) => (
                <MenuItem key={f.id} value={f.id} data-testid="deployment-firmware-option" data-version={f.version} data-model={f.model}>
                  {f.model} — {f.version} {f.is_latest ? "(latest)" : f.status === "BETA" ? "(beta)" : ""}
                </MenuItem>
              ))}
            </TextField>
          </Grid>
          <Grid size={{ xs: 12, md: 6 }}>
            <TextField fullWidth type="datetime-local" label="Schedule (optional)" InputLabelProps={{ shrink: true }} value={schedule} onChange={(e) => setSchedule(e.target.value)} helperText="Leave empty to start immediately" inputProps={{ "data-testid": "deployment-schedule" }} />
          </Grid>
          <Grid size={{ xs: 12, md: 6 }}>
            <Typography variant="caption" color="text.secondary">Offline devices</Typography>
            <RadioGroup row value={policy} onChange={(e) => setPolicy(e.target.value)}>
              <FormControlLabel value="WAIT" control={<Radio size="small" />} label="Wait for reconnect" data-testid="policy-wait" />
              <FormControlLabel value="SKIP" control={<Radio size="small" />} label="Skip (fail immediately)" data-testid="policy-skip" />
            </RadioGroup>
          </Grid>
        </Grid>
        <Typography variant="subtitle2" sx={{ mt: 1, mb: 1 }}>
          Target devices {fw ? `(${fw.model}, not already on ${fw.version})` : ""} · <span data-testid="selected-target-count">{selected.length}</span> selected
        </Typography>
        {fwId === "" ? (
          <EmptyState title="Select a firmware version to list eligible devices" />
        ) : (
          <>
            <Stack direction="row" spacing={1.5} sx={{ mb: 1 }} flexWrap="wrap" useFlexGap>
              <TextField placeholder="Search devices" value={search} onChange={(e) => { setSearch(e.target.value); setPage(1); }} inputProps={{ "data-testid": "target-search" }} />
              <TextField select label="Region" value={region} onChange={(e) => { setRegion(e.target.value); setPage(1); }} sx={{ minWidth: 140 }}>
                <MenuItem value="">All</MenuItem>
                {(regions.data?.regions ?? []).map((r) => <MenuItem key={r} value={r}>{r}</MenuItem>)}
              </TextField>
              <TextField select label="Status" value={status} onChange={(e) => { setStatus(e.target.value); setPage(1); }} sx={{ minWidth: 140 }} SelectProps={{ inputProps: { "data-testid": "target-status-filter" } }}>
                <MenuItem value="">All</MenuItem>
                <MenuItem value="ONLINE">Online</MenuItem>
                <MenuItem value="OFFLINE">Offline</MenuItem>
              </TextField>
              {selected.length > 0 && <Button onClick={() => setSelected([])}>Clear selection</Button>}
            </Stack>
            <Table size="small" data-testid="target-devices-table">
              <TableHead>
                <TableRow>
                  <TableCell padding="checkbox">
                    <Checkbox
                      checked={allOnPage}
                      onChange={() => setSelected((s) => (allOnPage ? s.filter((id) => !pageIds.includes(id)) : Array.from(new Set([...s, ...pageIds]))))}
                      inputProps={{ "aria-label": "Select all on page", "data-testid": "select-all-targets" } as object}
                    />
                  </TableCell>
                  <TableCell>Device ID</TableCell>
                  <TableCell>Serial</TableCell>
                  <TableCell>Current firmware</TableCell>
                  <TableCell>Region</TableCell>
                  <TableCell>Status</TableCell>
                </TableRow>
              </TableHead>
              <TableBody>
                {(eligible.data?.items ?? []).map((d) => (
                  <TableRow key={d.device_id} hover data-testid="target-device-row" data-device-id={d.device_id}>
                    <TableCell padding="checkbox">
                      <Checkbox
                        checked={selected.includes(d.device_id)}
                        onChange={() => setSelected((s) => (s.includes(d.device_id) ? s.filter((x) => x !== d.device_id) : [...s, d.device_id]))}
                        inputProps={{ "aria-label": `Select ${d.device_id}`, "data-testid": "target-checkbox" } as object}
                      />
                    </TableCell>
                    <TableCell>{d.device_id}</TableCell>
                    <TableCell>{d.serial_number}</TableCell>
                    <TableCell>{d.firmware_version}</TableCell>
                    <TableCell>{d.region}</TableCell>
                    <TableCell><StatusChip value={d.connection_status} /></TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
            {eligible.data && eligible.data.total === 0 && <EmptyState title="No eligible devices" />}
            <Pager total={eligible.data?.total ?? 0} page={page} pageSize={10} onPage={setPage} testId="targets-pagination" />
          </>
        )}
        {error && <Alert severity="error" sx={{ mt: 2 }} data-testid="deployment-error">{error}</Alert>}
      </DialogContent>
      <DialogActions sx={{ px: 3, pb: 2 }}>
        <Button onClick={onClose}>Cancel</Button>
        <Button
          variant="contained"
          color="secondary"
          disabled={name.trim().length < 3 || fwId === "" || selected.length === 0 || mutation.isPending}
          onClick={() => { setError(null); mutation.mutate(); }}
          data-testid="deployment-submit"
        >
          Create deployment ({selected.length})
        </Button>
      </DialogActions>
    </Dialog>
  );
}

function DeploymentsTab() {
  const navigate = useNavigate();
  const { can } = useAuth();
  const [status, setStatus] = useState("");
  const [page, setPage] = useState(1);
  const [open, setOpen] = useState(false);
  const q = useQuery({
    queryKey: ["deployments", status, page],
    queryFn: async () => (await api.get<Page<Deployment>>("/firmware/deployments", { params: cleanParams({ status, page, page_size: 15 }) })).data,
    placeholderData: keepPreviousData,
    refetchInterval: 5000,
  });
  return (
    <Card>
      <CardContent>
        <Stack direction="row" justifyContent="space-between" sx={{ mb: 2 }} flexWrap="wrap" useFlexGap spacing={1}>
          <TextField select label="Status" value={status} onChange={(e) => { setStatus(e.target.value); setPage(1); }} sx={{ minWidth: 200 }} SelectProps={{ inputProps: { "data-testid": "deployment-status-filter" } }}>
            <MenuItem value="">All</MenuItem>
            {["SCHEDULED", "IN_PROGRESS", "COMPLETED", "COMPLETED_WITH_ERRORS", "FAILED", "CANCELLED", "ROLLED_BACK"].map((s) => <MenuItem key={s} value={s}>{humanize(s)}</MenuItem>)}
          </TextField>
          {can("firmware:manage") && (
            <Button variant="contained" color="secondary" startIcon={<AddIcon />} onClick={() => setOpen(true)} data-testid="create-deployment">
              Create deployment
            </Button>
          )}
        </Stack>
        {q.isLoading ? (
          <LoadingState />
        ) : q.isError ? (
          <ErrorState error={q.error} />
        ) : !q.data?.items.length ? (
          <EmptyState title="No deployments" />
        ) : (
          <>
            <TableContainer>
              <Table size="small" data-testid="deployments-table">
                <TableHead>
                  <TableRow>
                    <TableCell>Deployment ID</TableCell>
                    <TableCell>Name</TableCell>
                    <TableCell>Firmware</TableCell>
                    <TableCell align="right">Targets</TableCell>
                    <TableCell align="right">Successful</TableCell>
                    <TableCell align="right">Failed</TableCell>
                    <TableCell align="right">Pending</TableCell>
                    <TableCell sx={{ minWidth: 140 }}>Progress</TableCell>
                    <TableCell>Status</TableCell>
                    <TableCell>Created</TableCell>
                  </TableRow>
                </TableHead>
                <TableBody>
                  {q.data.items.map((d) => (
                    <TableRow key={d.id} hover sx={{ cursor: "pointer" }} onClick={() => navigate(`/firmware/deployments/${d.deployment_code}`)} data-testid="deployment-row" data-code={d.deployment_code}>
                      <TableCell sx={{ fontWeight: 600, fontFamily: "monospace" }}>{d.deployment_code}</TableCell>
                      <TableCell>{d.name}{d.is_rollback && <Chip label="Rollback" size="small" sx={{ ml: 1, height: 18 }} />}</TableCell>
                      <TableCell>{d.firmware_version} <Typography variant="caption" color="text.secondary">({d.model})</Typography></TableCell>
                      <TableCell align="right" data-testid="cell-targets">{d.target_count}</TableCell>
                      <TableCell align="right" data-testid="cell-successful">{d.successful_count}</TableCell>
                      <TableCell align="right" data-testid="cell-failed">{d.failed_count}</TableCell>
                      <TableCell align="right" data-testid="cell-pending">{d.pending_count + d.in_progress_count}</TableCell>
                      <TableCell>
                        <LinearProgress variant="determinate" value={d.progress_pct} sx={{ height: 6, borderRadius: 3 }} color={d.failed_count ? "warning" : "success"} />
                        <Typography variant="caption">{d.progress_pct}%</Typography>
                      </TableCell>
                      <TableCell data-testid="cell-deployment-status"><StatusChip value={d.status} /></TableCell>
                      <TableCell sx={{ whiteSpace: "nowrap" }}>{fmtDateTime(d.created_at)}</TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </TableContainer>
            <Pager total={q.data.total} page={page} pageSize={15} onPage={setPage} testId="deployments-pagination" />
          </>
        )}
      </CardContent>
      {open && <CreateDeploymentDialog open={open} onClose={() => setOpen(false)} />}
    </Card>
  );
}

export default function FirmwarePage() {
  const [params, setParams] = useSearchParams();
  const tab = params.get("tab") ?? "inventory";
  return (
    <Box data-testid="firmware-page">
      <PageHeader title="Firmware Management" subtitle="Firmware inventory, fleet distribution and staged deployments (simulated rollout)." />
      <Tabs value={tab} onChange={(_, v) => setParams({ tab: v })} sx={{ mb: 2, borderBottom: 1, borderColor: "divider" }}>
        <Tab value="inventory" label="Firmware Inventory" data-testid="tab-firmware-inventory" />
        <Tab value="distribution" label="Distribution" data-testid="tab-firmware-distribution" />
        <Tab value="deployments" label="Deployments" data-testid="tab-firmware-deployments" />
      </Tabs>
      {tab === "inventory" && <InventoryTab />}
      {tab === "distribution" && <DistributionTab />}
      {tab === "deployments" && <DeploymentsTab />}
    </Box>
  );
}
