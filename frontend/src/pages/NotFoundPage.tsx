import { Box, Button, Typography } from "@mui/material";
import { useNavigate } from "react-router-dom";

export default function NotFoundPage() {
  const navigate = useNavigate();
  return (
    <Box sx={{ textAlign: "center", py: 10 }} data-testid="not-found">
      <Typography variant="h4">Page not found</Typography>
      <Typography color="text.secondary" sx={{ my: 2 }}>
        The page you requested does not exist in the device management portal.
      </Typography>
      <Button variant="contained" onClick={() => navigate("/dashboard")}>
        Go to dashboard
      </Button>
    </Box>
  );
}
