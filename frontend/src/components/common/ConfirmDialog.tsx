import { ReactNode, useEffect, useState } from "react";
import {
  Alert,
  Button,
  CircularProgress,
  Dialog,
  DialogActions,
  DialogContent,
  DialogContentText,
  DialogTitle,
  TextField,
} from "@mui/material";

export default function ConfirmDialog({
  open,
  title,
  message,
  confirmLabel = "Confirm",
  danger,
  requireText,
  requireTextLabel,
  loading,
  error,
  children,
  onConfirm,
  onClose,
  testId = "confirm-dialog",
  confirmDisabled,
}: {
  open: boolean;
  title: string;
  message: ReactNode;
  confirmLabel?: string;
  danger?: boolean;
  requireText?: string;
  requireTextLabel?: string;
  loading?: boolean;
  error?: string | null;
  children?: ReactNode;
  onConfirm: (typed: string) => void;
  onClose: () => void;
  testId?: string;
  confirmDisabled?: boolean;
}) {
  const [typed, setTyped] = useState("");
  useEffect(() => {
    if (open) setTyped("");
  }, [open]);
  const blocked = !!requireText && typed.trim().toUpperCase() !== requireText.toUpperCase();
  return (
    <Dialog open={open} onClose={loading ? undefined : onClose} maxWidth="sm" fullWidth data-testid={testId}>
      <DialogTitle>{title}</DialogTitle>
      <DialogContent>
        <DialogContentText component="div" sx={{ color: "text.primary" }}>
          {message}
        </DialogContentText>
        {children}
        {requireText && (
          <TextField
            fullWidth
            sx={{ mt: 2 }}
            label={requireTextLabel ?? `Type ${requireText} to confirm`}
            value={typed}
            onChange={(e) => setTyped(e.target.value)}
            inputProps={{ "data-testid": `${testId}-input` }}
            autoFocus
          />
        )}
        {error && (
          <Alert severity="error" sx={{ mt: 2 }} data-testid={`${testId}-error`}>
            {error}
          </Alert>
        )}
      </DialogContent>
      <DialogActions sx={{ px: 3, pb: 2 }}>
        <Button onClick={onClose} disabled={loading} data-testid={`${testId}-cancel`}>
          Cancel
        </Button>
        <Button
          variant="contained"
          color={danger ? "error" : "primary"}
          disabled={blocked || loading || confirmDisabled}
          onClick={() => onConfirm(typed)}
          data-testid={`${testId}-confirm`}
          startIcon={loading ? <CircularProgress size={16} color="inherit" /> : undefined}
        >
          {confirmLabel}
        </Button>
      </DialogActions>
    </Dialog>
  );
}
