import { Chip, ChipProps } from "@mui/material";
import { humanize } from "../../utils/format";

type Color = ChipProps["color"];

const COLOR_MAP: Record<string, Color> = {
  ONLINE: "success",
  OFFLINE: "default",
  REBOOTING: "info",
  HEALTHY: "success",
  WARNING: "warning",
  CRITICAL: "error",
  ERROR: "error",
  INFO: "info",
  OPEN: "error",
  ACKNOWLEDGED: "warning",
  RESOLVED: "success",
  PENDING: "default",
  QUEUED: "default",
  SENT: "info",
  EXECUTING: "info",
  SUCCESSFUL: "success",
  SUCCESS: "success",
  FAILED: "error",
  FAILURE: "error",
  DENIED: "error",
  TIMED_OUT: "warning",
  SCHEDULED: "default",
  IN_PROGRESS: "info",
  DOWNLOADING: "info",
  INSTALLING: "info",
  COMPLETED: "success",
  COMPLETED_WITH_ERRORS: "warning",
  CANCELLED: "default",
  ROLLED_BACK: "secondary",
  ACTIVE: "success",
  BETA: "info",
  DEPRECATED: "default",
  INSTALLED: "success",
  UPDATE_AVAILABLE: "warning",
  INSTALL_FAILED: "error",
  INACTIVE: "default",
};

export default function StatusChip({ value, testId, size = "small" }: { value?: string | null; testId?: string; size?: "small" | "medium" }) {
  const v = (value ?? "UNKNOWN").toUpperCase();
  const color = COLOR_MAP[v] ?? "default";
  return (
    <Chip
      label={humanize(v)}
      color={color}
      size={size}
      variant={color === "default" ? "outlined" : "filled"}
      data-testid={testId}
      data-status={v}
      sx={{ height: 22, fontSize: 11.5, ...(v === "ACKNOWLEDGED" ? {} : {}) }}
    />
  );
}
