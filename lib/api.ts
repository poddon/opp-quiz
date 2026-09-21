import { NextResponse } from "next/server";

const GITHUB_PAGES_ORIGIN = "https://poddon.github.io";

export const corsHeaders = {
  "Access-Control-Allow-Origin": GITHUB_PAGES_ORIGIN,
  "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type, Authorization",
  "Access-Control-Max-Age": "86400",
  Vary: "Origin",
};

export function apiJson(data: unknown, init: ResponseInit = {}) {
  const headers = new Headers(init.headers);
  for (const [key, value] of Object.entries(corsHeaders)) headers.set(key, value);
  return NextResponse.json(data, { ...init, headers });
}

export function apiError(message: string, status = 400) {
  return apiJson({ error: message }, { status });
}

export function corsOptions() {
  return new Response(null, { status: 204, headers: corsHeaders });
}

export function normalizeRoomCode(value: unknown) {
  return String(value ?? "").trim().toUpperCase().replace(/[^A-Z0-9]/g, "").slice(0, 6);
}

export function normalizeName(value: unknown) {
  return String(value ?? "").trim().replace(/\s+/g, " ").slice(0, 80);
}
