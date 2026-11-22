import { useState } from "react";
import { useNavigate, useParams } from "react-router-dom";
import { keepPreviousData, useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  Box,
  Button,
  Card,
  CardContent,
  LinearProgress,
  MenuItem,
  Stack,
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableRow,
  TextField,
  Typography,
} from "@mui/material";
import Grid from "@mui/material/Grid2";
import { api, cleanParams, errorMessage } from "../../api/client";
import type { Deployment, DeploymentTarget, Page } from "../../api/types";
import PageHeader from "../../components/common/PageHeader";
import StatCard from "../../components/common/StatCard";
import StatusChip from "../../components/common/StatusChip";
import KeyValueGrid from "../../components/common/KeyValueGrid";
import Pager from "../../components/common/Pager";
import ConfirmDialog from "../../components/common/ConfirmDialog";
import { EmptyState, ErrorState, LoadingState } from "../../components/common/States";
import { useNotify } from "../../components/common/Notifier";
import { useAuth } from "../../auth/AuthContext";
import { fmtDateTime, humanize } from "../../utils/format";

const ACTIVE = ["SCHEDULED", "IN_PROGRESS"];

export default function DeploymentDetailsPage() {
  const { code = "" } = useParams();
  const navigate = useNavigate();
  const notify = useNotify();
  const qc = useQueryClient();
  const { can } = useAuth();
  const [status, setStatus] = useState("");
  const [page, setPage] = useState(1);
  const [confirm, setConfirm] = useState<"cancel" | "rollback" | null>(null);
  const [error, setError] = useState<string | null>(null);

  const dep = useQuery({
    queryKey: ["deployment", code],
    queryFn: async () => (await api.get<Deployment>(`/firmware/deployments/${code}`)).data,
    refetchInterval: (q) => (q.state.data && ACTIVE.includes(q.state.data.status) ? 2000 : false),
  });
  const targets = useQuery({
    queryKey: ["deployment-targets", code, status, page, dep.data?.progress_pct],
    queryFn: async () => (await api.get<Page<DeploymentTarget>>(`/firmware/deployments/${code}/targets`, { params: cleanParams({ status, page, page_size: 20 }) })).data,
    placeholderData: keepPreviousData,
  });

  const action = useMutation({
    mutationFn: async (kind: "cancel" | "rollback") => (await api.post<Deployment>(`/firmware/deployments/${code}/${kind}`)).data,
    onSuccess: (d, kind) => {
      setConfirm(null);
      qc.invalidateQueries({ queryKey: ["deployment", code] });
      qc.invalidateQueries({ queryKey: ["deployments"] });
      if (kind === "rollback") {
        notify(`Rollback deployment ${d.deployment_code} created`);
        navigate(`/firmware/deployments/${d.deployment_code}`);
      } else {
        notify(`Deployment ${code} cancelled`);
      }
    },
    onError: (e) => setError(errorMessage(e)),
  });

  if (dep.isLoading) return <LoadingState />;
  if (dep.isError || !dep.data) return <ErrorState error={dep.error} title="Deployment could not be loaded" />;
  const d = dep.data;
  const finished = ["COMPLETED", "COMPLETED_WITH_ERRORS", "CANCELLED"].includes(d.status);

  return (
    <Box data-testid="deployment-details-page">
      <PageHeader
        title={`${d.deployment_code} · ${d.name}`}
        crumbs={[{ label: "Firmware Management", to: "/firmware?tab=deployments" }, { label: d.deployment_code }]}
        subtitle={<Stack direction="row" spacing={1} alignItems="center" component="span"><StatusChip value={d.status} testId="deployment-status" /><span>Firmware {d.firmware_version} for {d.model}</span></Stack>}
        actions={
          can("firmware:manage") && (
            <>
              {ACTIVE.includes(d.status) && (
                <Button color="error" variant="outlined" onClick={() => { setError(null); setConfirm("cancel"); }} data-testid="cancel-deployment">
                  Cancel deployment
                </Button>
              )}
              {finished && d.successful_count > 0 && !d.is_rollback && (
                <Button variant="outlined" onClick={() => { setError(null); setConfirm("rollback"); }} data-testid="rollback-deployment">
                  Roll back
                </Button>
              )}
            </>
          )
        }
      />
      <Grid container spacing={2} sx={{ mb: 2 }}>
        <Grid size={{ xs: 6, md: 3 }}><StatCard testId="dep-targets" label="Target devices" value={d.target_count} /></Grid>
        <Grid size={{ xs: 6, md: 3 }}><StatCard testId="dep-successful" label="Successful" value={d.successful_count} accent="#2e9d6a" /></Grid>
        <Grid size={{ xs: 6, md: 3 }}><StatCard testId="dep-failed" label="Failed" value={d.failed_count} accent="#c62828" /></Grid>
        <Grid size={{ xs: 6, md: 3 }}><StatCard testId="dep-pending" label="Pending / in progress" value={d.pending_count + d.in_progress_count} accent="#ed8a00" /></Grid>
      </Grid>
      <Card sx={{ mb: 2 }}>
        <CardContent>
          <Stack direction="row" justifyContent="space-between" sx={{ mb: 1 }}>
            <Typography variant="h6">Progress</Typography>
            <Typography variant="h6" data-testid="dep-progress">{d.progress_pct}%</Typography>
          </Stack>
          <LinearProgress variant="determinate" value={d.progress_pct} sx={{ height: 10, borderRadius: 5, mb: 2 }} color={d.failed_count ? "warning" : "success"} />
          <KeyValueGrid
            columns={4}
            items={[
              { label: "Firmware", value: `${d.firmware_version} (${d.model})`, testId: "dep-firmware" },
              { label: "Offline policy", value: d.offline_policy === "SKIP" ? "Skip offline devices" : "Wait for reconnect" },
              { label: "Created by", value: d.created_by ?? "—" },
              { label: "Created", value: fmtDateTime(d.created_at) },
              { label: "Scheduled", value: fmtDateTime(d.scheduled_at) },
              { label: "Started", value: fmtDateTime(d.started_at) },
              { label: "Completed", value: fmtDateTime(d.completed_at) },
              { label: "Rollback of", value: d.rollback_of ?? "—" },
            ]}
          />
        </CardContent>
      </Card>
      <Card>
        <CardContent>
          <Stack direction="row" justifyContent="space-between" sx={{ mb: 2 }}>
            <Typography variant="h6">Target devices</Typography>
            <TextField select label="Status" value={status} onChange={(e) => { setStatus(e.target.value); setPage(1); }} sx={{ minWidth: 160 }} SelectProps={{ inputProps: { "data-testid": "target-status-select" } }}>
              <MenuItem value="">All</MenuItem>
              {["PENDING", "DOWNLOADING", "INSTALLING", "SUCCESS", "FAILED"].map((s) => <MenuItem key={s} value={s}>{humanize(s)}</MenuItem>)}
            </TextField>
          </Stack>
          {!targets.data?.items.length ? (
            <EmptyState title="No targets for this filter" />
          ) : (
            <>
              <Table size="small" data-testid="deployment-targets-table">
                <TableHead>
                  <TableRow>
                    <TableCell>Device ID</TableCell>
                    <TableCell>Serial</TableCell>
                    <TableCell>Region</TableCell>
                    <TableCell>Connection</TableCell>
                    <TableCell>Previous</TableCell>
                    <TableCell>Target</TableCell>
                    <TableCell>Status</TableCell>
                    <TableCell>Error</TableCell>
                    <TableCell>Updated</TableCell>
                  </TableRow>
                </TableHead>
                <TableBody>
                  {targets.data.items.map((t) => (
                    <TableRow key={t.id} hover sx={{ cursor: "pointer" }} onClick={() => navigate(`/devices/${t.device_id}?tab=software`)} data-testid="deployment-target-row" data-device-id={t.device_id} data-status={t.status}>
                      <TableCell sx={{ fontWeight: 600 }}>{t.device_id}</TableCell>
                      <TableCell>{t.serial_number}</TableCell>
                      <TableCell>{t.region}</TableCell>
                      <TableCell><StatusChip value={t.connection_status} /></TableCell>
                      <TableCell>{t.previous_version ?? "—"}</TableCell>
                      <TableCell>{t.target_version}</TableCell>
                      <TableCell><StatusChip value={t.status} /></TableCell>
                      <TableCell><Typography variant="caption">{t.error_message ?? ""}</Typography></TableCell>
                      <TableCell sx={{ whiteSpace: "nowrap" }}>{fmtDateTime(t.updated_at)}</TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
              <Pager total={targets.data.total} page={page} pageSize={20} onPage={setPage} testId="deployment-targets-pagination" />
            </>
          )}
        </CardContent>
      </Card>
      <ConfirmDialog
        open={!!confirm}
        title={confirm === "cancel" ? "Cancel deployment?" : "Roll back deployment?"}
        danger={confirm === "cancel"}
        message={
          confirm === "cancel"
            ? "Pending devices will not be updated. Devices currently installing will finish their update."
            : `A new deployment will reinstall the previous firmware on the ${d.successful_count} devices that were updated by ${d.deployment_code}.`
        }
        confirmLabel={confirm === "cancel" ? "Cancel deployment" : "Create rollback"}
        loading={action.isPending}
        error={error}
        onConfirm={() => confirm && action.mutate(confirm)}
        onClose={() => setConfirm(null)}
        testId="deployment-confirm"
      />
    </Box>
  );
}
