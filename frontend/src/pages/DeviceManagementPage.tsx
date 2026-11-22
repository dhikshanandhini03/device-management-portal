import { useEffect, useState } from "react";
import { useSearchParams } from "react-router-dom";
import { keepPreviousData, useQuery } from "@tanstack/react-query";
import {
  Autocomplete,
  Box,
  Card,
  CardContent,
  Dialog,
  DialogContent,
  DialogTitle,
  MenuItem,
  Stack,
  TextField,
  Typography,
  Button,
  DialogActions,
} from "@mui/material";
import Grid from "@mui/material/Grid2";
import { api, cleanParams } from "../api/client";
import type { Command, Device, DeviceDetail, Page } from "../api/types";
import PageHeader from "../components/common/PageHeader";
import StatusChip from "../components/common/StatusChip";
import KeyValueGrid from "../components/common/KeyValueGrid";
import Pager from "../components/common/Pager";
import { EmptyState, ErrorState, LoadingState } from "../components/common/States";
import CommandLauncher, { CommandTracker } from "../components/commands/CommandLauncher";
import CommandHistoryTable from "../components/commands/CommandHistoryTable";
import { fmtRelative, fmtUptime, humanize } from "../utils/format";

const STATUSES = ["PENDING", "QUEUED", "SENT", "ACKNOWLEDGED", "EXECUTING", "SUCCESSFUL", "FAILED", "TIMED_OUT"];
const TYPES = ["REBOOT", "FACTORY_RESET", "SYNC_CONFIG", "REFRESH_INFO", "RESTART_APP", "CLEAR_APP_CACHE"];

function DevicePicker({ value, onChange }: { value: string; onChange: (id: string) => void }) {
  const [input, setInput] = useState("");
  const { data = [], isFetching } = useQuery({
    queryKey: ["device-picker", input],
    queryFn: async () => (await api.get<Device[]>("/search", { params: { q: input, limit: 15 } })).data,
    enabled: input.trim().length >= 2,
  });
  return (
    <Autocomplete
      options={data}
      loading={isFetching}
      filterOptions={(x) => x}
      getOptionLabel={(o) => `${o.device_id} — ${o.serial_number}`}
      isOptionEqualToValue={(a, b) => a.device_id === b.device_id}
      onInputChange={(_, v, reason) => reason === "input" && setInput(v)}
      onChange={(_, v) => v && onChange(v.device_id)}
      renderOption={(props, o) => {
        const { key, ...rest } = props as typeof props & { key: string };
        return (
          <li key={key} {...rest} data-testid="device-picker-option">
            <Stack direction="row" justifyContent="space-between" width="100%">
              <span>
                <b>{o.device_id}</b> · {o.serial_number} · {o.model}
              </span>
              <StatusChip value={o.connection_status} />
            </Stack>
          </li>
        );
      }}
      renderInput={(params) => (
        <TextField {...params} label={value ? `Selected: ${value} — search to change` : "Select an STB (device ID, serial or MAC)"} inputProps={{ ...params.inputProps, "data-testid": "device-picker" }} />
      )}
    />
  );
}

export default function DeviceManagementPage() {
  const [params, setParams] = useSearchParams();
  const selected = params.get("device") ?? "";
  const [filters, setFilters] = useState({ device_id: "", status: "", command_type: "" });
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(25);
  const [openCode, setOpenCode] = useState<string | null>(null);

  useEffect(() => setPage(1), [filters]);

  const device = useQuery({
    queryKey: ["device", selected],
    queryFn: async () => (await api.get<DeviceDetail>(`/devices/${selected}`)).data,
    enabled: !!selected,
    refetchInterval: 5000,
  });
  const commands = useQuery({
    queryKey: ["commands", filters, page, pageSize],
    queryFn: async () => (await api.get<Page<Command>>("/commands", { params: cleanParams({ ...filters, page, page_size: pageSize }) })).data,
    placeholderData: keepPreviousData,
    refetchInterval: 3000,
  });

  return (
    <Box data-testid="device-management-page">
      <PageHeader title="Remote Device Management" subtitle="Issue remote operations to set-top boxes and track their delivery and execution. Operations run against the simulated fleet." />
      <Grid container spacing={2} sx={{ mb: 2 }}>
        <Grid size={{ xs: 12, lg: 5 }}>
          <Card sx={{ height: "100%" }}>
            <CardContent>
              <Typography variant="h6" sx={{ mb: 2 }}>
                1. Select target device
              </Typography>
              <DevicePicker value={selected} onChange={(id) => setParams({ device: id })} />
              <Box sx={{ mt: 2 }}>
                {!selected ? (
                  <EmptyState title="No device selected" description="Search for an STB to run remote operations." />
                ) : device.isLoading ? (
                  <LoadingState />
                ) : device.isError || !device.data ? (
                  <ErrorState error={device.error} />
                ) : (
                  <Box data-testid="selected-device">
                    <KeyValueGrid
                      columns={2}
                      items={[
                        { label: "Device ID", value: device.data.device_id, testId: "selected-device-id" },
                        { label: "Status", value: <StatusChip value={device.data.connection_status} testId="selected-device-status" /> },
                        { label: "Serial", value: device.data.serial_number },
                        { label: "Model", value: device.data.model },
                        { label: "Firmware", value: device.data.firmware_version },
                        { label: "Uptime", value: fmtUptime(device.data.uptime_seconds), testId: "selected-device-uptime" },
                        { label: "Last seen", value: fmtRelative(device.data.last_seen_at) },
                        { label: "Region", value: `${device.data.region} / ${device.data.city}` },
                      ]}
                    />
                  </Box>
                )}
              </Box>
            </CardContent>
          </Card>
        </Grid>
        <Grid size={{ xs: 12, lg: 7 }}>
          <Card sx={{ height: "100%" }}>
            <CardContent>
              <Typography variant="h6" sx={{ mb: 2 }}>
                2. Choose an operation
              </Typography>
              {device.data ? <CommandLauncher device={device.data} /> : <EmptyState title="Select a device to enable remote operations" />}
            </CardContent>
          </Card>
        </Grid>
      </Grid>
      <Card>
        <CardContent>
          <Stack direction={{ xs: "column", md: "row" }} justifyContent="space-between" spacing={2} sx={{ mb: 2 }}>
            <Typography variant="h6">Command history</Typography>
            <Stack direction="row" spacing={1.5} flexWrap="wrap" useFlexGap>
              <TextField label="Device / serial" value={filters.device_id} onChange={(e) => setFilters((f) => ({ ...f, device_id: e.target.value }))} inputProps={{ "data-testid": "history-device-filter" }} />
              <TextField select label="Status" value={filters.status} onChange={(e) => setFilters((f) => ({ ...f, status: e.target.value }))} sx={{ minWidth: 150 }} SelectProps={{ inputProps: { "data-testid": "history-status-filter" } }}>
                <MenuItem value="">All</MenuItem>
                {STATUSES.map((s) => <MenuItem key={s} value={s}>{humanize(s)}</MenuItem>)}
              </TextField>
              <TextField select label="Command" value={filters.command_type} onChange={(e) => setFilters((f) => ({ ...f, command_type: e.target.value }))} sx={{ minWidth: 190 }} SelectProps={{ inputProps: { "data-testid": "history-type-filter" } }}>
                <MenuItem value="">All</MenuItem>
                {TYPES.map((s) => <MenuItem key={s} value={s}>{humanize(s)}</MenuItem>)}
              </TextField>
            </Stack>
          </Stack>
          {commands.isLoading ? (
            <LoadingState />
          ) : commands.isError ? (
            <ErrorState error={commands.error} onRetry={() => commands.refetch()} />
          ) : (
            <>
              <CommandHistoryTable rows={commands.data?.items ?? []} onSelect={(c) => setOpenCode(c.command_code)} />
              <Pager total={commands.data?.total ?? 0} page={page} pageSize={pageSize} onPage={setPage} onPageSize={(s) => { setPageSize(s); setPage(1); }} testId="commands-pagination" />
            </>
          )}
        </CardContent>
      </Card>
      <Dialog open={!!openCode} onClose={() => setOpenCode(null)} maxWidth="md" fullWidth data-testid="command-detail-dialog">
        <DialogTitle>Command execution detail</DialogTitle>
        <DialogContent>{openCode && <CommandTracker code={openCode} />}</DialogContent>
        <DialogActions>
          <Button onClick={() => setOpenCode(null)}>Close</Button>
        </DialogActions>
      </Dialog>
    </Box>
  );
}
