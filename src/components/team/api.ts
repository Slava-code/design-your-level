// Tiny typed fetch helpers for the team client. Never throws: returns {ok, data} or {ok:false, error}.
import type { ApiError, ErrorCode } from "@/lib/types";

export type ApiResult<T> = { ok: true; data: T } | { ok: false; status: number; error: ApiError };

const NETWORK: ApiError = {
  error: "Can't reach the server. Check your Wi-Fi and try again.",
  code: "server",
};

export async function post<T>(url: string, body?: unknown, timeoutMs = 20000): Promise<ApiResult<T>> {
  const ctrl = new AbortController();
  const t = window.setTimeout(() => ctrl.abort(), timeoutMs);
  try {
    const res = await fetch(url, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: body === undefined ? "{}" : JSON.stringify(body),
      cache: "no-store",
      credentials: "same-origin",
      signal: ctrl.signal,
    });
    let json: unknown = null;
    try {
      json = await res.json();
    } catch {
      /* non-JSON */
    }
    if (res.ok) return { ok: true, data: json as T };
    const err = json && typeof json === "object" && "error" in json ? (json as ApiError) : null;
    return {
      ok: false,
      status: res.status,
      error: err ?? { error: `Something went wrong (${res.status}). Try again.`, code: codeFor(res.status) },
    };
  } catch {
    return { ok: false, status: 0, error: NETWORK };
  } finally {
    window.clearTimeout(t);
  }
}

function codeFor(status: number): ErrorCode {
  if (status === 401) return "unauthorized";
  if (status === 404) return "not_found";
  if (status === 409) return "conflict";
  if (status === 429) return "rate_limited";
  return "server";
}

export const usd = (n: number) => `$${(Math.round(n * 100) / 100).toFixed(2)}`;
