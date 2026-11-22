import { ReactNode } from "react";
import { Box, Card, CardContent, Stack, Typography } from "@mui/material";
import { EmptyState, ErrorState, LoadingState } from "./States";

export default function ChartCard({
  title,
  subtitle,
  action,
  loading,
  error,
  empty,
  height = 260,
  children,
  testId,
  onRetry,
}: {
  title: string;
  subtitle?: string;
  action?: ReactNode;
  loading?: boolean;
  error?: unknown;
  empty?: boolean;
  height?: number;
  children: ReactNode;
  testId: string;
  onRetry?: () => void;
}) {
  return (
    <Card data-testid={testId} sx={{ height: "100%" }}>
      <CardContent>
        <Stack direction="row" justifyContent="space-between" alignItems="center" sx={{ mb: 1.5 }}>
          <Box>
            <Typography variant="h6">{title}</Typography>
            {subtitle && (
              <Typography variant="caption" color="text.secondary">
                {subtitle}
              </Typography>
            )}
          </Box>
          {action}
        </Stack>
        <Box sx={{ height }} data-testid={`${testId}-body`}>
          {loading ? (
            <LoadingState minHeight={height} />
          ) : error ? (
            <ErrorState error={error} onRetry={onRetry} />
          ) : empty ? (
            <EmptyState title="No data for this period" />
          ) : (
            children
          )}
        </Box>
      </CardContent>
    </Card>
  );
}
