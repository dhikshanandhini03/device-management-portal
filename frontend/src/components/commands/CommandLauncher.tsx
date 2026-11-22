import { useEffect, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  Box,
  Button,
  MenuItem,
  Stack,
  Step,
  StepLabel,
  Stepper,
  TextField,
  Typography,
  Alert,
  Tooltip,
} from "@mui/material";
import RestartAltIcon from "@mui/icons-material/RestartAlt";
import DeleteForeverOutlinedIcon from "@mui/icons-material/DeleteForeverOutlined";
import SyncIcon from "@mui/icons-material/Sync";
import RefreshIcon from "@mui/icons-material/Refresh";
import ReplayCircleFilledOutlinedIcon from "@mui/icons-material/ReplayCircleFilledOutlined";
import CleaningServicesOutlinedIcon from "@mui/icons-material/CleaningServicesOutlined";
import { api, errorMessage } from "../../api/client";
import type { Command, DeviceDetail, InstalledApp } from "../../api/types";
import ConfirmDialog from "../common/ConfirmDialog";
import StatusChip from "../common/StatusChip";
import { useNotify } from "../common/Notifier";
import { useAuth } from "../../auth/AuthContext";
import { fmtDateTime } from "../../utils/format";

export const COMMANDS = [
  { type: "REBOOT", label: "Reboot Device", icon: <RestartAltIcon />, description: "Restart the set-top box. The device goes offline briefly and reconnects." },
  { type: "SYNC_CONFIG", label: "Synchronize Configuration", icon: <SyncIcon />, description: "Push the latest configuration profile from the headend to the device." },
  { type: "REFRESH_INFO", label: "Refresh Device Information", icon: <RefreshIcon />, description: "Request a fresh inventory and telemetry report from the device." },
  { type: "RESTART_APP", label: "Restart Application", icon: <ReplayCircleFilledOutlinedIcon />, description: "Force-stop and relaunch an installed application.", app: true },
  { type: "CLEAR_APP_CACHE", label: "Clear Application Cache", icon: <CleaningServicesOutlinedIcon />, description: "Remove cached data for an installed application.", app: true },
  { type: "FACTORY_RESET", label: "Factory Reset", icon: <DeleteForeverOutlinedIcon />, description: "Erase all user data and settings and re-provision the device. Requires ADMIN.", danger: true },
] as const;

const STAGES = ["PENDING", "QUEUED", "SENT", "ACKNOWLEDGED", "EXECUTING", "COMPLETED"];
const TERMINAL = ["SUCCESSFUL", "FAILED", "TIMED_OUT"];

export function CommandTracker({ code, onFinished }: { code: string; onFinished?: (c: Command) => void }) {
  const { data } = useQuery({
    queryKey: ["command", code],
    queryFn: async () => (await api.get<Command>(`/commands/${code}`)).data,
    refetchInterval: (q) => (q.state.data && TERMINAL.includes(q.state.data.status) ? false : 1000),
  });
  useEffect(() => {
    if (data && TERMINAL.includes(data.status)) onFinished?.(data);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [data?.status]);
  if (!data) return null;
  const reached = new Set(data.history.map((h) => h.status));
  const terminal = TERMINAL.includes(data.status);
  const active = terminal ? STAGES.length : Math.max(0, STAGES.indexOf(data.status) + 1);
  return (
    <Box data-testid="command-tracker" data-command-code={code} data-status={data.status} sx={{ border: "1px solid", borderColor: "divider", borderRadius: 1, p: 2 }}>
      <Stack direction="row" justifyContent="space-between" alignItems="center" sx={{ mb: 2 }}>
        <Box>
          <Typography variant="subtitle2">
            {data.command_code} · {data.command_type.replace(/_/g, " ")} on {data.device_id}
          </Typography>
          <Typography variant="caption" color="text.secondary">
            Requested by {data.requested_by} at {fmtDateTime(data.created_at)} · timeout {data.timeout_seconds}s
          </Typography>
        </Box>
        <StatusChip value={data.status} testId="command-status" />
      </Stack>
      <Stepper activeStep={active} alternativeLabel>
        {STAGES.map((s) => {
          const isLast = s === "COMPLETED";
          const label = isLast ? (terminal ? data.status.replace("_", " ") : "Result") : s;
          const failed = isLast && terminal && data.status !== "SUCCESSFUL";
          return (
            <Step key={s} completed={isLast ? terminal : reached.has(s)}>
              <StepLabel error={failed}>{label.charAt(0) + label.slice(1).toLowerCase()}</StepLabel>
            </Step>
          );
        })}
      </Stepper>
      {data.result_message && (
        <Alert severity={data.status === "SUCCESSFUL" ? "success" : data.status === "FAILED" ? "error" : data.status === "TIMED_OUT" ? "warning" : "info"} sx={{ mt: 2 }} data-testid="command-result">
          {data.result_message}
        </Alert>
      )}
    </Box>
  );
}

export default function CommandLauncher({ device, onCreated }: { device: DeviceDetail; onCreated?: (c: Command) => void }) {
  const { can } = useAuth();
  const notify = useNotify();
  const qc = useQueryClient();
  const [pending, setPending] = useState<(typeof COMMANDS)[number] | null>(null);
  const [pkg, setPkg] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [lastCode, setLastCode] = useState<string | null>(null);
  const canExecute = can("commands:execute");

  const apps = useQuery({
    queryKey: ["device-apps", device.device_id],
    queryFn: async () => (await api.get<InstalledApp[]>(`/devices/${device.device_id}/applications`)).data,
    enabled: !!pending && "app" in pending,
  });

  const mutation = useMutation({
    mutationFn: async (vars: { type: string; confirmation?: string }) =>
      (
        await api.post<Command>("/commands", {
          device_id: device.device_id,
          command_type: vars.type,
          parameters: pkg ? { package_id: pkg } : {},
          confirmation: vars.confirmation,
        })
      ).data,
    onSuccess: (cmd) => {
      notify(`Command ${cmd.command_code} created - status ${cmd.status.toLowerCase()}`, "info");
      setPending(null);
      setLastCode(cmd.command_code);
      qc.invalidateQueries({ queryKey: ["commands"] });
      qc.invalidateQueries({ queryKey: ["device-commands", device.device_id] });
      onCreated?.(cmd);
    },
    onError: (e) => setError(errorMessage(e, "Command could not be created")),
  });

  const open = (c: (typeof COMMANDS)[number]) => {
    setError(null);
    setPkg("");
    setPending(c);
  };

  return (
    <Box data-testid="command-launcher">
      {!canExecute && (
        <Alert severity="info" sx={{ mb: 2 }} data-testid="commands-readonly-notice">
          Your role can view command history but cannot execute remote commands.
        </Alert>
      )}
      {device.connection_status !== "ONLINE" && canExecute && (
        <Alert severity="warning" sx={{ mb: 2 }} data-testid="device-offline-warning">
          {device.device_id} is {device.connection_status.toLowerCase()}. Commands will be queued and time out if the device does not reconnect.
        </Alert>
      )}
      <Stack direction="row" spacing={1} flexWrap="wrap" useFlexGap>
        {COMMANDS.map((c) => {
          const adminOnly = c.type === "FACTORY_RESET" && !can("commands:factory_reset");
          const btn = (
            <span key={c.type}>
              <Button
                variant={"danger" in c ? "outlined" : "contained"}
                color={"danger" in c ? "error" : "primary"}
                startIcon={c.icon}
                disabled={!canExecute || adminOnly}
                onClick={() => open(c)}
                data-testid={`cmd-${c.type.toLowerCase().replace(/_/g, "-")}`}
              >
                {c.label}
              </Button>
            </span>
          );
          return adminOnly ? (
            <Tooltip key={c.type} title="Factory reset requires the ADMIN role">
              {btn}
            </Tooltip>
          ) : (
            btn
          );
        })}
      </Stack>
      {lastCode && (
        <Box sx={{ mt: 2 }}>
          <CommandTracker
            key={lastCode}
            code={lastCode}
            onFinished={() => {
              qc.invalidateQueries({ queryKey: ["device", device.device_id] });
              qc.invalidateQueries({ queryKey: ["commands"] });
              qc.invalidateQueries({ queryKey: ["device-commands", device.device_id] });
            }}
          />
        </Box>
      )}
      <ConfirmDialog
        open={!!pending}
        title={pending ? `${pending.label}?` : ""}
        danger={!!pending && "danger" in pending}
        confirmLabel={pending?.type === "FACTORY_RESET" ? "Factory reset device" : "Send command"}
        loading={mutation.isPending}
        error={error}
        requireText={pending?.type === "FACTORY_RESET" ? device.serial_number : undefined}
        requireTextLabel={pending?.type === "FACTORY_RESET" ? `Type the serial number ${device.serial_number} to confirm` : undefined}
        message={
          <>
            <Typography variant="body2" sx={{ mb: 1 }}>
              {pending?.description}
            </Typography>
            <Typography variant="body2">
              Target: <b>{device.device_id}</b> ({device.serial_number}, {device.model}) — currently <b>{device.connection_status}</b>
            </Typography>
            {pending?.type === "FACTORY_RESET" && (
              <Alert severity="error" sx={{ mt: 2 }}>
                This permanently erases recordings, preferences and installed user apps on the device. This action is audited.
              </Alert>
            )}
          </>
        }
        onConfirm={(typed) => mutation.mutate({ type: pending!.type, confirmation: typed || undefined })}
        onClose={() => setPending(null)}
        testId="command-confirm"
        confirmDisabled={!!pending && "app" in pending && !pkg}
      >
        {pending && "app" in pending && (
          <TextField
            select
            fullWidth
            sx={{ mt: 2 }}
            label="Application"
            value={pkg}
            onChange={(e) => setPkg(e.target.value)}
            SelectProps={{ inputProps: { "data-testid": "command-app-select" } }}
          >
            {(apps.data ?? []).map((a) => (
              <MenuItem key={a.package_id} value={a.package_id}>
                {a.name} ({a.package_id}) v{a.version}
              </MenuItem>
            ))}
          </TextField>
        )}
      </ConfirmDialog>
    </Box>
  );
}
