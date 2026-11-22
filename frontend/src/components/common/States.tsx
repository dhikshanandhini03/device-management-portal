import { ReactNode } from "react";
import { Alert, AlertTitle, Box, Button, CircularProgress, Stack, Typography } from "@mui/material";
import InboxOutlinedIcon from "@mui/icons-material/InboxOutlined";
import { errorMessage } from "../../api/client";

export function LoadingState({ label = "Loading…", minHeight = 160 }: { label?: string; minHeight?: number }) {
  return (
    <Stack alignItems="center" justifyContent="center" spacing={1.5} sx={{ minHeight }} data-testid="loading-state">
      <CircularProgress size={28} />
      <Typography variant="body2" color="text.secondary">
        {label}
      </Typography>
    </Stack>
  );
}

export function ErrorState({ error, onRetry, title = "Unable to load data" }: { error: unknown; onRetry?: () => void; title?: string }) {
  return (
    <Alert
      severity="error"
      data-testid="error-state"
      action={
        onRetry && (
          <Button color="inherit" size="small" onClick={onRetry}>
            Retry
          </Button>
        )
      }
    >
      <AlertTitle>{title}</AlertTitle>
      {errorMessage(error)}
    </Alert>
  );
}

export function EmptyState({ title = "No records found", description, action }: { title?: string; description?: ReactNode; action?: ReactNode }) {
  return (
    <Box sx={{ py: 5, textAlign: "center", color: "text.secondary" }} data-testid="empty-state">
      <InboxOutlinedIcon sx={{ fontSize: 40, opacity: 0.5 }} />
      <Typography variant="subtitle1" sx={{ mt: 1, color: "text.primary" }}>
        {title}
      </Typography>
      {description && <Typography variant="body2">{description}</Typography>}
      {action && <Box sx={{ mt: 1.5 }}>{action}</Box>}
    </Box>
  );
}
