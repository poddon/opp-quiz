"use client";

import { FormEvent, useCallback, useEffect, useMemo, useState, type CSSProperties } from "react";
import { ArrowRight, CheckCircle2, Crown, Factory, Flame, LoaderCircle, LockKeyhole, Rocket, Sparkles, Trophy, XCircle, Zap } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Progress } from "@/components/ui/progress";

type Player = { id: string; name: string; score: number };
type PublicQuestion = { index: number; topic: string; question: string; options: string[]; total: number };
type AnswerResult = { optionIndex: number; isCorrect: number; points: number; correctIndex: number; explanation: string };
type AnswerFeedback = { correct: boolean; points: number; speedBonus: number; streakBonus: number; streak: number };
type RoomState = {
  room: { code: string; title: string; status: "lobby" | "live" | "finished"; currentQuestion: number; questionCount: number };
  question: PublicQuestion | null;
  player: Player | null;
  answer: AnswerResult | null;
  players: Player[];
};

const answerStyles = [
  "bg-[#EAF6FF] hover:bg-[#D6ECFF]",
  "bg-[#CDEFFF] hover:bg-[#B9E5FF]",
  "bg-[#7CC6FF] hover:bg-[#63B8F7]",
  "bg-[#4DA9F6] hover:bg-[#268FE3]",
];
const answerLetters = ["А", "Б", "В", "Г"];
const confettiColors = ["#00B8F0", "#0086D9", "#4DA9F6", "#FFFFFF", "#CDEFFF"];

function Celebration({ feedback }: { feedback: AnswerFeedback }) {
  if (!feedback.correct) return null;
  return (
    <div className="celebration-layer" aria-hidden="true">
      {Array.from({ length: 30 }, (_, index) => (
        <span
          key={index}
          className="confetti-piece"
          style={{
            "--confetti-x": `${(index * 37) % 100}vw`,
            "--confetti-delay": `${(index % 8) * 45}ms`,
            "--confetti-color": confettiColors[index % confettiColors.length],
            "--confetti-spin": `${180 + (index % 5) * 90}deg`,
          } as CSSProperties}
        />
      ))}
      <div className="victory-burst">
        <Zap className="size-9 fill-white" />
        <span className="text-sm font-black uppercase tracking-[0.2em]">Точный удар</span>
        <strong>+{feedback.points}</strong>
        {feedback.streak > 1 && <span className="flex items-center gap-2"><Flame className="size-5 fill-white" /> Серия ×{feedback.streak}</span>}
      </div>
    </div>
  );
}

async function readJson(response: Response) {
  const data = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(data.error ?? "Что-то пошло не так");
  return data;
}

export function StudentQuiz() {
  const [roomCode, setRoomCode] = useState("");
  const [fullName, setFullName] = useState("");
  const [playerId, setPlayerId] = useState("");
  const [state, setState] = useState<RoomState | null>(null);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const [selected, setSelected] = useState<number | null>(null);
  const [feedback, setFeedback] = useState<AnswerFeedback | null>(null);

  const fetchState = useCallback(async (code: string, id: string) => {
    const response = await fetch(`/api/room/${code}/state?playerId=${encodeURIComponent(id)}`, { cache: "no-store" });
    const data = await readJson(response) as RoomState;
    if (!data.player) throw new Error("Участник не найден. Войдите в комнату заново.");
    setState(data);
    setSelected(data.answer ? Number(data.answer.optionIndex) : null);
    return data;
  }, []);

  useEffect(() => {
    const code = new URLSearchParams(window.location.search).get("room")?.toUpperCase() ?? "";
    if (!code) return;
    setRoomCode(code);
    const saved = window.localStorage.getItem(`factory-quiz:${code}`);
    if (!saved) return;
    try {
      const parsed = JSON.parse(saved) as { playerId: string; name: string };
      setPlayerId(parsed.playerId);
      setFullName(parsed.name);
    } catch {
      window.localStorage.removeItem(`factory-quiz:${code}`);
    }
  }, []);

  useEffect(() => {
    if (!roomCode || !playerId) return;
    let active = true;
    const refresh = async () => {
      try {
        if (active) await fetchState(roomCode, playerId);
      } catch (caught) {
        if (active) setError(caught instanceof Error ? caught.message : "Не удалось обновить игру");
      }
    };
    void refresh();
    const timer = window.setInterval(refresh, 1800);
    return () => {
      active = false;
      window.clearInterval(timer);
    };
  }, [fetchState, playerId, roomCode]);

  const joinParticipant = useCallback(async (codeValue: string, nameValue: string) => {
    const code = codeValue.trim().toUpperCase();
    const response = await fetch(`/api/room/${code}/join`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ name: nameValue }),
    });
    const data = await readJson(response) as { playerId: string; roomCode: string; name: string };
    setRoomCode(data.roomCode);
    setFullName(data.name);
    setPlayerId(data.playerId);
    window.localStorage.setItem(`factory-quiz:${data.roomCode}`, JSON.stringify({ playerId: data.playerId, name: data.name }));
    window.history.replaceState({}, "", `/?room=${data.roomCode}`);
    return data;
  }, []);

  const submitOption = useCallback(async (optionIndex: number) => {
    if (!state?.question || !playerId || busy || state.answer) return null;
    setBusy(true);
    setError("");
    setSelected(optionIndex);
    try {
      const response = await fetch(`/api/room/${roomCode}/answer`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ playerId, questionIndex: state.question.index, optionIndex }),
      });
      const result = await readJson(response) as AnswerFeedback;
      setFeedback(result);
      await fetchState(roomCode, playerId);
      return result;
    } catch (caught) {
      setSelected(null);
      setError(caught instanceof Error ? caught.message : "Не удалось сохранить ответ");
      throw caught;
    } finally {
      setBusy(false);
    }
  }, [busy, fetchState, playerId, roomCode, state]);

  useEffect(() => {
    setFeedback(null);
  }, [state?.question?.index]);

  useEffect(() => {
    const context = document.modelContext;
    if (!context?.registerTool) return;
    const lifecycle = new AbortController();
    void Promise.resolve(context.registerTool({
      name: "join_quiz",
      title: "Войти в викторину",
      description: "Присоединяет студента к комнате викторины по коду, фамилии и имени.",
      inputSchema: {
        type: "object",
        properties: { roomCode: { type: "string" }, fullName: { type: "string" } },
        required: ["roomCode", "fullName"],
        additionalProperties: false,
      },
      annotations: { readOnlyHint: false, untrustedContentHint: false },
      async execute(input: unknown) {
        const value = input as { roomCode?: string; fullName?: string };
        if (!value.roomCode || !value.fullName) throw new Error("Нужны код комнаты, фамилия и имя");
        const joined = await joinParticipant(value.roomCode, value.fullName);
        return { roomCode: joined.roomCode, name: joined.name, joined: true };
      },
    }, { signal: lifecycle.signal })).catch(() => undefined);

    if (state?.question && playerId) {
      void Promise.resolve(context.registerTool({
        name: "submit_quiz_answer",
        title: "Ответить на вопрос",
        description: "Отправляет выбранный вариант ответа на текущий вопрос викторины.",
        inputSchema: {
          type: "object",
          properties: { optionIndex: { type: "integer", minimum: 0, maximum: 3 } },
          required: ["optionIndex"],
          additionalProperties: false,
        },
        annotations: { readOnlyHint: false, untrustedContentHint: false },
        async execute(input: unknown) {
          const optionIndex = Number((input as { optionIndex?: number }).optionIndex);
          if (!Number.isInteger(optionIndex) || optionIndex < 0 || optionIndex > 3) throw new Error("Выберите вариант от 0 до 3");
          const result = await submitOption(optionIndex) as { correct?: boolean; points?: number } | null;
          return { correct: Boolean(result?.correct), points: Number(result?.points ?? 0) };
        },
      }, { signal: lifecycle.signal })).catch(() => undefined);
    }
    return () => lifecycle.abort();
  }, [joinParticipant, playerId, state?.question, submitOption]);

  async function handleJoin(event: FormEvent) {
    event.preventDefault();
    setBusy(true);
    setError("");
    try {
      await joinParticipant(roomCode, fullName);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Не удалось войти");
    } finally {
      setBusy(false);
    }
  }

  const rank = useMemo(() => state?.player ? state.players.findIndex((player) => player.id === state.player?.id) + 1 : 0, [state]);
  const gapToNext = useMemo(() => {
    if (!state?.player || rank <= 1) return 0;
    return Math.max(0, Number(state.players[rank - 2]?.score ?? 0) - Number(state.player.score));
  }, [rank, state]);

  if (!playerId || !state) {
    return (
      <main className="quiz-shell flex min-h-screen items-center justify-center p-5 sm:p-8">
        <a href="/admin" className="absolute right-4 top-4 flex items-center gap-2 rounded-full border-2 border-[#003C7E] bg-white px-4 py-2 text-sm font-extrabold shadow-[3px_3px_0_#003C7E] transition hover:-translate-y-0.5 sm:right-8 sm:top-7">
          <LockKeyhole className="size-4" /> Администратор
        </a>
        <section className="toon-card pop-in w-full max-w-[560px] bg-[#FFFFFF] p-6 sm:p-10">
          <div className="mb-7 flex items-center gap-4">
            <div className="grid size-16 rotate-[-4deg] place-items-center rounded-2xl border-[3px] border-[#003C7E] bg-[#0086D9] shadow-[4px_4px_0_#003C7E]">
              <Factory className="size-9" strokeWidth={2.7} />
            </div>
            <div>
              <p className="text-sm font-black uppercase tracking-[0.18em] text-[#0077CC]">Модуль 3</p>
              <h1 className="text-3xl font-black leading-none tracking-[-0.04em] sm:text-5xl">Коммерческая деятельность</h1>
            </div>
          </div>
          <p className="mb-7 text-lg font-bold leading-snug text-[#344054]">Учебная викторина по материалам модуля</p>
          <form onSubmit={handleJoin} className="space-y-5">
            <label className="block">
              <span className="mb-2 block text-sm font-black uppercase tracking-wide">Код комнаты</span>
              <Input value={roomCode} onChange={(event) => setRoomCode(event.target.value.toUpperCase())} maxLength={6} placeholder="Например: K7M2P" className="h-14 rounded-2xl border-[3px] border-[#003C7E] bg-white px-5 text-center text-2xl font-black uppercase tracking-[0.24em] shadow-[3px_3px_0_#003C7E]" required />
            </label>
            <label className="block">
              <span className="mb-2 block text-sm font-black uppercase tracking-wide">Фамилия и имя</span>
              <Input value={fullName} onChange={(event) => setFullName(event.target.value)} placeholder="Иванов Иван" className="h-14 rounded-2xl border-[3px] border-[#003C7E] bg-white px-5 text-lg font-bold shadow-[3px_3px_0_#003C7E]" required />
            </label>
            {error && <p role="alert" className="rounded-xl border-2 border-[#c92a2a] bg-[#ffe3e3] px-4 py-3 font-bold text-[#c92a2a]">{error}</p>}
            <Button disabled={busy} className="h-15 w-full rounded-2xl border-[3px] border-[#003C7E] bg-[#0086D9] text-lg font-black text-white shadow-[5px_5px_0_#003C7E] hover:bg-[#006CB8] active:translate-x-1 active:translate-y-1 active:shadow-none">
              {busy ? <LoaderCircle className="size-5 animate-spin" /> : <Sparkles className="size-5" />}
              Войти в игру <ArrowRight className="size-5" />
            </Button>
          </form>
        </section>
      </main>
    );
  }

  if (state.room.status === "lobby") {
    return (
      <main className="quiz-shell flex min-h-screen items-center justify-center p-5">
        <section className="toon-card pop-in w-full max-w-xl bg-white p-8 text-center sm:p-12">
          <div className="mx-auto mb-7 grid size-24 place-items-center rounded-full border-[3px] border-[#003C7E] bg-[#4DA9F6] shadow-[5px_5px_0_#003C7E]">
            <Factory className="floaty size-12" strokeWidth={2.5} />
          </div>
          <p className="mb-2 text-sm font-black uppercase tracking-[0.2em] text-[#0077CC]">Вы в комнате {state.room.code}</p>
          <h1 className="text-3xl font-black tracking-tight sm:text-4xl">{state.player?.name}</h1>
          <p className="mt-4 text-lg font-bold text-[#667085]">Ждём, когда преподаватель запустит первый вопрос</p>
          <div className="mt-8 flex items-center justify-center gap-2" aria-label="Ожидание начала">
            {[0, 1, 2].map((dot) => <span key={dot} className="waiting-dot size-4 rounded-full border-2 border-[#003C7E] bg-[#0086D9]" style={{ animationDelay: `${dot * 160}ms` }} />)}
          </div>
          <div className="mt-9 inline-flex rounded-full border-2 border-[#003C7E] bg-[#E6F4FF] px-5 py-2 font-black">Участников: {state.players.length}</div>
        </section>
      </main>
    );
  }

  if (state.room.status === "finished") {
    return (
      <main className="quiz-shell flex min-h-screen items-center justify-center p-5">
        <section className="toon-card winner-finale pop-in w-full max-w-2xl bg-[#FFFFFF] p-7 text-center sm:p-12">
          <Trophy className="trophy-glow floaty mx-auto mb-5 size-20 fill-[#4DA9F6] text-[#003C7E]" strokeWidth={2.3} />
          <p className="text-sm font-black uppercase tracking-[0.2em] text-[#0077CC]">Финиш</p>
          <h1 className="mt-2 text-4xl font-black tracking-tight sm:text-6xl">{state.player?.score} очков</h1>
          <p className="mt-3 text-xl font-extrabold">Ваше место: {rank || "—"}</p>
          <div className="mt-8 space-y-3 text-left">
            {state.players.slice(0, 5).map((player, index) => (
              <div key={player.id} className={`flex items-center justify-between rounded-2xl border-[3px] border-[#003C7E] px-4 py-3 font-black shadow-[3px_3px_0_#003C7E] ${player.id === state.player?.id ? "bg-[#CDEFFF]" : "bg-white"}`}>
                <span>{index + 1}. {player.name}</span><span>{player.score}</span>
              </div>
            ))}
          </div>
        </section>
      </main>
    );
  }

  const question = state.question;
  if (!question) return null;
  const answered = state.answer;
  const progress = ((question.index + 1) / question.total) * 100;

  return (
    <main className="quiz-shell min-h-screen p-4 sm:p-7">
      {feedback && <Celebration feedback={feedback} />}
      <div className="mx-auto max-w-5xl">
        <header className="mb-5 flex flex-wrap items-center justify-between gap-3">
          <div className="flex items-center gap-3">
            <span className="grid size-11 place-items-center rounded-xl border-[3px] border-[#003C7E] bg-[#0086D9] shadow-[3px_3px_0_#003C7E]"><Factory className="size-6" /></span>
            <div><p className="text-xs font-black uppercase tracking-widest text-[#0077CC]">Комната {state.room.code}</p><p className="font-black">{state.player?.name}</p></div>
          </div>
          <div className="flex flex-wrap items-center justify-end gap-2">
            <div className="rank-chip flex items-center gap-2 rounded-full border-[3px] border-[#003C7E] bg-white px-4 py-2 font-black shadow-[3px_3px_0_#003C7E]"><Crown className="size-5 fill-[#4DA9F6]" /> {rank || "—"} место</div>
            {gapToNext > 0 && <div className="rounded-full border-2 border-[#003C7E] bg-[#E6F4FF] px-4 py-2 text-sm font-black">До следующего: {gapToNext}</div>}
            <div className="score-chip rounded-full border-[3px] border-[#003C7E] bg-[#4DA9F6] px-5 py-2 text-lg font-black shadow-[3px_3px_0_#003C7E]"><Zap className="mr-1 inline size-5 fill-white" />{state.player?.score} очков</div>
          </div>
        </header>
        <section className="question-stage toon-card pop-in bg-white p-5 sm:p-8">
          <div className="mb-5 flex items-center justify-between gap-4 text-sm font-black uppercase tracking-wider">
            <span className="rounded-full bg-[#E6F4FF] px-4 py-2 text-[#005CA8]">{question.topic}</span>
            <span>{question.index + 1} / {question.total}</span>
          </div>
          <Progress value={progress} className="mb-7 h-3 border-2 border-[#003C7E] bg-[#D3E5F2] [&_[data-slot=progress-indicator]]:bg-[#0086D9]" />
          <h1 className="mb-7 text-2xl font-black leading-tight tracking-tight sm:text-4xl">{question.question}</h1>
          <div className="grid gap-4 sm:grid-cols-2">
            {question.options.map((option, index) => {
              const correct = answered && index === Number(answered.correctIndex);
              const wrongSelected = answered && index === selected && !correct;
              return (
                <button key={option} type="button" disabled={busy || Boolean(answered)} onClick={() => void submitOption(index)} className={`answer-button ${answerStyles[index]} ${correct ? "answer-correct ring-[5px] ring-[#0077CC]" : ""} ${wrongSelected ? "answer-wrong opacity-70 ring-[5px] ring-[#c92a2a]" : ""}`}>
                  <span className="grid size-10 shrink-0 place-items-center rounded-full border-[3px] border-[#003C7E] bg-white font-black">{answerLetters[index]}</span>
                  <span>{option}</span>
                </button>
              );
            })}
          </div>
          {error && <p role="alert" className="mt-5 rounded-xl border-2 border-[#c92a2a] bg-[#ffe3e3] px-4 py-3 font-bold text-[#c92a2a]">{error}</p>}
          {answered && (
            <div className={`mt-6 rounded-2xl border-[3px] border-[#003C7E] p-5 shadow-[4px_4px_0_#003C7E] ${Number(answered.isCorrect) ? "bg-[#CDEFFF]" : "bg-[#ffe3e3]"}`}>
              <div className="flex items-center gap-3 text-xl font-black">
                {Number(answered.isCorrect) ? <CheckCircle2 className="size-7" /> : <XCircle className="size-7" />}
                {Number(answered.isCorrect) ? `+${answered.points} очков! Верно` : "Пока без очков — отыграемся"}
              </div>
              {Number(answered.isCorrect) && feedback && (feedback.speedBonus > 0 || feedback.streakBonus > 0) && (
                <div className="mt-4 flex flex-wrap gap-2 text-sm font-black">
                  {feedback.speedBonus > 0 && <span className="bonus-pill"><Rocket className="size-4" /> Скорость +{feedback.speedBonus}</span>}
                  {feedback.streakBonus > 0 && <span className="bonus-pill"><Flame className="size-4 fill-[#0086D9]" /> Серия +{feedback.streakBonus}</span>}
                </div>
              )}
              <p className="mt-2 font-bold leading-relaxed text-[#344054]">{answered.explanation}</p>
              <p className="mt-3 text-sm font-black uppercase tracking-wide">Ждём следующий вопрос…</p>
            </div>
          )}
        </section>
      </div>
    </main>
  );
}
