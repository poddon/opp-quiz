import { getD1 } from "@/db";
import { apiError, apiJson, corsOptions, normalizeRoomCode } from "@/lib/api";
import { QUESTION_COUNT, QUESTIONS, publicQuestion } from "@/lib/questions";

export const OPTIONS = corsOptions;

export async function GET(request: Request, context: { params: Promise<{ code: string }> }) {
  const code = normalizeRoomCode((await context.params).code);
  const playerId = new URL(request.url).searchParams.get("playerId") ?? "";
  const db = getD1();
  const room = await db.prepare(`
    SELECT id, code, title, status, current_question AS currentQuestion
    FROM rooms WHERE code = ?
  `).bind(code).first<Record<string, unknown>>();
  if (!room) return apiError("Комната не найдена", 404);

  const players = await db.prepare(`
    SELECT id, name, score FROM players WHERE room_id = ? ORDER BY score DESC, joined_at ASC
  `).bind(room.id).all();
  const questionIndex = Number(room.currentQuestion);
  const question = room.status === "live" ? publicQuestion(questionIndex) : null;
  let player: Record<string, unknown> | null = null;
  let answer: Record<string, unknown> | null = null;
  if (playerId) {
    player = await db.prepare("SELECT id, name, score FROM players WHERE id = ? AND room_id = ?").bind(playerId, room.id).first<Record<string, unknown>>();
    if (player) {
      answer = await db.prepare(`
        SELECT option_index AS optionIndex, is_correct AS isCorrect, points
        FROM answers WHERE player_id = ? AND question_index = ?
      `).bind(playerId, questionIndex).first<Record<string, unknown>>();
      await db.prepare("UPDATE players SET last_seen_at = ? WHERE id = ?").bind(Date.now(), playerId).run();
    }
  }

  const answeredQuestion = answer && QUESTIONS[questionIndex]
    ? { ...answer, correctIndex: QUESTIONS[questionIndex].correctIndex, explanation: QUESTIONS[questionIndex].explanation }
    : null;
  return apiJson({
    room: { ...room, questionCount: QUESTION_COUNT },
    question,
    player,
    answer: answeredQuestion,
    players: players.results,
  });
}
