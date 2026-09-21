import { getD1 } from "@/db";
import { isAdmin } from "@/lib/admin-auth";
import { apiError, apiJson, corsOptions, normalizeRoomCode } from "@/lib/api";

export const OPTIONS = corsOptions;

export async function POST(request: Request, context: { params: Promise<{ code: string }> }) {
  if (!(await isAdmin(request))) return apiError("Требуется вход администратора", 401);
  const code = normalizeRoomCode((await context.params).code);
  const body = await request.json().catch(() => ({}));
  const playerId = String(body.playerId ?? "");
  const delta = Number(body.delta);
  const reason = String(body.reason ?? "Корректировка").trim().slice(0, 100);
  if (!playerId || !Number.isInteger(delta) || delta === 0 || Math.abs(delta) > 1000) {
    return apiError("Некорректное изменение баллов");
  }
  const db = getD1();
  const room = await db.prepare("SELECT id FROM rooms WHERE code = ?").bind(code).first<{ id: string }>();
  if (!room) return apiError("Комната не найдена", 404);
  const player = await db.prepare("SELECT id FROM players WHERE id = ? AND room_id = ?").bind(playerId, room.id).first();
  if (!player) return apiError("Участник не найден", 404);
  const eventId = crypto.randomUUID();
  await db.batch([
    db.prepare("UPDATE players SET score = score + ? WHERE id = ? AND room_id = ?").bind(delta, playerId, room.id),
    db.prepare(`INSERT INTO score_events (id, room_id, player_id, delta, reason, kind, created_at) VALUES (?, ?, ?, ?, ?, 'manual', ?)`)
      .bind(eventId, room.id, playerId, delta, reason, Date.now()),
  ]);
  return apiJson({ ok: true });
}
