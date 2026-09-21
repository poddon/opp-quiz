import "server-only";

import { env } from "cloudflare:workers";
import { cookies } from "next/headers";
import type { NextResponse } from "next/server";

const COOKIE_NAME = "factory_quiz_admin";
const EMBEDDED_COOKIE_NAME = "factory_quiz_admin_embedded";
const encoder = new TextEncoder();

function bytesToBase64Url(bytes: Uint8Array) {
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

async function sign(value: string) {
  const secret = env.SESSION_SECRET;
  if (!secret) throw new Error("SESSION_SECRET is not configured");
  const key = await crypto.subtle.importKey(
    "raw",
    encoder.encode(secret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"],
  );
  const signature = await crypto.subtle.sign("HMAC", key, encoder.encode(value));
  return bytesToBase64Url(new Uint8Array(signature));
}

async function digest(value: string) {
  return new Uint8Array(await crypto.subtle.digest("SHA-256", encoder.encode(value)));
}

export async function passwordMatches(value: string) {
  const expected = env.ADMIN_PASSWORD;
  if (!expected) return false;
  const [left, right] = await Promise.all([digest(value), digest(expected)]);
  if (left.length !== right.length) return false;
  let difference = 0;
  for (let index = 0; index < left.length; index += 1) difference |= left[index] ^ right[index];
  return difference === 0;
}

export async function createAdminToken() {
  const expiresAt = Date.now() + 1000 * 60 * 60 * 12;
  const payload = `admin:${expiresAt}`;
  return `${payload}.${await sign(payload)}`;
}

export function setAdminSession(response: NextResponse, value: string) {
  const commonOptions = {
    httpOnly: true,
    path: "/",
    maxAge: 60 * 60 * 12,
  } as const;

  // The regular cookie is used when the Site is opened in its own tab.
  response.cookies.set(COOKIE_NAME, value, {
    ...commonOptions,
    sameSite: "lax",
    secure: process.env.NODE_ENV === "production",
  });

  // Sites can also be opened inside ChatGPT. A partitioned cookie keeps the
  // admin session available for API requests made from that embedded view.
  if (process.env.NODE_ENV === "production") {
    response.cookies.set(EMBEDDED_COOKIE_NAME, value, {
      ...commonOptions,
      sameSite: "none",
      secure: true,
      partitioned: true,
    });
  }
}

export function clearAdminSession(response: NextResponse) {
  response.cookies.set(COOKIE_NAME, "", { path: "/", maxAge: 0 });
  response.cookies.set(EMBEDDED_COOKIE_NAME, "", {
    path: "/",
    maxAge: 0,
    sameSite: "none",
    secure: true,
    partitioned: true,
  });
}

export async function isAdmin(request?: Request) {
  const authorization = request?.headers.get("authorization") ?? "";
  const bearerValue = authorization.toLowerCase().startsWith("bearer ")
    ? authorization.slice(7).trim()
    : "";
  const cookieStore = bearerValue ? null : await cookies();
  const value = bearerValue || cookieStore?.get(COOKIE_NAME)?.value || cookieStore?.get(EMBEDDED_COOKIE_NAME)?.value;
  if (!value) return false;
  const splitAt = value.lastIndexOf(".");
  if (splitAt < 0) return false;
  const payload = value.slice(0, splitAt);
  const signature = value.slice(splitAt + 1);
  const [role, expiryText] = payload.split(":");
  if (role !== "admin" || Number(expiryText) < Date.now()) return false;
  return signature === (await sign(payload));
}
