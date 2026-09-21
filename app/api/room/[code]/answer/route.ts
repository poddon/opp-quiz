import { getD1 } from "@/db";
import { apiError, apiJson, corsOptions, normalizeRoomCode } from "@/lib/api";
import { QUESTIONS } from "@/lib/questions";

export const OPTIONS = corsOptions;

export async function POST(request: Request, context: { params: Promise<{ code: string }> }) {
  const code = normalizeRoomCode((await context.params).code);
  const body = await request.json().catch(() => ({}));
  const playerId = String(body.playerId ?? "");
  const questionIndex = Number(body.questionIndex);
  const optionIndex = Number(body.optionIndex);
  if (!playerId || !Number.isInteger(questionIndex) || !Number.isInteger(optionIndex)) return apiError("Некорректный ответ");
  const question = QUESTIONS[questionIndex];
  if (!question || optionIndex < 0 || optionIndex >= question.options.length) return apiError("Некорректный вариант ответа");

  const db = getD1();
  const room = await db.prepare("SELECT id, status, current_question AS currentQuestion, updated_at AS updatedAt FROM rooms WHERE code = ?")
    .bind(code).first<{ id: string; status: string; currentQuestion: number; updatedAt: number }>();
  if (!room) return apiError("Комната не найдена", 404);
  if (room.status !== "live" || Number(room.currentQuestion) !== questionIndex) return apiError("Этот вопрос уже закрыт", 409);
  const player = await db.prepare("SELECT id FROM players WHERE id = ? AND room_id = ?").bind(playerId, room.id).first();
  if (!player) return apiError("Участник не найден", 404);

  const id = `${playerId}:${questionIndex}`;
  const isCorrect = optionIndex === question.correctIndex;
  let streak = 0;
  if (isCorrect) {
    streak = 1;
    const previousAnswers = await db.prepare(`
      SELECT question_index AS questionIndex, is_correct AS isCorrect
      FROM answers
      WHERE player_id = ? AND question_index < ?
      ORDER BY question_index DESC
      LIMIT 4
    `).bind(playerId, questionIndex).all<{ questionIndex: number; isCorrect: number }>();
    let expectedQuestion = questionIndex - 1;
    for (const previous of previousAnswers.results) {
      if (Number(previous.questionIndex) !== expectedQuestion || !Number(previous.isCorrect)) break;
      streak += 1;
      expectedQuestion -= 1;
    }
  }
  const elapsedSeconds = Math.max(0, Math.floor((Date.now() - Number(room.updatedAt)) / 1000));
  const speedBonus = isCorrect ? Math.max(0, 50 - Math.floor(elapsedSeconds / 2) * 5) : 0;
  const streakBonus = isCorrect ? Math.min(100, Math.max(0, streak - 1) * 25) : 0;
  const points = isCorrect ? 100 + speedBonus + streakBonus : 0;
  const results = await db.batch([
    db.prepare(`
      INSERT OR IGNORE INTO answers
      (id, room_id, player_id, question_index, option_index, is_correct, points, score_applied, created_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, 0, ?)
    `).bind(id, room.id, playerId, questionIndex, optionIndex, isCorrect ? 1 : 0, points, Date.now()),
    db.prepare(`
      UPDATE players SET score = score + ?
      WHERE id = ? AND EXISTS (SELECT 1 FROM answers WHERE id = ? AND score_applied = 0)
    `).bind(points, playerId, id),
    db.prepare("UPDATE answers SET score_applied = 1 WHERE id = ? AND score_applied = 0").bind(id),
  ]);
  const inserted = Number(results[0].meta?.changes ?? 0) > 0;
  const saved = await db.prepare(`
    SELECT option_index AS optionIndex, is_correct AS isCorrect, points
    FROM answers WHERE id = ?
  `).bind(id).first<{ optionIndex: number; isCorrect: number; points: number }>();
  return apiJson({
    correct: Boolean(saved?.isCorrect),
    points: Number(saved?.points ?? 0),
    optionIndex: Number(saved?.optionIndex ?? optionIndex),
    correctIndex: question.correctIndex,
    explanation: question.explanation,
    speedBonus: inserted ? speedBonus : 0,
    streakBonus: inserted ? streakBonus : 0,
    streak,
    duplicate: !inserted,
  });
}
