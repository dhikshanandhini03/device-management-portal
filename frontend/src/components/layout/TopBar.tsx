import { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import { useQuery } from "@tanstack/react-query";
import {
  AppBar,
  Autocomplete,
  Avatar,
  Badge,
  Box,
  Divider,
  IconButton,
  InputAdornment,
  ListItemIcon,
  Menu,
  MenuItem,
  TextField,
  Toolbar,
  Tooltip,
  Typography,
} from "@mui/material";
import MenuIcon from "@mui/icons-material/Menu";
import SearchIcon from "@mui/icons-material/Search";
import NotificationsNoneIcon from "@mui/icons-material/NotificationsNone";
import LogoutIcon from "@mui/icons-material/Logout";
import PersonOutlineIcon from "@mui/icons-material/PersonOutline";
import { api } from "../../api/client";
import type { Alert, Device, Page } from "../../api/types";
import { ROLE_LABELS, useAuth } from "../../auth/AuthContext";
import StatusChip from "../common/StatusChip";
import { fmtRelative } from "../../utils/format";

function useDebounced<T>(value: T, ms = 300): T {
  const [v, setV] = useState(value);
  useEffect(() => {
    const id = setTimeout(() => setV(value), ms);
    return () => clearTimeout(id);
  }, [value, ms]);
  return v;
}

function GlobalSearch() {
  const navigate = useNavigate();
  const [input, setInput] = useState("");
  const q = useDebounced(input.trim());
  const { data = [], isFetching } = useQuery({
    queryKey: ["global-search", q],
    queryFn: async () => (await api.get<Device[]>("/search", { params: { q } })).data,
    enabled: q.length >= 2,
  });
  return (
    <Autocomplete
      freeSolo
      size="small"
      sx={{ width: { xs: 200, md: 380 } }}
      options={q.length >= 2 ? data : []}
      loading={isFetching}
      filterOptions={(x) => x}
      getOptionLabel={(o) => (typeof o === "string" ? o : o.device_id)}
      inputValue={input}
      onInputChange={(_, v) => setInput(v)}
      onChange={(_, value) => {
        if (value && typeof value !== "string") {
          navigate(`/devices/${value.device_id}`);
          setInput("");
        } else if (typeof value === "string" && value.trim()) {
          navigate(`/devices?search=${encodeURIComponent(value.trim())}`);
          setInput("");
        }
      }}
      renderOption={(props, o) => {
        const { key, ...rest } = props as typeof props & { key: string };
        return (
          <li key={key} {...rest} data-testid="global-search-option">
            <Box sx={{ display: "flex", justifyContent: "space-between", width: "100%", gap: 1 }}>
              <Box>
                <Typography variant="body2" fontWeight={600}>
                  {o.device_id}
                </Typography>
                <Typography variant="caption" color="text.secondary">
                  {o.serial_number} · {o.mac_address} · {o.model}
                </Typography>
              </Box>
              <StatusChip value={o.connection_status} />
            </Box>
          </li>
        );
      }}
      renderInput={(params) => (
        <TextField
          {...params}
          placeholder="Search device ID, serial, MAC, account…"
          InputProps={{
            ...params.InputProps,
            startAdornment: (
              <InputAdornment position="start">
                <SearchIcon fontSize="small" />
              </InputAdornment>
            ),
          }}
          inputProps={{ ...params.inputProps, "data-testid": "global-search", "aria-label": "Global device search" }}
          sx={{ "& .MuiOutlinedInput-root": { bgcolor: "#f3f5f8" } }}
        />
      )}
    />
  );
}

function Notifications() {
  const navigate = useNavigate();
  const { can } = useAuth();
  const [anchor, setAnchor] = useState<HTMLElement | null>(null);
  const { data } = useQuery({
    queryKey: ["topbar-alerts"],
    queryFn: async () => (await api.get<Page<Alert>>("/alerts", { params: { status: "OPEN", page_size: 6 } })).data,
    refetchInterval: 30000,
    enabled: can("alerts:view"),
  });
  const count = data?.total ?? 0;
  return (
    <>
      <Tooltip title="Notifications">
        <IconButton onClick={(e) => setAnchor(e.currentTarget)} data-testid="notifications-button" aria-label="Notifications">
          <Badge badgeContent={count} color="secondary" max={99} data-testid="notifications-count">
            <NotificationsNoneIcon />
          </Badge>
        </IconButton>
      </Tooltip>
      <Menu anchorEl={anchor} open={!!anchor} onClose={() => setAnchor(null)} PaperProps={{ sx: { width: 380 } }} data-testid="notifications-menu">
        <Box sx={{ px: 2, py: 1 }}>
          <Typography variant="subtitle2">Open alerts ({count})</Typography>
        </Box>
        <Divider />
        {(data?.items ?? []).map((a) => (
          <MenuItem
            key={a.id}
            onClick={() => {
              setAnchor(null);
              navigate(`/devices/${a.device_id}`);
            }}
            sx={{ whiteSpace: "normal", alignItems: "flex-start", gap: 1 }}
          >
            <StatusChip value={a.severity} />
            <Box>
              <Typography variant="body2" fontWeight={600}>
                {a.title} · {a.device_id}
              </Typography>
              <Typography variant="caption" color="text.secondary">
                {fmtRelative(a.created_at)}
              </Typography>
            </Box>
          </MenuItem>
        ))}
        {count === 0 && <MenuItem disabled>No open alerts</MenuItem>}
        <Divider />
        <MenuItem
          onClick={() => {
            setAnchor(null);
            navigate("/alerts");
          }}
          sx={{ justifyContent: "center", fontWeight: 600, color: "primary.main" }}
        >
          View all alerts
        </MenuItem>
      </Menu>
    </>
  );
}

export default function TopBar({ onMenu }: { onMenu: () => void }) {
  const { user, logout } = useAuth();
  const navigate = useNavigate();
  const [anchor, setAnchor] = useState<HTMLElement | null>(null);
  const initials = (user?.full_name ?? "?")
    .split(" ")
    .map((p) => p[0])
    .join("")
    .slice(0, 2)
    .toUpperCase();
  return (
    <AppBar position="sticky" color="inherit" elevation={0} sx={{ borderBottom: "1px solid", borderColor: "divider", bgcolor: "#fff" }}>
      <Toolbar sx={{ gap: 2, minHeight: 60 }}>
        <IconButton onClick={onMenu} sx={{ display: { lg: "none" } }} aria-label="Open navigation">
          <MenuIcon />
        </IconButton>
        <Typography variant="h6" sx={{ display: { xs: "none", md: "block" }, fontWeight: 700, color: "primary.dark", whiteSpace: "nowrap" }} data-testid="app-title">
          BELL STB DEVICE MANAGEMENT
        </Typography>
        <Box sx={{ flex: 1, display: "flex", justifyContent: "center" }}>
          <GlobalSearch />
        </Box>
        <Notifications />
        <Box sx={{ display: "flex", alignItems: "center", gap: 1.25, cursor: "pointer" }} onClick={(e) => setAnchor(e.currentTarget)} data-testid="profile-menu-button">
          <Box sx={{ textAlign: "right", display: { xs: "none", sm: "block" } }}>
            <Typography variant="body2" fontWeight={600} data-testid="current-username">
              {user?.full_name}
            </Typography>
            <Typography variant="caption" color="text.secondary" data-testid="current-role">
              {ROLE_LABELS[user?.role ?? ""] ?? user?.role}
            </Typography>
          </Box>
          <Avatar sx={{ width: 36, height: 36, bgcolor: "primary.dark", fontSize: 14 }}>{initials}</Avatar>
        </Box>
        <Menu anchorEl={anchor} open={!!anchor} onClose={() => setAnchor(null)} data-testid="profile-menu">
          <Box sx={{ px: 2, py: 1 }}>
            <Typography variant="subtitle2">{user?.username}</Typography>
            <Typography variant="caption" color="text.secondary">
              {user?.email}
            </Typography>
          </Box>
          <Divider />
          <MenuItem
            onClick={() => {
              setAnchor(null);
              navigate("/settings");
            }}
          >
            <ListItemIcon>
              <PersonOutlineIcon fontSize="small" />
            </ListItemIcon>
            Profile & settings
          </MenuItem>
          <MenuItem
            data-testid="logout-button"
            onClick={() => {
              setAnchor(null);
              void logout("manual");
            }}
          >
            <ListItemIcon>
              <LogoutIcon fontSize="small" />
            </ListItemIcon>
            Logout
          </MenuItem>
        </Menu>
      </Toolbar>
    </AppBar>
  );
}
