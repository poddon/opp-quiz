import { NextResponse } from "next/server";
import { getD1 } from "@/db";
import { isAdmin } from "@/lib/admin-auth";
import { apiError } from "@/lib/api";

const CODE_ALPHABET = "ABCDEFGHJKMNPQRSTUVWXYZ23456789";

function makeCode() {
  const bytes = crypto.getRandomValues(new Uint8Array(5));
  return Array.from(bytes, (byte) => CODE_ALPHABET[byte % CODE_ALPHABET.length]).join("");
}

export async function GET() {
  if (!(await isAdmin())) return apiError("Требуется вход администратора", 401);
  const result = await getD1().prepare(`
    SELECT r.id, r.code, r.title, r.status, r.current_question AS currentQuestion,
           r.created_at AS createdAt, COUNT(p.id) AS playerCount
    FROM rooms r
    LEFT JOIN players p ON p.room_id = r.id
    GROUP BY r.id
    ORDER BY r.created_at DESC
  `).all();
  return NextResponse.json({ rooms: result.results });
}

export async function POST(request: Request) {
  if (!(await isAdmin())) return apiError("Требуется вход администратора", 401);
  const body = await request.json().catch(() => ({}));
  const title = String(body.title ?? "Коммерческая деятельность производства").trim().slice(0, 80) || "Коммерческая деятельность производства";
  const db = getD1();
  let code = makeCode();
  for (let attempt = 0; attempt < 5; attempt += 1) {
    const exists = await db.prepare("SELECT 1 FROM rooms WHERE code = ?").bind(code).first();
    if (!exists) break;
    code = makeCode();
  }
  const id = crypto.randomUUID();
  const now = Date.now();
  await db.prepare(`
    INSERT INTO rooms (id, code, title, status, current_question, created_at, updated_at)
    VALUES (?, ?, ?, 'lobby', 0, ?, ?)
  `).bind(id, code, title, now, now).run();
  return NextResponse.json({ room: { id, code, title, status: "lobby", currentQuestion: 0, playerCount: 0 } });
}
