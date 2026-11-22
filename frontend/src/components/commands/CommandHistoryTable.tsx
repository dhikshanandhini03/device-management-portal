import { Table, TableBody, TableCell, TableContainer, TableHead, TableRow, Typography } from "@mui/material";
import { Link as RouterLink } from "react-router-dom";
import { Link } from "@mui/material";
import type { Command } from "../../api/types";
import StatusChip from "../common/StatusChip";
import { EmptyState } from "../common/States";
import { fmtDateTime, humanize } from "../../utils/format";

export default function CommandHistoryTable({ rows, showDevice = true, onSelect }: { rows: Command[]; showDevice?: boolean; onSelect?: (c: Command) => void }) {
  if (!rows.length) return <EmptyState title="No commands found" />;
  return (
    <TableContainer>
      <Table size="small" data-testid="command-history-table">
        <TableHead>
          <TableRow>
            <TableCell>Command ID</TableCell>
            {showDevice && <TableCell>Device</TableCell>}
            <TableCell>Command</TableCell>
            <TableCell>Status</TableCell>
            <TableCell>Requested By</TableCell>
            <TableCell>Created</TableCell>
            <TableCell>Completed</TableCell>
            <TableCell>Result</TableCell>
          </TableRow>
        </TableHead>
        <TableBody>
          {rows.map((c) => (
            <TableRow key={c.id} hover data-testid="command-row" data-command-code={c.command_code} sx={{ cursor: onSelect ? "pointer" : "default" }} onClick={() => onSelect?.(c)}>
              <TableCell sx={{ fontFamily: "monospace", fontWeight: 600 }} data-testid="cell-command-code">{c.command_code}</TableCell>
              {showDevice && (
                <TableCell onClick={(e) => e.stopPropagation()}>
                  <Link component={RouterLink} to={`/devices/${c.device_id}`} underline="hover">
                    {c.device_id}
                  </Link>
                </TableCell>
              )}
              <TableCell data-testid="cell-command-type">{humanize(c.command_type)}</TableCell>
              <TableCell data-testid="cell-command-status">
                <StatusChip value={c.status} />
              </TableCell>
              <TableCell>{c.requested_by ?? "system"}</TableCell>
              <TableCell sx={{ whiteSpace: "nowrap" }}>{fmtDateTime(c.created_at)}</TableCell>
              <TableCell sx={{ whiteSpace: "nowrap" }}>{fmtDateTime(c.completed_at)}</TableCell>
              <TableCell sx={{ maxWidth: 320 }}>
                <Typography variant="caption">{c.result_message ?? "—"}</Typography>
              </TableCell>
            </TableRow>
          ))}
        </TableBody>
      </Table>
    </TableContainer>
  );
}
