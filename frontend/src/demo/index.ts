import { AxiosError, AxiosHeaders, type AxiosInstance, type AxiosResponse, type InternalAxiosRequestConfig } from "axios";
import { clearState, loadState, markDirty, saveNow, seedState, store } from "./data";
import { tick } from "./engine";
import { HttpError } from "./logic";
import { Reply, dispatch } from "./routes";

const delay = (ms: number) => new Promise((resolve) => window.setTimeout(resolve, ms));

async function demoAdapter(config: InternalAxiosRequestConfig): Promise<AxiosResponse> {
  const url = new URL(config.url ?? "", "http://demo.local");
  const path = url.pathname.replace(/^\/api(?=\/)/, "");
  const q: Record<string, string> = {};
  url.searchParams.forEach((v, k) => (q[k] = v));
  for (const [k, v] of Object.entries((config.params ?? {}) as Record<string, unknown>)) {
    if (v !== undefined && v !== null) q[k] = String(v);
  }
  let body: Record<string, unknown> = {};
  if (typeof config.data === "string" && config.data) {
    try {
      body = JSON.parse(config.data);
    } catch {
      body = {};
    }
  }
  const auth = AxiosHeaders.from(config.headers).get("Authorization");
  await delay(60 + Math.random() * 120);

  let reply: Reply;
  try {
    reply = await dispatch({ method: (config.method ?? "get").toUpperCase(), path, q, body: body ?? {}, params: {}, auth: auth ? String(auth) : null });
  } catch (err) {
    if (err instanceof HttpError) reply = new Reply(err.status, { detail: err.detail });
    else {
      console.error("[demo backend]", err);
      reply = new Reply(500, { detail: "Internal Server Error" });
    }
  }
  const data = config.responseType === "blob" && typeof reply.data === "string" ? new Blob([reply.data], { type: "text/csv" }) : reply.data;
  const response: AxiosResponse = {
    data, status: reply.status, statusText: String(reply.status), headers: AxiosHeaders.from(reply.headers), config, request: {},
  };
  if (reply.status >= 400) {
    throw new AxiosError(`Request failed with status code ${reply.status}`, reply.status >= 500 ? AxiosError.ERR_BAD_RESPONSE : AxiosError.ERR_BAD_REQUEST, config, {}, response);
  }
  return response;
}

/** Serve the portal API from an in-browser simulation (used for the static GitHub Pages build). */
export async function installDemo(api: AxiosInstance, sessionKeys: string[]): Promise<void> {
  const params = new URLSearchParams(window.location.search);
  if (params.has("reset-demo")) {
    clearState();
    sessionKeys.forEach((k) => localStorage.removeItem(k));
    params.delete("reset-demo");
    const qs = params.toString();
    window.history.replaceState(null, "", window.location.pathname + (qs ? `?${qs}` : ""));
  }
  const saved = loadState();
  if (saved) store.s = saved;
  else {
    await seedState();
    markDirty();
    saveNow();
  }
  window.setInterval(tick, 1000);
  window.addEventListener("pagehide", saveNow);
  document.addEventListener("visibilitychange", () => {
    if (document.visibilityState === "hidden") saveNow();
  });
  api.defaults.adapter = demoAdapter;
}
