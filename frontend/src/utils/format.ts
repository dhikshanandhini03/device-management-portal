import dayjs from "dayjs";
import relativeTime from "dayjs/plugin/relativeTime";
import utc from "dayjs/plugin/utc";

dayjs.extend(relativeTime);
dayjs.extend(utc);

export function fmtDateTime(value?: string | null): string {
  return value ? dayjs(value).format("YYYY-MM-DD HH:mm:ss") : "—";
}

export function fmtDate(value?: string | null): string {
  return value ? dayjs(value).format("YYYY-MM-DD") : "—";
}

export function fmtShort(value?: string | null): string {
  return value ? dayjs(value).format("MMM D, HH:mm") : "—";
}

export function fmtRelative(value?: string | null): string {
  return value ? dayjs(value).fromNow() : "Never";
}

export function fmtUptime(seconds?: number | null): string {
  if (seconds === null || seconds === undefined) return "—";
  const d = Math.floor(seconds / 86400);
  const h = Math.floor((seconds % 86400) / 3600);
  const m = Math.floor((seconds % 3600) / 60);
  if (d > 0) return `${d}d ${h}h ${m}m`;
  if (h > 0) return `${h}h ${m}m`;
  return `${m}m`;
}

export function fmtNumber(n?: number | null): string {
  return n === null || n === undefined ? "—" : n.toLocaleString("en-CA");
}

export function fmtPct(n?: number | null, digits = 1): string {
  return n === null || n === undefined ? "—" : `${n.toFixed(digits)}%`;
}

export function humanize(value?: string | null): string {
  if (!value) return "—";
  return value
    .toLowerCase()
    .split("_")
    .map((w) => w.charAt(0).toUpperCase() + w.slice(1))
    .join(" ");
}

export function toIsoStart(date: string): string | undefined {
  return date ? dayjs(date).startOf("day").toISOString() : undefined;
}

export function toIsoEnd(date: string): string | undefined {
  return date ? dayjs(date).endOf("day").toISOString() : undefined;
}

export { dayjs };
