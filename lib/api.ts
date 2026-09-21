import { NextResponse } from "next/server";

export function apiError(message: string, status = 400) {
  return NextResponse.json({ error: message }, { status });
}

export function normalizeRoomCode(value: unknown) {
  return String(value ?? "").trim().toUpperCase().replace(/[^A-Z0-9]/g, "").slice(0, 6);
}

export function normalizeName(value: unknown) {
  return String(value ?? "").trim().replace(/\s+/g, " ").slice(0, 80);
}
