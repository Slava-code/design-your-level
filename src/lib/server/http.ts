// JSON response helpers and a route wrapper that turns thrown ApiErr into the standard error shape.
import "server-only";
import type { ApiError, ErrorCode } from "@/lib/types";

const STATUS: Record<ErrorCode, number> = {
  bad_request: 400,
  unauthorized: 401,
  invalid_code: 401,
  rate_limited: 429,
  not_found: 404,
  phase: 409,
  busy: 409,
  budget: 402,
  flagged: 422,
  conflict: 409,
  server: 500,
};

export class ApiErr extends Error {
  constructor(
    public code: ErrorCode,
    message: string,
    public retryAfterSec?: number,
  ) {
    super(message);
  }
}

const NO_STORE = { "Cache-Control": "no-store, max-age=0" };

export function json<T>(data: T, init?: { status?: number; headers?: Record<string, string> }): Response {
  return Response.json(data, { status: init?.status ?? 200, headers: { ...NO_STORE, ...(init?.headers ?? {}) } });
}

export function errorResponse(e: ApiErr): Response {
  const body: ApiError = { error: e.message, code: e.code };
  const headers: Record<string, string> = {};
  if (e.retryAfterSec) {
    body.retryAfterSec = e.retryAfterSec;
    headers["Retry-After"] = String(e.retryAfterSec);
  }
  return json(body, { status: STATUS[e.code], headers });
}

/** Wraps a route handler: ApiErr -> its status; anything else -> 500 with a generic message (logged server-side). */
export function route<A extends unknown[]>(fn: (...args: A) => Promise<Response>) {
  return async (...args: A): Promise<Response> => {
    try {
      return await fn(...args);
    } catch (e) {
      if (e instanceof ApiErr) return errorResponse(e);
      console.error("[api] unexpected error:", e instanceof Error ? e.stack || e.message : e);
      return errorResponse(new ApiErr("server", "Something went wrong on the server. Try again."));
    }
  };
}

export async function readJson<T = Record<string, unknown>>(req: Request): Promise<T> {
  try {
    const body = await req.json();
    if (body === null || typeof body !== "object" || Array.isArray(body)) throw new Error();
    return body as T;
  } catch {
    throw new ApiErr("bad_request", "Request body must be a JSON object.");
  }
}

/** Client IP: first hop of x-forwarded-for, else x-real-ip, else "unknown". */
export function clientIp(req: Request): string {
  const xff = req.headers.get("x-forwarded-for");
  if (xff) {
    const first = xff.split(",")[0]?.trim();
    if (first) return first.slice(0, 64);
  }
  return (req.headers.get("x-real-ip") || "unknown").trim().slice(0, 64);
}
