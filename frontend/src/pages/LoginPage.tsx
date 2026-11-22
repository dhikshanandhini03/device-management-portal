import { FormEvent, useState } from "react";
import { useLocation, useNavigate, useSearchParams } from "react-router-dom";
import {
  Alert,
  Box,
  Button,
  Card,
  CardContent,
  CircularProgress,
  IconButton,
  InputAdornment,
  Stack,
  TextField,
  Typography,
} from "@mui/material";
import Visibility from "@mui/icons-material/Visibility";
import VisibilityOff from "@mui/icons-material/VisibilityOff";
import { useAuth } from "../auth/AuthContext";
import { DEMO_MODE, errorMessage } from "../api/client";
import { BELL_RED, NAVY } from "../theme";

export default function LoginPage() {
  const { login } = useAuth();
  const navigate = useNavigate();
  const location = useLocation();
  const [params] = useSearchParams();
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [show, setShow] = useState(false);
  const [touched, setTouched] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const usernameError = touched && !username.trim() ? "Username or email is required" : "";
  const passwordError = touched && !password ? "Password is required" : "";

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    setTouched(true);
    setError(null);
    if (!username.trim() || !password) return;
    setLoading(true);
    try {
      await login(username.trim(), password);
      const from = (location.state as { from?: string } | null)?.from;
      navigate(from && from !== "/login" ? from : "/dashboard", { replace: true });
    } catch (err) {
      setError(errorMessage(err, "Sign-in failed"));
    } finally {
      setLoading(false);
    }
  };

  return (
    <Box sx={{ minHeight: "100vh", display: "grid", gridTemplateColumns: { xs: "1fr", md: "1.1fr 1fr" }, bgcolor: "#f3f5f8" }}>
      <Box
        sx={{
          display: { xs: "none", md: "flex" },
          flexDirection: "column",
          justifyContent: "space-between",
          p: 6,
          color: "#fff",
          background: `linear-gradient(160deg, ${NAVY} 0%, #10294d 100%)`,
        }}
      >
        <Stack direction="row" spacing={1.5} alignItems="center">
          <Box sx={{ width: 40, height: 40, borderRadius: 1, bgcolor: BELL_RED, display: "grid", placeItems: "center", fontWeight: 800 }}>STB</Box>
          <Box>
            <Typography sx={{ fontWeight: 800, letterSpacing: 1.2 }}>BELL STB</Typography>
            <Typography sx={{ fontSize: 11, letterSpacing: 1.4, color: "#9fb0c8" }}>DEVICE MANAGEMENT</Typography>
          </Box>
        </Stack>
        <Box>
          <Typography variant="h4" sx={{ fontSize: 30, fontWeight: 700, mb: 2, maxWidth: 480 }}>
            Fleet operations console for set-top box support teams
          </Typography>
          <Typography sx={{ color: "#b7c4d8", maxWidth: 480 }}>
            Monitor device health, run remote diagnostics, orchestrate firmware rollouts and keep a complete audit trail of every
            operation across the STB fleet.
          </Typography>
        </Box>
        <Typography sx={{ fontSize: 12, color: "#7d8ea8" }}>
          Simulated environment for engineering and test automation. Not an official Bell Canada production system.
        </Typography>
      </Box>
      <Box sx={{ display: "flex", alignItems: "center", justifyContent: "center", p: 3 }}>
        <Card sx={{ width: "100%", maxWidth: 420 }}>
          <CardContent sx={{ p: 4 }}>
            <Typography variant="h5" component="h1" data-testid="login-title">
              Sign in
            </Typography>
            <Typography variant="body2" color="text.secondary" sx={{ mb: 3 }}>
              Use your portal account to continue.
            </Typography>
            {DEMO_MODE && (
              <Alert severity="info" sx={{ mb: 2 }} data-testid="demo-mode-banner">
                Demo mode: the portal runs entirely in your browser with simulated devices. Sign in as <b>admin</b> / <b>Admin@12345</b>,{" "}
                <b>support</b> / <b>Support@12345</b> or <b>readonly</b> / <b>Readonly@12345</b>.{" "}
                <a href={`${import.meta.env.BASE_URL}login?reset-demo=1`} data-testid="demo-reset">Reset demo data</a>
              </Alert>
            )}
            {params.get("expired") && !error && (
              <Alert severity="warning" sx={{ mb: 2 }} data-testid="session-expired">
                Your session has expired. Please sign in again.
              </Alert>
            )}
            {error && (
              <Alert severity="error" sx={{ mb: 2 }} data-testid="login-error">
                {error}
              </Alert>
            )}
            <Box component="form" onSubmit={submit} noValidate>
              <TextField
                fullWidth
                label="Username or email"
                autoComplete="username"
                value={username}
                onChange={(e) => setUsername(e.target.value)}
                error={!!usernameError}
                helperText={usernameError || " "}
                inputProps={{ "data-testid": "login-username" }}
                FormHelperTextProps={{ "data-testid": "login-username-error" } as object}
                size="medium"
                autoFocus
              />
              <TextField
                fullWidth
                label="Password"
                type={show ? "text" : "password"}
                autoComplete="current-password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                error={!!passwordError}
                helperText={passwordError || " "}
                inputProps={{ "data-testid": "login-password" }}
                FormHelperTextProps={{ "data-testid": "login-password-error" } as object}
                size="medium"
                sx={{ mt: 1 }}
                InputProps={{
                  endAdornment: (
                    <InputAdornment position="end">
                      <IconButton
                        onClick={() => setShow((s) => !s)}
                        edge="end"
                        aria-label={show ? "Hide password" : "Show password"}
                        data-testid="toggle-password-visibility"
                      >
                        {show ? <VisibilityOff /> : <Visibility />}
                      </IconButton>
                    </InputAdornment>
                  ),
                }}
              />
              <Button
                type="submit"
                fullWidth
                variant="contained"
                color="secondary"
                size="large"
                disabled={loading}
                sx={{ mt: 2, py: 1.2 }}
                data-testid="login-submit"
                startIcon={loading ? <CircularProgress size={18} color="inherit" /> : undefined}
              >
                {loading ? "Signing in…" : "Sign in"}
              </Button>
            </Box>
          </CardContent>
        </Card>
      </Box>
    </Box>
  );
}
