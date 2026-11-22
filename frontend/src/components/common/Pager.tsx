import { TablePagination } from "@mui/material";

export default function Pager({
  total,
  page,
  pageSize,
  onPage,
  onPageSize,
  options = [10, 25, 50, 100],
  testId = "pagination",
}: {
  total: number;
  page: number;
  pageSize: number;
  onPage: (page: number) => void;
  onPageSize?: (size: number) => void;
  options?: number[];
  testId?: string;
}) {
  return (
    <TablePagination
      component="div"
      data-testid={testId}
      count={total}
      page={Math.max(0, page - 1)}
      rowsPerPage={pageSize}
      rowsPerPageOptions={onPageSize ? options : [pageSize]}
      onPageChange={(_, p) => onPage(p + 1)}
      onRowsPerPageChange={(e) => onPageSize?.(parseInt(e.target.value, 10))}
      SelectProps={{ inputProps: { "data-testid": `${testId}-size` } }}
      backIconButtonProps={{ "aria-label": "Previous page" }}
      nextIconButtonProps={{ "aria-label": "Next page" }}
    />
  );
}
