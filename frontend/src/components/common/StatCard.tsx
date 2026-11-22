import { ReactNode } from "react";
import { Box, Card, CardContent, Skeleton, Stack, Typography } from "@mui/material";

export default function StatCard({
  label,
  value,
  icon,
  accent = "#1f4f8b",
  hint,
  loading,
  testId,
  onClick,
}: {
  label: string;
  value: ReactNode;
  icon?: ReactNode;
  accent?: string;
  hint?: ReactNode;
  loading?: boolean;
  testId: string;
  onClick?: () => void;
}) {
  return (
    <Card
      data-testid={testId}
      onClick={onClick}
      sx={{ height: "100%", borderLeft: `4px solid ${accent}`, cursor: onClick ? "pointer" : "default", "&:hover": onClick ? { boxShadow: 2 } : {} }}
    >
      <CardContent sx={{ py: 1.75, "&:last-child": { pb: 1.75 } }}>
        <Stack direction="row" justifyContent="space-between" alignItems="flex-start">
          <Box>
            <Typography variant="caption" color="text.secondary" fontWeight={600} textTransform="uppercase" letterSpacing={0.4}>
              {label}
            </Typography>
            {loading ? (
              <Skeleton width={70} height={38} />
            ) : (
              <Typography variant="h4" sx={{ mt: 0.5, fontSize: 26 }} data-testid={`${testId}-value`}>
                {value}
              </Typography>
            )}
            {hint && (
              <Typography variant="caption" color="text.secondary">
                {hint}
              </Typography>
            )}
          </Box>
          {icon && <Box sx={{ color: accent, opacity: 0.85, mt: 0.5 }}>{icon}</Box>}
        </Stack>
      </CardContent>
    </Card>
  );
}
