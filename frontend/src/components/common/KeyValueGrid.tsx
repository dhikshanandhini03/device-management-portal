import { ReactNode } from "react";
import { Box, Typography } from "@mui/material";
import Grid from "@mui/material/Grid2";

export interface KV {
  label: string;
  value: ReactNode;
  testId?: string;
}

export default function KeyValueGrid({ items, columns = 3 }: { items: KV[]; columns?: 2 | 3 | 4 }) {
  const size = 12 / columns;
  return (
    <Grid container spacing={2}>
      {items.map((it) => (
        <Grid key={it.label} size={{ xs: 12, sm: 6, md: size }}>
          <Box>
            <Typography variant="caption" color="text.secondary" fontWeight={600} textTransform="uppercase" letterSpacing={0.3}>
              {it.label}
            </Typography>
            <Typography variant="body2" component="div" sx={{ mt: 0.25, wordBreak: "break-word" }} data-testid={it.testId}>
              {it.value ?? "—"}
            </Typography>
          </Box>
        </Grid>
      ))}
    </Grid>
  );
}
