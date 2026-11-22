import { useEffect, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  Alert,
  Box,
  Button,
  Card,
  CardContent,
  Chip,
  Link,
  Stack,
  Switch,
  Table,
  TableBody,
  TableCell,
  TableRow,
  TextField,
  Typography,
} from "@mui/material";
import Grid from "@mui/material/Grid2";
import PlayArrowIcon from "@mui/icons-material/PlayArrow";
import StopIcon from "@mui/icons-material/Stop";
import RestartAltIcon from "@mui/icons-material/RestartAlt";
import { api, DEMO_MODE, errorMessage } from "../api/client";
import PageHeader from "../components/common/PageHeader";
import KeyValueGrid from "../components/common/KeyValueGrid";
import ConfirmDialog from "../components/common/ConfirmDialog";
import { ErrorState, LoadingState } from "../components/common/States";
import { useNotify } from "../components/common/Notifier";
import { ROLE_LABELS, useAuth } from "../auth/AuthContext";
import { fmtDateTime, fmtNumber, humanize } from "../utils/format";

interface Setting {
  key: string;
  value: string;
  description: string;
  updated_at: string | null;
  type: "boolean" | "number";
  min: number | null;
  max: number | null;
}

interface SimStatus {
  running: boolean;
  devices: number;
  online: number;
  offline: number;
  rebooting: number;
  tick: number;
  started_at: string | null;
  stats: Record<string, number>;
  inflight_commands: number;
  inflight_firmware_targets: number;
}

function ChangePassword() {
  const notify = useNotify();
  const [current, setCurrent] = useState("");
  const [next, setNext] = useState("");
  const [confirm, setConfirm] = useState("");
  const [error, setError] = useState<string | null>(null);
  const mismatch = confirm.length > 0 && next !== confirm;
  const m = useMutation({
    mutationFn: async () => api.post("/auth/change-password", { current_password: current, new_password: next }),
    onSuccess: () => {
      notify("Password updated");
      setCurrent("");
      setNext("");
      setConfirm("");
    },
    onError: (e) => setError(errorMessage(e, "Password change failed")),
  });
  return (
    <Stack spacing={1.5} component="form" onSubmit={(e) => { e.preventDefault(); setError(null); m.mutate(); }}>
      <TextField type="password" label="Current password" value={current} onChange={(e) => setCurrent(e.target.value)} autoComplete="current-password" inputProps={{ "data-testid": "current-password" }} />
      <TextField type="password" label="New password" value={next} onChange={(e) => setNext(e.target.value)} autoComplete="new-password" helperText="Min 8 chars with upper, lower, digit and special character" inputProps={{ "data-testid": "new-password" }} />
      <TextField type="password" label="Confirm new password" value={confirm} onChange={(e) => setConfirm(e.target.value)} error={mismatch} helperText={mismatch ? "Passwords do not match" : " "} autoComplete="new-password" inputProps={{ "data-testid": "confirm-password" }} />
      {error && <Alert severity="error">{error}</Alert>}
      <Box>
        <Button type="submit" variant="outlined" disabled={!current || !next || next !== confirm || m.isPending} data-testid="change-password-submit">
          Change password
        </Button>
      </Box>
    </Stack>
  );
}

function SystemSettings({ editable }: { editable: boolean }) {
  const notify = useNotify();
  const qc = useQueryClient();
  const q = useQuery({ queryKey: ["settings"], queryFn: async () => (await api.get<Setting[]>("/settings")).data });
  const [values, setValues] = useState<Record<string, string>>({});
  const [error, setError] = useState<string | null>(null);
  useEffect(() => {
    if (q.data) setValues(Object.fromEntries(q.data.map((s) => [s.key, s.value])));
  }, [q.data]);
  const save = useMutation({
    mutationFn: async () => (await api.put<Setting[]>("/settings", { values })).data,
    onSuccess: () => {
      notify("System settings saved");
      qc.invalidateQueries({ queryKey: ["settings"] });
    },
    onError: (e) => setError(errorMessage(e, "Settings could not be saved")),
  });
  if (q.isLoading) return <LoadingState />;
  if (q.isError) return <ErrorState error={q.error} />;
  const dirty = q.data!.some((s) => values[s.key] !== s.value);
  return (
    <>
      <Table size="small" data-testid="settings-table">
        <TableBody>
          {q.data!.map((s) => (
            <TableRow key={s.key} data-testid={`setting-${s.key}`}>
              <TableCell sx={{ width: "45%" }}>
                <Typography variant="body2" fontWeight={600}>{humanize(s.key)}</Typography>
                <Typography variant="caption" color="text.secondary">{s.description}</Typography>
              </TableCell>
              <TableCell>
                {s.type === "boolean" ? (
                  <Switch checked={values[s.key] === "true"} disabled={!editable} onChange={(e) => setValues((v) => ({ ...v, [s.key]: e.target.checked ? "true" : "false" }))} inputProps={{ "data-testid": `setting-input-${s.key}` } as object} />
                ) : (
                  <TextField
                    type="number"
                    value={values[s.key] ?? ""}
                    disabled={!editable}
                    onChange={(e) => setValues((v) => ({ ...v, [s.key]: e.target.value }))}
                    inputProps={{ min: s.min ?? undefined, max: s.max ?? undefined, "data-testid": `setting-input-${s.key}` }}
                    helperText={s.min !== null ? `${s.min} – ${s.max}` : undefined}
                    sx={{ width: 160 }}
                  />
                )}
              </TableCell>
              <TableCell sx={{ color: "text.secondary", fontSize: 12 }}>{s.updated_at ? `Updated ${fmtDateTime(s.updated_at)}` : "Default"}</TableCell>
            </TableRow>
          ))}
        </TableBody>
      </Table>
      {error && <Alert severity="error" sx={{ mt: 2 }} data-testid="settings-error">{error}</Alert>}
      {editable ? (
        <Stack direction="row" spacing={1} sx={{ mt: 2 }}>
          <Button variant="contained" disabled={!dirty || save.isPending} onClick={() => { setError(null); save.mutate(); }} data-testid="save-settings">
            Save settings
          </Button>
          <Button disabled={!dirty} onClick={() => setValues(Object.fromEntries(q.data!.map((s) => [s.key, s.value])))}>Discard</Button>
        </Stack>
      ) : (
        <Alert severity="info" sx={{ mt: 2 }}>Only administrators can change system settings.</Alert>
      )}
    </>
  );
}

function SimulatorControl({ editable }: { editable: boolean }) {
  const notify = useNotify();
  const qc = useQueryClient();
  const [confirmReset, setConfirmReset] = useState(false);
  const q = useQuery({ queryKey: ["simulator"], queryFn: async () => (await api.get<SimStatus>("/simulator/status")).data, refetchInterval: 5000, retry: false });
  const action = useMutation({
    mutationFn: async (a: "start" | "stop" | "reset") => (await api.post<SimStatus>(`/simulator/${a}`)).data,
    onSuccess: (_, a) => {
      notify(`Simulator ${a} completed`);
      setConfirmReset(false);
      qc.invalidateQueries({ queryKey: ["simulator"] });
    },
    onError: (e) => notify(errorMessage(e, "Simulator request failed"), "error"),
  });
  return (
    <Box data-testid="simulator-control">
      {q.isError ? (
        <ErrorState error={q.error} title="Simulator unreachable" />
      ) : !q.data ? (
        <LoadingState />
      ) : (
        <>
          <Stack direction="row" spacing={1} alignItems="center" sx={{ mb: 2 }}>
            <Chip label={q.data.running ? "RUNNING" : "STOPPED"} color={q.data.running ? "success" : "default"} data-testid="simulator-state" />
            <Typography variant="body2" color="text.secondary">Tick {q.data.tick} · started {fmtDateTime(q.data.started_at)}</Typography>
          </Stack>
          <KeyValueGrid
            columns={4}
            items={[
              { label: "Simulated devices", value: fmtNumber(q.data.devices), testId: "sim-devices" },
              { label: "Online", value: fmtNumber(q.data.online) },
              { label: "Offline", value: fmtNumber(q.data.offline) },
              { label: "Rebooting", value: fmtNumber(q.data.rebooting) },
              { label: "Heartbeats sent", value: fmtNumber(q.data.stats.heartbeats) },
              { label: "Events sent", value: fmtNumber(q.data.stats.events) },
              { label: "Commands executed", value: fmtNumber(q.data.stats.commands) },
              { label: "Firmware updates", value: fmtNumber(q.data.stats.firmware_updates) },
            ]}
          />
          {editable && (
            <Stack direction="row" spacing={1} sx={{ mt: 2 }}>
              <Button variant="contained" color="success" startIcon={<PlayArrowIcon />} disabled={q.data.running || action.isPending} onClick={() => action.mutate("start")} data-testid="sim-start">Start</Button>
              <Button variant="outlined" color="error" startIcon={<StopIcon />} disabled={!q.data.running || action.isPending} onClick={() => action.mutate("stop")} data-testid="sim-stop">Stop</Button>
              <Button variant="outlined" startIcon={<RestartAltIcon />} disabled={action.isPending} onClick={() => setConfirmReset(true)} data-testid="sim-reset">Reset</Button>
            </Stack>
          )}
        </>
      )}
      <ConfirmDialog
        open={confirmReset}
        title="Reset simulated fleet?"
        message="All standard simulated devices are returned to a baseline state (connectivity and load). Historical records are kept."
        confirmLabel="Reset simulator"
        loading={action.isPending}
        onConfirm={() => action.mutate("reset")}
        onClose={() => setConfirmReset(false)}
        testId="sim-reset-dialog"
      />
    </Box>
  );
}

export default function SettingsPage() {
  const { user, can } = useAuth();
  const admin = can("settings:manage");
  return (
    <Box data-testid="settings-page">
      <PageHeader title="Settings" subtitle="Profile, alerting thresholds and simulated device environment." />
      <Grid container spacing={2}>
        <Grid size={{ xs: 12, lg: 5 }}>
          <Card sx={{ mb: 2 }}>
            <CardContent>
              <Typography variant="h6" sx={{ mb: 2 }}>My profile</Typography>
              <KeyValueGrid
                columns={2}
                items={[
                  { label: "Username", value: user?.username, testId: "profile-username" },
                  { label: "Role", value: ROLE_LABELS[user?.role ?? ""], testId: "profile-role" },
                  { label: "Full name", value: user?.full_name },
                  { label: "Email", value: user?.email },
                ]}
              />
              <Typography variant="subtitle2" sx={{ mt: 3, mb: 1.5 }}>Change password</Typography>
              <ChangePassword />
            </CardContent>
          </Card>
          <Card>
            <CardContent>
              <Typography variant="h6" sx={{ mb: 1 }}>About this environment</Typography>
              <Typography variant="body2" color="text.secondary" sx={{ mb: 1 }}>
                BELL STB Device Management is a portfolio and test-automation environment. All devices, telemetry and operations are produced by the bundled STB simulator through the device gateway API. It is not an official Bell Canada system.
              </Typography>
              <Link
                href={DEMO_MODE ? "https://github.com/dhikshanandhini03/device-management-portal#api" : "/api/docs"}
                target="_blank"
                rel="noopener"
                data-testid="api-docs-link"
              >
                Open API documentation (Swagger)
              </Link>
            </CardContent>
          </Card>
        </Grid>
        <Grid size={{ xs: 12, lg: 7 }}>
          <Card sx={{ mb: 2 }}>
            <CardContent>
              <Typography variant="h6" sx={{ mb: 2 }}>Device simulator</Typography>
              <SimulatorControl editable={admin} />
            </CardContent>
          </Card>
          <Card>
            <CardContent>
              <Typography variant="h6" sx={{ mb: 1 }}>System settings</Typography>
              <SystemSettings editable={admin} />
            </CardContent>
          </Card>
        </Grid>
      </Grid>
    </Box>
  );
}
