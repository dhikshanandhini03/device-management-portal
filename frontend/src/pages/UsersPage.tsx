import { useState } from "react";
import { keepPreviousData, useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  Alert,
  Box,
  Button,
  Card,
  CardContent,
  Dialog,
  DialogActions,
  DialogContent,
  DialogTitle,
  FormControlLabel,
  IconButton,
  InputAdornment,
  MenuItem,
  Stack,
  Switch,
  Tab,
  Table,
  TableBody,
  TableCell,
  TableContainer,
  TableHead,
  TableRow,
  Tabs,
  TextField,
  Tooltip,
  Typography,
} from "@mui/material";
import Grid from "@mui/material/Grid2";
import AddIcon from "@mui/icons-material/Add";
import SearchIcon from "@mui/icons-material/Search";
import EditOutlinedIcon from "@mui/icons-material/EditOutlined";
import HistoryIcon from "@mui/icons-material/History";
import BlockIcon from "@mui/icons-material/Block";
import CheckCircleOutlineIcon from "@mui/icons-material/CheckCircleOutline";
import { api, cleanParams, errorMessage } from "../api/client";
import type { AuditLog, Page, UserRecord } from "../api/types";
import PageHeader from "../components/common/PageHeader";
import StatusChip from "../components/common/StatusChip";
import Pager from "../components/common/Pager";
import ConfirmDialog from "../components/common/ConfirmDialog";
import { EmptyState, ErrorState, LoadingState } from "../components/common/States";
import { useNotify } from "../components/common/Notifier";
import { ROLE_LABELS, useAuth } from "../auth/AuthContext";
import { fmtDateTime, fmtRelative, humanize } from "../utils/format";

const ROLES = ["ADMIN", "SUPPORT_ENGINEER", "READ_ONLY"];
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const USERNAME_RE = /^[a-zA-Z0-9._-]{3,64}$/;

function passwordProblem(p: string): string {
  if (p.length < 8) return "At least 8 characters";
  if (!/[A-Z]/.test(p) || !/[a-z]/.test(p) || !/[0-9]/.test(p) || !/[^A-Za-z0-9]/.test(p)) return "Needs upper, lower, digit and special character";
  return "";
}

function UserFormDialog({ user, onClose }: { user: UserRecord | null | "new"; onClose: () => void }) {
  const isNew = user === "new";
  const existing = isNew ? null : user;
  const notify = useNotify();
  const qc = useQueryClient();
  const [form, setForm] = useState({
    username: existing?.username ?? "",
    full_name: existing?.full_name ?? "",
    email: existing?.email ?? "",
    role: existing?.role ?? "READ_ONLY",
    password: "",
    is_active: existing?.is_active ?? true,
  });
  const [touched, setTouched] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const errors = {
    username: isNew && !USERNAME_RE.test(form.username) ? "3-64 characters: letters, digits, . _ -" : "",
    full_name: form.full_name.trim().length < 2 ? "Full name is required" : "",
    email: !EMAIL_RE.test(form.email) ? "Enter a valid email address" : "",
    password: isNew || form.password ? passwordProblem(form.password) : "",
  };
  const valid = Object.values(errors).every((e) => !e);
  const mutation = useMutation({
    mutationFn: async () => {
      if (isNew) return (await api.post<UserRecord>("/users", form)).data;
      const body: Record<string, unknown> = { full_name: form.full_name, email: form.email, role: form.role, is_active: form.is_active };
      if (form.password) body.password = form.password;
      return (await api.patch<UserRecord>(`/users/${existing!.id}`, body)).data;
    },
    onSuccess: (u) => {
      notify(isNew ? `User ${u.username} created` : `User ${u.username} updated`);
      qc.invalidateQueries({ queryKey: ["users"] });
      onClose();
    },
    onError: (e) => setError(errorMessage(e, "Save failed")),
  });
  const field = (k: "username" | "full_name" | "email" | "password") => ({
    value: form[k],
    onChange: (e: { target: { value: string } }) => setForm((f) => ({ ...f, [k]: e.target.value })),
    error: touched && !!errors[k],
    helperText: (touched && errors[k]) || " ",
  });
  return (
    <Dialog open onClose={onClose} maxWidth="sm" fullWidth data-testid="user-form-dialog">
      <DialogTitle>{isNew ? "Create user" : `Edit ${existing?.username}`}</DialogTitle>
      <DialogContent>
        <Grid container spacing={1.5} sx={{ mt: 0.5 }}>
          <Grid size={6}>
            <TextField fullWidth label="Username" disabled={!isNew} {...field("username")} inputProps={{ "data-testid": "user-username" }} FormHelperTextProps={{ "data-testid": "user-username-error" } as object} />
          </Grid>
          <Grid size={6}>
            <TextField fullWidth label="Full name" {...field("full_name")} inputProps={{ "data-testid": "user-fullname" }} FormHelperTextProps={{ "data-testid": "user-fullname-error" } as object} />
          </Grid>
          <Grid size={12}>
            <TextField fullWidth label="Email" type="email" {...field("email")} inputProps={{ "data-testid": "user-email" }} FormHelperTextProps={{ "data-testid": "user-email-error" } as object} />
          </Grid>
          <Grid size={6}>
            <TextField select fullWidth label="Role" value={form.role} onChange={(e) => setForm((f) => ({ ...f, role: e.target.value as UserRecord["role"] }))} SelectProps={{ inputProps: { "data-testid": "user-role" } }} helperText=" ">
              {ROLES.map((r) => <MenuItem key={r} value={r} data-testid={`role-option-${r}`}>{ROLE_LABELS[r]}</MenuItem>)}
            </TextField>
          </Grid>
          <Grid size={6}>
            <TextField fullWidth type="password" label={isNew ? "Initial password" : "Reset password (optional)"} autoComplete="new-password" {...field("password")} inputProps={{ "data-testid": "user-password" }} FormHelperTextProps={{ "data-testid": "user-password-error" } as object} />
          </Grid>
          <Grid size={12}>
            <FormControlLabel control={<Switch checked={form.is_active} onChange={(e) => setForm((f) => ({ ...f, is_active: e.target.checked }))} inputProps={{ "data-testid": "user-active" } as object} />} label="Account active" />
          </Grid>
        </Grid>
        {error && <Alert severity="error" sx={{ mt: 1 }} data-testid="user-form-error">{error}</Alert>}
      </DialogContent>
      <DialogActions sx={{ px: 3, pb: 2 }}>
        <Button onClick={onClose}>Cancel</Button>
        <Button
          variant="contained"
          disabled={mutation.isPending}
          onClick={() => {
            setTouched(true);
            setError(null);
            if (valid) mutation.mutate();
          }}
          data-testid="user-form-submit"
        >
          {isNew ? "Create user" : "Save changes"}
        </Button>
      </DialogActions>
    </Dialog>
  );
}

function HistoryDialog({ user, onClose }: { user: UserRecord; onClose: () => void }) {
  const [tab, setTab] = useState<"login-history" | "activity">("login-history");
  const [page, setPage] = useState(1);
  const q = useQuery({
    queryKey: ["user-history", user.id, tab, page],
    queryFn: async () => (await api.get<Page<AuditLog>>(`/users/${user.id}/${tab}`, { params: { page, page_size: 10 } })).data,
    placeholderData: keepPreviousData,
  });
  return (
    <Dialog open onClose={onClose} maxWidth="md" fullWidth data-testid="user-history-dialog">
      <DialogTitle>{user.full_name} ({user.username})</DialogTitle>
      <DialogContent>
        <Tabs value={tab} onChange={(_, v) => { setTab(v); setPage(1); }} sx={{ mb: 1 }}>
          <Tab value="login-history" label="Login history" data-testid="tab-login-history" />
          <Tab value="activity" label="User activity" data-testid="tab-user-activity" />
        </Tabs>
        {q.isLoading ? (
          <LoadingState />
        ) : !q.data?.items.length ? (
          <EmptyState title="No records" />
        ) : (
          <>
            <Table size="small" data-testid="user-history-table">
              <TableHead>
                <TableRow>
                  <TableCell>Timestamp</TableCell>
                  <TableCell>Action</TableCell>
                  <TableCell>Target</TableCell>
                  <TableCell>Result</TableCell>
                  <TableCell>IP address</TableCell>
                </TableRow>
              </TableHead>
              <TableBody>
                {q.data.items.map((a) => (
                  <TableRow key={a.id} data-testid="user-history-row">
                    <TableCell sx={{ whiteSpace: "nowrap" }}>{fmtDateTime(a.created_at)}</TableCell>
                    <TableCell>{humanize(a.action)}</TableCell>
                    <TableCell>{a.target_id ?? "—"}</TableCell>
                    <TableCell><StatusChip value={a.result} /></TableCell>
                    <TableCell>{a.ip_address ?? "—"}</TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
            <Pager total={q.data.total} page={page} pageSize={10} onPage={setPage} />
          </>
        )}
      </DialogContent>
      <DialogActions>
        <Button onClick={onClose}>Close</Button>
      </DialogActions>
    </Dialog>
  );
}

export default function UsersPage() {
  const { user: me } = useAuth();
  const notify = useNotify();
  const qc = useQueryClient();
  const [search, setSearch] = useState("");
  const [role, setRole] = useState("");
  const [active, setActive] = useState("");
  const [page, setPage] = useState(1);
  const [editing, setEditing] = useState<UserRecord | "new" | null>(null);
  const [history, setHistory] = useState<UserRecord | null>(null);
  const [toggle, setToggle] = useState<UserRecord | null>(null);
  const [error, setError] = useState<string | null>(null);

  const q = useQuery({
    queryKey: ["users", search, role, active, page],
    queryFn: async () => (await api.get<Page<UserRecord>>("/users", { params: cleanParams({ search, role, is_active: active, page, page_size: 20 }) })).data,
    placeholderData: keepPreviousData,
  });
  const toggleMutation = useMutation({
    mutationFn: async (u: UserRecord) => (await api.post<UserRecord>(`/users/${u.id}/${u.is_active ? "deactivate" : "activate"}`)).data,
    onSuccess: (u) => {
      notify(`User ${u.username} ${u.is_active ? "activated" : "deactivated"}`);
      setToggle(null);
      qc.invalidateQueries({ queryKey: ["users"] });
    },
    onError: (e) => setError(errorMessage(e)),
  });

  return (
    <Box data-testid="users-page">
      <PageHeader
        title="User Management"
        subtitle="Portal accounts, roles and access history. Administrator only."
        actions={<Button variant="contained" startIcon={<AddIcon />} onClick={() => setEditing("new")} data-testid="create-user">Create user</Button>}
      />
      <Card>
        <CardContent>
          <Stack direction="row" spacing={1.5} sx={{ mb: 2 }} flexWrap="wrap" useFlexGap>
            <TextField
              placeholder="Search username, name or email"
              value={search}
              onChange={(e) => { setSearch(e.target.value); setPage(1); }}
              sx={{ minWidth: 280 }}
              inputProps={{ "data-testid": "user-search" }}
              InputProps={{ startAdornment: <InputAdornment position="start"><SearchIcon fontSize="small" /></InputAdornment> }}
            />
            <TextField select label="Role" value={role} onChange={(e) => { setRole(e.target.value); setPage(1); }} sx={{ minWidth: 180 }} SelectProps={{ inputProps: { "data-testid": "user-role-filter" } }}>
              <MenuItem value="">All roles</MenuItem>
              {ROLES.map((r) => <MenuItem key={r} value={r}>{ROLE_LABELS[r]}</MenuItem>)}
            </TextField>
            <TextField select label="Status" value={active} onChange={(e) => { setActive(e.target.value); setPage(1); }} sx={{ minWidth: 150 }} SelectProps={{ inputProps: { "data-testid": "user-status-filter" } }}>
              <MenuItem value="">All</MenuItem>
              <MenuItem value="true">Active</MenuItem>
              <MenuItem value="false">Inactive</MenuItem>
            </TextField>
          </Stack>
          {q.isLoading ? (
            <LoadingState />
          ) : q.isError ? (
            <ErrorState error={q.error} />
          ) : !q.data?.items.length ? (
            <EmptyState title="No users found" />
          ) : (
            <>
              <TableContainer>
                <Table size="small" data-testid="users-table">
                  <TableHead>
                    <TableRow>
                      <TableCell>Username</TableCell>
                      <TableCell>Full name</TableCell>
                      <TableCell>Email</TableCell>
                      <TableCell>Role</TableCell>
                      <TableCell>Status</TableCell>
                      <TableCell>Last login</TableCell>
                      <TableCell>Created</TableCell>
                      <TableCell align="right">Actions</TableCell>
                    </TableRow>
                  </TableHead>
                  <TableBody>
                    {q.data.items.map((u) => (
                      <TableRow key={u.id} hover data-testid="user-row" data-username={u.username}>
                        <TableCell sx={{ fontWeight: 600 }} data-testid="cell-username">{u.username}</TableCell>
                        <TableCell data-testid="cell-fullname">{u.full_name}</TableCell>
                        <TableCell data-testid="cell-email">{u.email}</TableCell>
                        <TableCell data-testid="cell-role" data-role={u.role}>{ROLE_LABELS[u.role]}</TableCell>
                        <TableCell data-testid="cell-user-status"><StatusChip value={u.is_active ? "ACTIVE" : "INACTIVE"} /></TableCell>
                        <TableCell>{fmtRelative(u.last_login_at)}</TableCell>
                        <TableCell>{fmtDateTime(u.created_at)}</TableCell>
                        <TableCell align="right" sx={{ whiteSpace: "nowrap" }}>
                          <Tooltip title="Edit">
                            <IconButton size="small" onClick={() => setEditing(u)} data-testid="user-edit" aria-label={`Edit ${u.username}`}><EditOutlinedIcon fontSize="small" /></IconButton>
                          </Tooltip>
                          <Tooltip title="Login history & activity">
                            <IconButton size="small" onClick={() => setHistory(u)} data-testid="user-history" aria-label={`History for ${u.username}`}><HistoryIcon fontSize="small" /></IconButton>
                          </Tooltip>
                          <Tooltip title={u.id === me?.id ? "You cannot deactivate your own account" : u.is_active ? "Deactivate" : "Activate"}>
                            <span>
                              <IconButton size="small" disabled={u.id === me?.id} onClick={() => { setError(null); setToggle(u); }} data-testid={u.is_active ? "user-deactivate" : "user-activate"} aria-label={`${u.is_active ? "Deactivate" : "Activate"} ${u.username}`}>
                                {u.is_active ? <BlockIcon fontSize="small" color="error" /> : <CheckCircleOutlineIcon fontSize="small" color="success" />}
                              </IconButton>
                            </span>
                          </Tooltip>
                        </TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </TableContainer>
              <Pager total={q.data.total} page={page} pageSize={20} onPage={setPage} testId="users-pagination" />
            </>
          )}
        </CardContent>
      </Card>
      {editing && <UserFormDialog key={editing === "new" ? "new" : editing.id} user={editing} onClose={() => setEditing(null)} />}
      {history && <HistoryDialog user={history} onClose={() => setHistory(null)} />}
      <ConfirmDialog
        open={!!toggle}
        title={toggle?.is_active ? `Deactivate ${toggle?.username}?` : `Activate ${toggle?.username}?`}
        message={
          <Typography variant="body2">
            {toggle?.is_active ? "The user will no longer be able to sign in. Existing records are preserved." : "The user will be able to sign in again with their existing password."}
          </Typography>
        }
        danger={toggle?.is_active}
        confirmLabel={toggle?.is_active ? "Deactivate" : "Activate"}
        loading={toggleMutation.isPending}
        error={error}
        onConfirm={() => toggle && toggleMutation.mutate(toggle)}
        onClose={() => setToggle(null)}
        testId="user-toggle-dialog"
      />
    </Box>
  );
}
