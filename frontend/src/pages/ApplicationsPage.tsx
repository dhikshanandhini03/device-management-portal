import { useState } from "react";
import { useNavigate } from "react-router-dom";
import { keepPreviousData, useQuery } from "@tanstack/react-query";
import {
  Box,
  Card,
  CardContent,
  InputAdornment,
  LinearProgress,
  MenuItem,
  Stack,
  Table,
  TableBody,
  TableCell,
  TableContainer,
  TableHead,
  TableRow,
  TextField,
  Typography,
} from "@mui/material";
import SearchIcon from "@mui/icons-material/Search";
import { api, cleanParams } from "../api/client";
import type { Application } from "../api/types";
import PageHeader from "../components/common/PageHeader";
import { EmptyState, ErrorState, LoadingState } from "../components/common/States";
import { fmtNumber } from "../utils/format";

const CATEGORIES = ["Live TV", "System", "Streaming", "Sports", "Entertainment", "Music"];

export default function ApplicationsPage() {
  const navigate = useNavigate();
  const [search, setSearch] = useState("");
  const [category, setCategory] = useState("");
  const [update, setUpdate] = useState("");
  const q = useQuery({
    queryKey: ["applications", search, category, update],
    queryFn: async () => (await api.get<Application[]>("/applications", { params: cleanParams({ search, category, update_available: update }) })).data,
    placeholderData: keepPreviousData,
  });
  return (
    <Box data-testid="applications-page">
      <PageHeader title="Application Management" subtitle="Installed application inventory, version spread and update availability across the fleet." />
      <Card>
        <CardContent>
          <Stack direction="row" spacing={1.5} sx={{ mb: 2 }} flexWrap="wrap" useFlexGap>
            <TextField
              placeholder="Search application name or package"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              sx={{ minWidth: 300 }}
              inputProps={{ "data-testid": "app-search" }}
              InputProps={{ startAdornment: <InputAdornment position="start"><SearchIcon fontSize="small" /></InputAdornment> }}
            />
            <TextField select label="Category" value={category} onChange={(e) => setCategory(e.target.value)} sx={{ minWidth: 160 }} SelectProps={{ inputProps: { "data-testid": "app-category-filter" } }}>
              <MenuItem value="">All</MenuItem>
              {CATEGORIES.map((c) => <MenuItem key={c} value={c}>{c}</MenuItem>)}
            </TextField>
            <TextField select label="Update availability" value={update} onChange={(e) => setUpdate(e.target.value)} sx={{ minWidth: 190 }} SelectProps={{ inputProps: { "data-testid": "app-update-filter" } }}>
              <MenuItem value="">All</MenuItem>
              <MenuItem value="true">Updates available</MenuItem>
              <MenuItem value="false">All devices current</MenuItem>
            </TextField>
          </Stack>
          {q.isLoading ? (
            <LoadingState />
          ) : q.isError ? (
            <ErrorState error={q.error} onRetry={() => q.refetch()} />
          ) : !q.data?.length ? (
            <EmptyState title="No applications found" />
          ) : (
            <TableContainer>
              <Table size="small" data-testid="applications-table">
                <TableHead>
                  <TableRow>
                    <TableCell>Application</TableCell>
                    <TableCell>Package identifier</TableCell>
                    <TableCell>Category</TableCell>
                    <TableCell>Latest version</TableCell>
                    <TableCell align="right">Installed on</TableCell>
                    <TableCell align="right">Versions</TableCell>
                    <TableCell sx={{ minWidth: 180 }}>On latest version</TableCell>
                    <TableCell align="right">Update available</TableCell>
                    <TableCell align="right">Install failures</TableCell>
                  </TableRow>
                </TableHead>
                <TableBody>
                  {q.data.map((a) => {
                    const pct = a.device_count ? (100 * a.latest_count) / a.device_count : 0;
                    return (
                      <TableRow key={a.id} hover sx={{ cursor: "pointer" }} onClick={() => navigate(`/applications/${a.id}`)} data-testid="application-row" data-package={a.package_id}>
                        <TableCell>
                          <Typography variant="body2" fontWeight={600} data-testid="cell-app-name">{a.name}</Typography>
                          <Typography variant="caption" color="text.secondary">{a.publisher}</Typography>
                        </TableCell>
                        <TableCell sx={{ fontFamily: "monospace", fontSize: 12 }} data-testid="cell-app-package">{a.package_id}</TableCell>
                        <TableCell>{a.category}</TableCell>
                        <TableCell data-testid="cell-app-latest">{a.latest_version}</TableCell>
                        <TableCell align="right" data-testid="cell-app-devices">{fmtNumber(a.device_count)}</TableCell>
                        <TableCell align="right">{a.version_count}</TableCell>
                        <TableCell>
                          <LinearProgress variant="determinate" value={pct} sx={{ height: 6, borderRadius: 3 }} color={pct > 80 ? "success" : "warning"} />
                          <Typography variant="caption">{pct.toFixed(0)}% ({a.latest_count})</Typography>
                        </TableCell>
                        <TableCell align="right" data-testid="cell-app-updates">{a.update_available_count}</TableCell>
                        <TableCell align="right">{a.failed_count}</TableCell>
                      </TableRow>
                    );
                  })}
                </TableBody>
              </Table>
            </TableContainer>
          )}
        </CardContent>
      </Card>
    </Box>
  );
}
