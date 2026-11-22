import { useState } from "react";
import { Outlet } from "react-router-dom";
import { Box, Drawer } from "@mui/material";
import Sidebar from "./Sidebar";
import TopBar from "./TopBar";

const WIDTH = 256;

export default function AppLayout() {
  const [open, setOpen] = useState(false);
  return (
    <Box sx={{ display: "flex", minHeight: "100vh" }}>
      <Box component="aside" sx={{ width: { lg: WIDTH }, flexShrink: 0 }}>
        <Drawer variant="temporary" open={open} onClose={() => setOpen(false)} sx={{ display: { xs: "block", lg: "none" }, "& .MuiDrawer-paper": { width: WIDTH, border: 0 } }}>
          <Sidebar onNavigate={() => setOpen(false)} />
        </Drawer>
        <Drawer variant="permanent" open sx={{ display: { xs: "none", lg: "block" }, "& .MuiDrawer-paper": { width: WIDTH, border: 0 } }}>
          <Sidebar />
        </Drawer>
      </Box>
      <Box sx={{ flex: 1, minWidth: 0, display: "flex", flexDirection: "column" }}>
        <TopBar onMenu={() => setOpen(true)} />
        <Box component="main" sx={{ p: { xs: 2, md: 3 }, flex: 1 }} data-testid="main-content">
          <Outlet />
        </Box>
      </Box>
    </Box>
  );
}
