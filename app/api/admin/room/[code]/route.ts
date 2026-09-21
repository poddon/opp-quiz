import { NextResponse } from "next/server";
import { getD1 } from "@/db";
import { isAdmin } from "@/lib/admin-auth";
import { apiError, normalizeRoomCode } from "@/lib/api";
import { QUESTION_COUNT, QUESTIONS, publicQuestion } from "@/lib/questions";

export async function GET(_request: Request, context: { params: Promise<{ code: string }> }) {
  if (!(await isAdmin())) return apiError("Требуется вход администратора", 401);
  const code = normalizeRoomCode((await context.params).code);
  const db = getD1();
  const room = await db.prepare(`
    SELECT id, code, title, status, current_question AS currentQuestion, created_at AS createdAt
    FROM rooms WHERE code = ?
  `).bind(code).first<Record<string, unknown>>();
  if (!room) return apiError("Комната не найдена", 404);
  const players = await db.prepare(`
    SELECT id, name, score, joined_at AS joinedAt,
      (SELECT reason FROM score_events e WHERE e.player_id = players.id ORDER BY created_at DESC LIMIT 1) AS lastReason,
      (SELECT delta FROM score_events e WHERE e.player_id = players.id ORDER BY created_at DESC LIMIT 1) AS lastDelta
    FROM players
    WHERE room_id = ?
    ORDER BY score DESC, joined_at ASC
  `).bind(room.id).all();
  const questionIndex = Number(room.currentQuestion);
  const question = publicQuestion(questionIndex);
  return NextResponse.json({
    room: { ...room, questionCount: QUESTION_COUNT },
    question: question ? { ...question, correctIndex: QUESTIONS[questionIndex].correctIndex, explanation: QUESTIONS[questionIndex].explanation } : null,
    players: players.results,
  });
}
