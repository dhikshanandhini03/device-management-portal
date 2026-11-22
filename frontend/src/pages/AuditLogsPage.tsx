import { useState } from "react";
import { keepPreviousData, useQuery } from "@tanstack/react-query";
import {
  Box,
  Button,
  Card,
  CardContent,
  Dialog,
  DialogActions,
  DialogContent,
  DialogTitle,
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
import FileDownloadOutlinedIcon from "@mui/icons-material/FileDownloadOutlined";
import { api, cleanParams, downloadFile, errorMessage } from "../api/client";
import type { AuditLog, Page } from "../api/types";
import PageHeader from "../components/common/PageHeader";
import StatusChip from "../components/common/StatusChip";
import Pager from "../components/common/Pager";
import KeyValueGrid from "../components/common/KeyValueGrid";
import { EmptyState, ErrorState, LoadingState } from "../components/common/States";
import { useNotify } from "../components/common/Notifier";
import { fmtDateTime, humanize, toIsoEnd, toIsoStart } from "../utils/format";

const EMPTY = { username: "", action: "", result: "", target: "", date_from: "", date_to: "" };

export default function AuditLogsPage() {
  const notify = useNotify();
  const [draft, setDraft] = useState(EMPTY);
  const [filters, setFilters] = useState(EMPTY);
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(25);
  const [detail, setDetail] = useState<AuditLog | null>(null);

  const actions = useQuery({ queryKey: ["audit-actions"], queryFn: async () => (await api.get<string[]>("/audit-logs/actions")).data });
  const params = cleanParams({ ...filters, date_from: toIsoStart(filters.date_from), date_to: toIsoEnd(filters.date_to) });
  const q = useQuery({
    queryKey: ["audit-logs", params, page, pageSize],
    queryFn: async () => (await api.get<Page<AuditLog>>("/audit-logs", { params: { ...params, page, page_size: pageSize } })).data,
    placeholderData: keepPreviousData,
  });
  const apply = (next = draft) => {
    setFilters(next);
    setPage(1);
  };

  return (
    <Box data-testid="audit-logs-page">
      <PageHeader
        title="Audit Logs"
        subtitle="Immutable record of user and system operations. Entries cannot be edited or deleted."
        actions={
          <Button
            startIcon={<FileDownloadOutlinedIcon />}
            onClick={async () => {
              try {
                await downloadFile("/audit-logs/export", params, "bell-stb-audit-log.csv");
                notify("Audit log exported");
              } catch (e) {
                notify(errorMessage(e, "Export failed"), "error");
              }
            }}
            data-testid="export-audit"
          >
            Export CSV
          </Button>
        }
      />
      <Card>
        <CardContent>
          <Grid container spacing={1.5} sx={{ mb: 2 }}>
            <Grid size={{ xs: 12, sm: 6, md: 2 }}>
              <TextField fullWidth label="Username" value={draft.username} onChange={(e) => setDraft({ ...draft, username: e.target.value })} onKeyDown={(e) => e.key === "Enter" && apply()} inputProps={{ "data-testid": "audit-username" }} />
            </Grid>
            <Grid size={{ xs: 12, sm: 6, md: 2.5 }}>
              <TextField select fullWidth label="Action" value={draft.action} onChange={(e) => setDraft({ ...draft, action: e.target.value })} SelectProps={{ inputProps: { "data-testid": "audit-action" }, MenuProps: { PaperProps: { sx: { maxHeight: 360 } } } }}>
                <MenuItem value="">All actions</MenuItem>
                {(actions.data ?? []).map((a) => <MenuItem key={a} value={a} data-testid="audit-action-option">{a}</MenuItem>)}
              </TextField>
            </Grid>
            <Grid size={{ xs: 6, md: 1.5 }}>
              <TextField select fullWidth label="Result" value={draft.result} onChange={(e) => setDraft({ ...draft, result: e.target.value })} SelectProps={{ inputProps: { "data-testid": "audit-result" } }}>
                <MenuItem value="">All</MenuItem>
                {["SUCCESS", "FAILURE", "DENIED"].map((r) => <MenuItem key={r} value={r}>{humanize(r)}</MenuItem>)}
              </TextField>
            </Grid>
            <Grid size={{ xs: 6, md: 1.5 }}>
              <TextField fullWidth label="Target" value={draft.target} onChange={(e) => setDraft({ ...draft, target: e.target.value })} inputProps={{ "data-testid": "audit-target" }} />
            </Grid>
            <Grid size={{ xs: 6, md: 1.5 }}>
              <TextField fullWidth type="date" label="From" InputLabelProps={{ shrink: true }} value={draft.date_from} onChange={(e) => setDraft({ ...draft, date_from: e.target.value })} inputProps={{ "data-testid": "audit-from" }} />
            </Grid>
            <Grid size={{ xs: 6, md: 1.5 }}>
              <TextField fullWidth type="date" label="To" InputLabelProps={{ shrink: true }} value={draft.date_to} onChange={(e) => setDraft({ ...draft, date_to: e.target.value })} inputProps={{ "data-testid": "audit-to" }} />
            </Grid>
            <Grid size={{ xs: 12, md: 1.5 }}>
              <Stack direction="row" spacing={1}>
                <Button variant="contained" onClick={() => apply()} data-testid="audit-apply">Apply</Button>
                <Button onClick={() => { setDraft(EMPTY); apply(EMPTY); }} data-testid="audit-reset">Reset</Button>
              </Stack>
            </Grid>
          </Grid>
          {q.isLoading ? (
            <LoadingState />
          ) : q.isError ? (
            <ErrorState error={q.error} />
          ) : !q.data?.items.length ? (
            <EmptyState title="No audit events match the filters" />
          ) : (
            <>
              <Typography variant="caption" color="text.secondary" data-testid="audit-total">{q.data.total} events</Typography>
              <TableContainer>
                <Table size="small" data-testid="audit-table">
                  <TableHead>
                    <TableRow>
                      <TableCell>Event ID</TableCell>
                      <TableCell>Timestamp</TableCell>
                      <TableCell>Username</TableCell>
                      <TableCell>Action</TableCell>
                      <TableCell>Target resource</TableCell>
                      <TableCell>Result</TableCell>
                      <TableCell>IP address</TableCell>
                    </TableRow>
                  </TableHead>
                  <TableBody>
                    {q.data.items.map((a) => (
                      <TableRow key={a.id} hover sx={{ cursor: "pointer" }} onClick={() => setDetail(a)} data-testid="audit-row" data-action={a.action} data-username={a.username} data-result={a.result} data-timestamp={a.created_at}>
                        <TableCell sx={{ fontFamily: "monospace" }} data-testid="cell-audit-id">{a.id}</TableCell>
                        <TableCell sx={{ whiteSpace: "nowrap" }}>{fmtDateTime(a.created_at)}</TableCell>
                        <TableCell sx={{ fontWeight: 600 }} data-testid="cell-audit-username">{a.username}</TableCell>
                        <TableCell data-testid="cell-audit-action">{a.action}</TableCell>
                        <TableCell data-testid="cell-audit-target">{a.target_type ? `${a.target_type}${a.target_id ? `: ${a.target_id}` : ""}` : "—"}</TableCell>
                        <TableCell><StatusChip value={a.result} /></TableCell>
                        <TableCell sx={{ fontFamily: "monospace" }}>{a.ip_address ?? "—"}</TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </TableContainer>
              <Pager total={q.data.total} page={page} pageSize={pageSize} onPage={setPage} onPageSize={(s) => { setPageSize(s); setPage(1); }} testId="audit-pagination" />
            </>
          )}
        </CardContent>
      </Card>
      <Dialog open={!!detail} onClose={() => setDetail(null)} maxWidth="sm" fullWidth data-testid="audit-detail-dialog">
        <DialogTitle>Audit event #{detail?.id}</DialogTitle>
        <DialogContent>
          {detail && (
            <>
              <KeyValueGrid
                columns={2}
                items={[
                  { label: "Timestamp", value: fmtDateTime(detail.created_at) },
                  { label: "Username", value: detail.username },
                  { label: "Action", value: detail.action },
                  { label: "Result", value: <StatusChip value={detail.result} /> },
                  { label: "Target", value: `${detail.target_type ?? "—"} ${detail.target_id ?? ""}` },
                  { label: "IP address", value: detail.ip_address ?? "—" },
                ]}
              />
              <Typography variant="caption" color="text.secondary" fontWeight={600} sx={{ mt: 2, display: "block" }}>DETAILS</Typography>
              <Box component="pre" sx={{ bgcolor: "#f5f7fa", p: 1.5, borderRadius: 1, fontSize: 12, overflow: "auto", maxHeight: 260 }} data-testid="audit-detail-json">
                {JSON.stringify(detail.details, null, 2)}
              </Box>
            </>
          )}
        </DialogContent>
        <DialogActions>
          <Button onClick={() => setDetail(null)}>Close</Button>
        </DialogActions>
      </Dialog>
    </Box>
  );
}
