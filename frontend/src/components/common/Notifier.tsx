import { createContext, ReactNode, useCallback, useContext, useState } from "react";
import { Alert, Snackbar } from "@mui/material";

type Severity = "success" | "error" | "info" | "warning";
interface Toast {
  id: number;
  message: string;
  severity: Severity;
}

const NotifyContext = createContext<(message: string, severity?: Severity) => void>(() => undefined);

export function NotificationProvider({ children }: { children: ReactNode }) {
  const [toast, setToast] = useState<Toast | null>(null);
  const notify = useCallback((message: string, severity: Severity = "success") => {
    setToast({ id: Date.now(), message, severity });
  }, []);
  return (
    <NotifyContext.Provider value={notify}>
      {children}
      <Snackbar
        key={toast?.id}
        open={!!toast}
        autoHideDuration={5000}
        onClose={(_, reason) => reason !== "clickaway" && setToast(null)}
        anchorOrigin={{ vertical: "bottom", horizontal: "right" }}
      >
        {toast ? (
          <Alert
            severity={toast.severity}
            variant="filled"
            onClose={() => setToast(null)}
            data-testid="toast"
            data-severity={toast.severity}
            sx={{ minWidth: 320 }}
          >
            {toast.message}
          </Alert>
        ) : undefined}
      </Snackbar>
    </NotifyContext.Provider>
  );
}

export function useNotify() {
  return useContext(NotifyContext);
}
