import { NextResponse } from "next/server";
import { isAdmin } from "@/lib/admin-auth";

export async function GET() {
  const authenticated = await isAdmin();
  return NextResponse.json({ authenticated }, { status: authenticated ? 200 : 401 });
}
