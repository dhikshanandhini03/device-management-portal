import axios, { AxiosError } from "axios";

export const TOKEN_KEY = "bellstb.token";
export const USER_KEY = "bellstb.user";

export const api = axios.create({ baseURL: "/api", timeout: 30000 });

type UnauthorizedHandler = (reason: "expired" | "invalid") => void;
let onUnauthorized: UnauthorizedHandler | null = null;

export function setUnauthorizedHandler(fn: UnauthorizedHandler | null) {
  onUnauthorized = fn;
}

api.interceptors.request.use((config) => {
  const token = localStorage.getItem(TOKEN_KEY);
  if (token) config.headers.Authorization = `Bearer ${token}`;
  return config;
});

api.interceptors.response.use(
  (r) => r,
  (error: AxiosError<{ detail?: unknown }>) => {
    const url = error.config?.url ?? "";
    if (error.response?.status === 401 && !url.includes("/auth/login")) {
      const detail = String(error.response.data?.detail ?? "");
      onUnauthorized?.(detail.toLowerCase().includes("expired") ? "expired" : "invalid");
    }
    return Promise.reject(error);
  },
);

export function errorMessage(err: unknown, fallback = "Something went wrong"): string {
  if (axios.isAxiosError(err)) {
    const detail = (err.response?.data as { detail?: unknown } | undefined)?.detail;
    if (typeof detail === "string") return detail;
    if (Array.isArray(detail) && detail.length) {
      return detail
        .map((d: { msg?: string; loc?: unknown[] }) => {
          const field = Array.isArray(d.loc) ? d.loc[d.loc.length - 1] : "";
          return `${field ? `${field}: ` : ""}${(d.msg ?? "").replace(/^Value error, /, "")}`;
        })
        .join("; ");
    }
    if (err.code === "ECONNABORTED") return "The request timed out";
    if (!err.response) return "Unable to reach the server";
    return `${fallback} (HTTP ${err.response.status})`;
  }
  return fallback;
}

export async function downloadFile(url: string, params: Record<string, unknown>, fallbackName: string) {
  const res = await api.get(url, { params, responseType: "blob" });
  const disposition = String(res.headers["content-disposition"] ?? "");
  const match = /filename="?([^"]+)"?/.exec(disposition);
  const name = match?.[1] ?? fallbackName;
  const href = URL.createObjectURL(res.data as Blob);
  const a = document.createElement("a");
  a.href = href;
  a.download = name;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(href), 1000);
}

export function cleanParams<T extends Record<string, unknown>>(params: T): Partial<T> {
  const out: Partial<T> = {};
  for (const [k, v] of Object.entries(params)) {
    if (v !== "" && v !== undefined && v !== null) (out as Record<string, unknown>)[k] = v;
  }
  return out;
}
