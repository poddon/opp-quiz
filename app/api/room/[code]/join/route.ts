import { getD1 } from "@/db";
import { apiError, apiJson, corsOptions, normalizeName, normalizeRoomCode } from "@/lib/api";

export const OPTIONS = corsOptions;

export async function POST(request: Request, context: { params: Promise<{ code: string }> }) {
  const code = normalizeRoomCode((await context.params).code);
  const body = await request.json().catch(() => ({}));
  const name = normalizeName(body.name);
  if (name.length < 5 || !name.includes(" ")) return apiError("Введите фамилию и имя");
  const db = getD1();
  const room = await db.prepare("SELECT id, status FROM rooms WHERE code = ?").bind(code).first<{ id: string; status: string }>();
  if (!room) return apiError("Комната с таким кодом не найдена", 404);
  if (room.status === "finished") return apiError("Эта викторина уже завершена", 409);
  const id = crypto.randomUUID();
  const now = Date.now();
  await db.prepare(`
    INSERT INTO players (id, room_id, name, score, joined_at, last_seen_at)
    VALUES (?, ?, ?, 0, ?, ?)
  `).bind(id, room.id, name, now, now).run();
  return apiJson({ playerId: id, roomCode: code, name });
}
