import { getD1 } from "@/db";
import { isAdmin } from "@/lib/admin-auth";
import { apiError, apiJson, corsOptions, normalizeRoomCode } from "@/lib/api";
import { QUESTION_COUNT } from "@/lib/questions";

export const OPTIONS = corsOptions;

export async function POST(request: Request, context: { params: Promise<{ code: string }> }) {
  if (!(await isAdmin(request))) return apiError("Требуется вход администратора", 401);
  const code = normalizeRoomCode((await context.params).code);
  const body = await request.json().catch(() => ({}));
  const action = String(body.action ?? "");
  const db = getD1();
  const room = await db.prepare("SELECT id, status, current_question AS currentQuestion FROM rooms WHERE code = ?").bind(code).first<{ id: string; status: string; currentQuestion: number }>();
  if (!room) return apiError("Комната не найдена", 404);

  let status = room.status;
  let currentQuestion = Number(room.currentQuestion);
  if (action === "start") {
    status = "live";
    currentQuestion = 0;
  } else if (action === "next") {
    status = "live";
    currentQuestion = Math.min(QUESTION_COUNT - 1, currentQuestion + 1);
  } else if (action === "previous") {
    status = "live";
    currentQuestion = Math.max(0, currentQuestion - 1);
  } else if (action === "finish") {
    status = "finished";
  } else if (action === "lobby") {
    status = "lobby";
  } else {
    return apiError("Неизвестная команда");
  }

  await db.prepare("UPDATE rooms SET status = ?, current_question = ?, updated_at = ? WHERE id = ?")
    .bind(status, currentQuestion, Date.now(), room.id).run();
  return apiJson({ ok: true, status, currentQuestion });
}
