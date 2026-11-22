import { Box, Button, Typography } from "@mui/material";
import LockOutlinedIcon from "@mui/icons-material/LockOutlined";
import { useNavigate } from "react-router-dom";

export default function AccessDenied() {
  const navigate = useNavigate();
  return (
    <Box sx={{ textAlign: "center", py: 10 }} data-testid="access-denied">
      <LockOutlinedIcon sx={{ fontSize: 56, color: "text.secondary" }} />
      <Typography variant="h5" sx={{ mt: 2 }}>
        Access denied
      </Typography>
      <Typography color="text.secondary" sx={{ mt: 1, mb: 3 }}>
        Your role does not have permission to view this page. Contact a portal administrator if you need access.
      </Typography>
      <Button variant="contained" onClick={() => navigate("/dashboard")}>
        Back to dashboard
      </Button>
    </Box>
  );
}
