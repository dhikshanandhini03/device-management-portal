import { useState } from "react";
import { useNavigate, useParams } from "react-router-dom";
import { keepPreviousData, useQuery } from "@tanstack/react-query";
import { Box, Card, CardContent, Chip, MenuItem, Stack, Table, TableBody, TableCell, TableHead, TableRow, TextField, Typography } from "@mui/material";
import Grid from "@mui/material/Grid2";
import { Bar, BarChart, CartesianGrid, Cell, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import { api, cleanParams } from "../api/client";
import type { ApplicationDetail, Page } from "../api/types";
import PageHeader from "../components/common/PageHeader";
import StatCard from "../components/common/StatCard";
import StatusChip from "../components/common/StatusChip";
import ChartCard from "../components/common/ChartCard";
import Pager from "../components/common/Pager";
import { EmptyState, ErrorState, LoadingState } from "../components/common/States";
import { fmtDate, fmtNumber, fmtRelative } from "../utils/format";

interface Installation {
  device_id: string;
  serial_number: string;
  model: string;
  region: string;
  version: string;
  status: string;
  installed_at: string;
  last_used_at: string | null;
}

export default function ApplicationDetailsPage() {
  const { appId = "" } = useParams();
  const navigate = useNavigate();
  const [version, setVersion] = useState("");
  const [page, setPage] = useState(1);
  const q = useQuery({ queryKey: ["application", appId], queryFn: async () => (await api.get<ApplicationDetail>(`/applications/${appId}`)).data });
  const installs = useQuery({
    queryKey: ["application-installs", appId, version, page],
    queryFn: async () => (await api.get<Page<Installation>>(`/applications/${appId}/installations`, { params: cleanParams({ version, page, page_size: 15 }) })).data,
    placeholderData: keepPreviousData,
  });
  if (q.isLoading) return <LoadingState />;
  if (q.isError || !q.data) return <ErrorState error={q.error} title="Application could not be loaded" />;
  const a = q.data;
  return (
    <Box data-testid="application-details-page">
      <PageHeader
        title={a.name}
        testId="application-title"
        crumbs={[{ label: "Application Management", to: "/applications" }, { label: a.name }]}
        subtitle={<span data-testid="application-package">{a.package_id}</span>}
        actions={<Chip label={`Latest ${a.latest_version}`} color="secondary" data-testid="application-latest" />}
      />
      <Grid container spacing={2} sx={{ mb: 2 }}>
        <Grid size={{ xs: 6, md: 3 }}><StatCard testId="app-installed" label="Installed devices" value={fmtNumber(a.device_count)} /></Grid>
        <Grid size={{ xs: 6, md: 3 }}><StatCard testId="app-latest-count" label="On latest version" value={fmtNumber(a.latest_count)} accent="#2e9d6a" /></Grid>
        <Grid size={{ xs: 6, md: 3 }}><StatCard testId="app-update-count" label="Update available" value={fmtNumber(a.update_available_count)} accent="#e1251b" /></Grid>
        <Grid size={{ xs: 6, md: 3 }}><StatCard testId="app-crashes" label="Crashes (7 days)" value={fmtNumber(a.crash_count_7d)} accent="#ed8a00" hint={`${(a.usage_minutes_7d / 60).toFixed(0)} viewing hours (7d)`} /></Grid>
      </Grid>
      <Grid container spacing={2} sx={{ mb: 2 }}>
        <Grid size={{ xs: 12, md: 7 }}>
          <ChartCard title="Version distribution" testId="chart-app-versions" height={260}>
            <ResponsiveContainer>
              <BarChart data={a.versions}>
                <CartesianGrid strokeDasharray="3 3" vertical={false} />
                <XAxis dataKey="version" fontSize={11} />
                <YAxis fontSize={11} allowDecimals={false} />
                <Tooltip />
                <Bar dataKey="device_count" name="Devices" radius={[3, 3, 0, 0]}>
                  {a.versions.map((v) => <Cell key={v.version} fill={v.is_latest ? "#2e9d6a" : "#1f5fa8"} />)}
                </Bar>
              </BarChart>
            </ResponsiveContainer>
          </ChartCard>
        </Grid>
        <Grid size={{ xs: 12, md: 5 }}>
          <Card sx={{ height: "100%" }}>
            <CardContent>
              <Typography variant="h6" sx={{ mb: 1 }}>Version comparison</Typography>
              <Table size="small" data-testid="app-version-table">
                <TableHead>
                  <TableRow>
                    <TableCell>Version</TableCell>
                    <TableCell align="right">Devices</TableCell>
                    <TableCell align="right">Share</TableCell>
                    <TableCell />
                  </TableRow>
                </TableHead>
                <TableBody>
                  {a.versions.map((v) => (
                    <TableRow key={v.version} data-testid="app-version-row" data-version={v.version}>
                      <TableCell sx={{ fontWeight: 600 }}>{v.version}</TableCell>
                      <TableCell align="right" data-testid="app-version-count">{v.device_count}</TableCell>
                      <TableCell align="right">{v.percentage}%</TableCell>
                      <TableCell>{v.is_latest ? <Chip size="small" color="success" label="Latest" /> : <Chip size="small" color="warning" label="Outdated" />}</TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
              <Stack direction="row" spacing={1} sx={{ mt: 2 }} flexWrap="wrap" useFlexGap>
                {a.statuses.map((s) => <Chip key={s.status} size="small" variant="outlined" label={`${s.status.replace(/_/g, " ")}: ${s.device_count}`} />)}
              </Stack>
            </CardContent>
          </Card>
        </Grid>
      </Grid>
      <Card>
        <CardContent>
          <Stack direction="row" justifyContent="space-between" sx={{ mb: 2 }}>
            <Typography variant="h6">Device installations</Typography>
            <TextField select label="Version" value={version} onChange={(e) => { setVersion(e.target.value); setPage(1); }} sx={{ minWidth: 160 }} SelectProps={{ inputProps: { "data-testid": "app-version-filter" } }}>
              <MenuItem value="">All versions</MenuItem>
              {a.versions.map((v) => <MenuItem key={v.version} value={v.version}>{v.version}</MenuItem>)}
            </TextField>
          </Stack>
          {!installs.data?.items.length ? (
            <EmptyState title="No installations" />
          ) : (
            <>
              <Table size="small" data-testid="app-installations-table">
                <TableHead>
                  <TableRow>
                    <TableCell>Device ID</TableCell>
                    <TableCell>Serial</TableCell>
                    <TableCell>Model</TableCell>
                    <TableCell>Region</TableCell>
                    <TableCell>Version</TableCell>
                    <TableCell>Status</TableCell>
                    <TableCell>Installed</TableCell>
                    <TableCell>Last used</TableCell>
                  </TableRow>
                </TableHead>
                <TableBody>
                  {installs.data.items.map((i) => (
                    <TableRow key={i.device_id} hover sx={{ cursor: "pointer" }} onClick={() => navigate(`/devices/${i.device_id}?tab=software`)} data-testid="app-installation-row" data-version={i.version}>
                      <TableCell sx={{ fontWeight: 600 }}>{i.device_id}</TableCell>
                      <TableCell>{i.serial_number}</TableCell>
                      <TableCell>{i.model}</TableCell>
                      <TableCell>{i.region}</TableCell>
                      <TableCell data-testid="cell-install-version">{i.version}</TableCell>
                      <TableCell><StatusChip value={i.status} /></TableCell>
                      <TableCell>{fmtDate(i.installed_at)}</TableCell>
                      <TableCell>{fmtRelative(i.last_used_at)}</TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
              <Pager total={installs.data.total} page={page} pageSize={15} onPage={setPage} testId="app-installations-pagination" />
            </>
          )}
        </CardContent>
      </Card>
    </Box>
  );
}
