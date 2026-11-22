import { NavLink } from "react-router-dom";
import { Box, Chip, List, ListItemButton, ListItemIcon, ListItemText, Typography } from "@mui/material";
import DashboardOutlinedIcon from "@mui/icons-material/DashboardOutlined";
import RouterOutlinedIcon from "@mui/icons-material/RouterOutlined";
import SettingsRemoteOutlinedIcon from "@mui/icons-material/SettingsRemoteOutlined";
import SystemUpdateAltOutlinedIcon from "@mui/icons-material/SystemUpdateAltOutlined";
import AppsOutlinedIcon from "@mui/icons-material/AppsOutlined";
import MonitorHeartOutlinedIcon from "@mui/icons-material/MonitorHeartOutlined";
import NotificationsActiveOutlinedIcon from "@mui/icons-material/NotificationsActiveOutlined";
import InsightsOutlinedIcon from "@mui/icons-material/InsightsOutlined";
import PeopleAltOutlinedIcon from "@mui/icons-material/PeopleAltOutlined";
import ReceiptLongOutlinedIcon from "@mui/icons-material/ReceiptLongOutlined";
import SettingsOutlinedIcon from "@mui/icons-material/SettingsOutlined";
import { BELL_RED, NAVY } from "../../theme";
import { useAuth } from "../../auth/AuthContext";

export const NAV_ITEMS = [
  { to: "/dashboard", label: "Dashboard", icon: <DashboardOutlinedIcon />, id: "dashboard" },
  { to: "/devices", label: "Device Inventory", icon: <RouterOutlinedIcon />, id: "device-inventory" },
  { to: "/device-management", label: "Device Management", icon: <SettingsRemoteOutlinedIcon />, id: "device-management" },
  { to: "/firmware", label: "Firmware Management", icon: <SystemUpdateAltOutlinedIcon />, id: "firmware" },
  { to: "/applications", label: "Application Management", icon: <AppsOutlinedIcon />, id: "applications" },
  { to: "/monitoring", label: "Monitoring & Diagnostics", icon: <MonitorHeartOutlinedIcon />, id: "monitoring" },
  { to: "/alerts", label: "Alerts & Notifications", icon: <NotificationsActiveOutlinedIcon />, id: "alerts" },
  { to: "/analytics", label: "Analytics & Reports", icon: <InsightsOutlinedIcon />, id: "analytics" },
  { to: "/users", label: "User Management", icon: <PeopleAltOutlinedIcon />, id: "users", permission: "users:manage" },
  { to: "/audit-logs", label: "Audit Logs", icon: <ReceiptLongOutlinedIcon />, id: "audit-logs", permission: "audit:view" },
  { to: "/settings", label: "Settings", icon: <SettingsOutlinedIcon />, id: "settings" },
];

export default function Sidebar({ onNavigate }: { onNavigate?: () => void }) {
  const { can } = useAuth();
  return (
    <Box sx={{ height: "100%", display: "flex", flexDirection: "column", bgcolor: NAVY, color: "#d6deea" }} data-testid="sidebar">
      <Box sx={{ px: 2.5, py: 2.25, borderBottom: "1px solid rgba(255,255,255,0.08)" }}>
        <Box sx={{ display: "flex", alignItems: "center", gap: 1.25 }}>
          <Box sx={{ width: 34, height: 34, borderRadius: 1, bgcolor: BELL_RED, display: "grid", placeItems: "center", fontWeight: 800, color: "#fff", fontSize: 13 }}>
            STB
          </Box>
          <Box>
            <Typography sx={{ color: "#fff", fontWeight: 800, letterSpacing: 1, fontSize: 15, lineHeight: 1.1 }}>BELL STB</Typography>
            <Typography sx={{ fontSize: 10.5, letterSpacing: 1.2, color: "#9fb0c8", fontWeight: 600 }}>DEVICE MANAGEMENT</Typography>
          </Box>
        </Box>
      </Box>
      <List sx={{ flex: 1, py: 1.5, overflowY: "auto" }} component="nav" aria-label="Main navigation">
        {NAV_ITEMS.filter((i) => !i.permission || can(i.permission)).map((item) => (
          <ListItemButton
            key={item.to}
            component={NavLink}
            to={item.to}
            onClick={onNavigate}
            data-testid={`nav-${item.id}`}
            sx={{
              mx: 1.25,
              mb: 0.25,
              borderRadius: 1,
              py: 0.9,
              color: "#c6d1e0",
              "& .MuiListItemIcon-root": { color: "#8fa3bf", minWidth: 36 },
              "&:hover": { bgcolor: "rgba(255,255,255,0.06)" },
              "&.active": {
                bgcolor: "rgba(225,37,27,0.16)",
                color: "#fff",
                boxShadow: `inset 3px 0 0 ${BELL_RED}`,
                "& .MuiListItemIcon-root": { color: "#ff6b62" },
              },
            }}
          >
            <ListItemIcon>{item.icon}</ListItemIcon>
            <ListItemText primary={item.label} primaryTypographyProps={{ fontSize: 13.5, fontWeight: 500 }} />
          </ListItemButton>
        ))}
      </List>
      <Box sx={{ p: 2, borderTop: "1px solid rgba(255,255,255,0.08)" }}>
        <Chip label="SIMULATED FLEET" size="small" sx={{ bgcolor: "rgba(255,255,255,0.08)", color: "#c6d1e0", fontSize: 10.5 }} data-testid="simulated-badge" />
        <Typography sx={{ fontSize: 10.5, color: "#7d8ea8", mt: 1 }}>
          Portfolio demo. Not an official Bell system.
        </Typography>
      </Box>
    </Box>
  );
}
