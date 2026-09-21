import { NextResponse } from "next/server";
import { createAdminSession, passwordMatches } from "@/lib/admin-auth";
import { apiError } from "@/lib/api";

export async function POST(request: Request) {
  const body = await request.json().catch(() => ({}));
  const username = String(body.username ?? "").trim().toLowerCase();
  const password = String(body.password ?? "");
  if (username !== "admin" || !(await passwordMatches(password))) {
    return apiError("Неверная должность или пароль", 401);
  }
  const response = NextResponse.json({ ok: true });
  await createAdminSession(response);
  return response;
}
