"use client";

import { useCallback, useEffect, useState } from "react";
import { Crown, Factory, Flame, LoaderCircle, Medal, Sparkles, Trophy, Users, Zap } from "lucide-react";
import { Progress } from "@/components/ui/progress";

type Player = { id: string; name: string; score: number };
type DisplayState = {
  room: { code: string; title: string; status: "lobby" | "live" | "finished"; currentQuestion: number; questionCount: number };
  question: { index: number; topic: string; question: string; options: string[]; total: number } | null;
  players: Player[];
};

const optionColors = ["bg-[#E6F4FF]", "bg-[#AED9FF]", "bg-[#7CC6FF]", "bg-[#4DA9F6]"];

export function DisplayRoom({ code }: { code: string }) {
  const [state, setState] = useState<DisplayState | null>(null);
  const [error, setError] = useState("");

  const refresh = useCallback(async () => {
    const response = await fetch(`/api/room/${code}/state`, { cache: "no-store" });
    const data = await response.json().catch(() => ({}));
    if (!response.ok) throw new Error(data.error ?? "Комната недоступна");
    setState(data as DisplayState);
  }, [code]);

  useEffect(() => {
    let active = true;
    const update = async () => {
      try {
        if (active) await refresh();
      } catch (caught) {
        if (active) setError(caught instanceof Error ? caught.message : "Не удалось обновить экран");
      }
    };
    void update();
    const timer = window.setInterval(update, 1400);
    return () => { active = false; window.clearInterval(timer); };
  }, [refresh]);

  if (!state) return <main className="display-shell grid min-h-screen place-items-center">{error ? <p className="text-3xl font-black">{error}</p> : <LoaderCircle className="size-16 animate-spin" />}</main>;

  const { room, question, players } = state;
  const progress = question ? ((question.index + 1) / question.total) * 100 : 0;
  const leaderScore = Math.max(1, Number(players[0]?.score ?? 0));

  if (room.status === "finished") {
    return (
      <main className="display-shell finish-arena min-h-screen p-[3vw]">
        <div className="finish-sparkles" aria-hidden="true"><Sparkles /><Sparkles /><Sparkles /><Sparkles /></div>
        <header className="mb-[3vh] flex items-center justify-between">
          <div className="flex items-center gap-4"><span className="grid size-16 place-items-center rounded-2xl border-[4px] border-[#003C7E] bg-[#0086D9] shadow-[5px_5px_0_#003C7E]"><Factory className="size-9" /></span><div><p className="font-black uppercase tracking-[0.2em] text-[#0077CC]">Итоги викторины</p><h1 className="text-[clamp(2rem,4vw,4rem)] font-black leading-none">Таблица лидеров</h1></div></div>
          <Trophy className="floaty size-24 fill-[#4DA9F6]" />
        </header>
        <section className="grid gap-[2vw] lg:grid-cols-3">
          {players.slice(0, 3).map((player, index) => (
            <div key={`${player.id}-${player.score}`} className={`podium-card toon-card pop-in p-[2.5vw] text-center ${index === 0 ? "podium-first bg-[#4DA9F6] lg:-translate-y-4" : index === 1 ? "bg-[#e9ecef]" : "bg-[#B8DAF4]"}`} style={{ animationDelay: `${index * 120}ms` }}>
              {index === 0 ? <Crown className="trophy-glow mx-auto mb-4 size-16 fill-white" /> : <Medal className="mx-auto mb-4 size-16" />}
              <p className="text-5xl font-black">{index + 1}</p>
              <h2 className="mt-4 text-[clamp(1.4rem,2.6vw,3rem)] font-black leading-tight">{player.name}</h2>
              <p className="mt-5 text-[clamp(2rem,4vw,4rem)] font-black">{player.score}</p>
            </div>
          ))}
        </section>
        {players.length > 3 && <div className="mt-[3vh] grid gap-3 sm:grid-cols-2 xl:grid-cols-4">{players.slice(3, 11).map((player, index) => <div key={player.id} className="flex items-center justify-between rounded-2xl border-[3px] border-[#003C7E] bg-white px-5 py-4 text-xl font-black shadow-[3px_3px_0_#003C7E]"><span>{index + 4}. {player.name}</span><span>{player.score}</span></div>)}</div>}
      </main>
    );
  }

  return (
    <main className="display-shell min-h-screen p-[2.5vw]">
      <header className="mb-[2.5vh] flex items-center justify-between gap-5">
        <div className="flex items-center gap-4"><span className="grid size-14 place-items-center rounded-2xl border-[3px] border-[#003C7E] bg-[#0086D9] shadow-[4px_4px_0_#003C7E]"><Factory className="size-8" /></span><div><p className="text-sm font-black uppercase tracking-[0.18em] text-[#0077CC]">Модуль 3</p><h1 className="text-[clamp(1.6rem,3vw,3.5rem)] font-black leading-none">{room.title}</h1></div></div>
          <div className="flex items-center gap-3">
            {room.status === "live" && <div className="live-race-badge flex items-center gap-2 rounded-full border-[3px] border-[#003C7E] bg-[#00B8F0] px-5 py-3 text-lg font-black shadow-[3px_3px_0_#003C7E]"><Flame className="size-5 fill-white" /> Гонка идёт</div>}
            <div className="flex items-center gap-3 rounded-full border-[3px] border-[#003C7E] bg-white px-5 py-3 text-xl font-black shadow-[3px_3px_0_#003C7E]"><Users /> {players.length}</div>
          </div>
      </header>
      <div className="grid gap-[2vw] xl:grid-cols-[minmax(0,1fr)_390px]">
        <section className="toon-card min-h-[70vh] bg-white p-[2.5vw]">
          {room.status === "lobby" || !question ? (
            <div className="grid h-full min-h-[62vh] place-items-center text-center">
              <div className="lobby-pulse">
                <div className="mx-auto mb-5 flex w-fit items-center gap-2 rounded-full border-[3px] border-[#003C7E] bg-[#00B8F0] px-5 py-2 font-black uppercase tracking-widest shadow-[3px_3px_0_#003C7E]"><Zap className="size-5 fill-white" /> Готовьтесь к старту</div>
                <p className="text-xl font-black uppercase tracking-[0.22em] text-[#0077CC]">Код комнаты</p>
                <p className="my-3 text-[clamp(4rem,11vw,10rem)] font-black leading-none tracking-[0.12em]">{room.code}</p>
                <p className="text-2xl font-bold text-[#667085]">Сканируйте QR-код и вводите фамилию и имя</p>
              </div>
            </div>
          ) : (
            <div>
              <div className="mb-5 flex items-center justify-between text-lg font-black uppercase tracking-wider"><span className="rounded-full bg-[#E6F4FF] px-5 py-2 text-[#005CA8]">{question.topic}</span><span>{question.index + 1} / {question.total}</span></div>
              <Progress value={progress} className="mb-[4vh] h-4 border-[3px] border-[#003C7E] bg-[#D3E5F2] [&_[data-slot=progress-indicator]]:bg-[#0086D9]" />
              <h2 className="mb-[4vh] text-[clamp(2rem,4.3vw,5rem)] font-black leading-[1.05] tracking-[-0.035em]">{question.question}</h2>
              <div className="grid gap-[1.2vw] sm:grid-cols-2">{question.options.map((option, index) => <div key={option} className={`flex min-h-[110px] items-center gap-4 rounded-2xl border-[4px] border-[#003C7E] p-5 text-[clamp(1.1rem,2vw,2rem)] font-black shadow-[5px_5px_0_#003C7E] ${optionColors[index]}`}><span className="grid size-12 shrink-0 place-items-center rounded-full border-[3px] border-[#003C7E] bg-white">{index + 1}</span>{option}</div>)}</div>
            </div>
          )}
        </section>
        <aside className="space-y-5">
          <section className="toon-card bg-[#FFFFFF] p-5 text-center">
            <img src={`/api/qr?room=${room.code}`} alt={`QR-код комнаты ${room.code}`} className="mx-auto aspect-square w-full max-w-[260px] rounded-2xl border-[3px] border-[#003C7E] p-2" />
            <p className="mt-3 text-sm font-black uppercase tracking-widest">Код комнаты</p><p className="text-4xl font-black tracking-[0.12em]">{room.code}</p>
          </section>
          <section className="toon-card bg-white p-5">
            <div className="mb-4 flex items-center justify-between"><div><p className="text-xs font-black uppercase tracking-[0.18em] text-[#0077CC]">В прямом эфире</p><h2 className="text-2xl font-black">Гонка лидеров</h2></div><Trophy className="trophy-glow size-8 fill-[#4DA9F6]" /></div>
            <div className="space-y-3">{players.slice(0, 8).map((player, index) => {
              const scoreShare = Number(player.score) > 0 ? Math.max(7, Math.round((Number(player.score) / leaderScore) * 100)) : 0;
              return (
                <div key={`${player.id}-${player.score}`} className={`race-row rounded-xl border-2 border-[#003C7E] px-4 py-3 font-black ${index === 0 ? "race-leader bg-[#D6ECFF] shadow-[3px_3px_0_#003C7E]" : "bg-[#F4F9FD]"}`}>
                  <div className="flex items-center justify-between gap-3"><span className="max-w-[225px] truncate">{index === 0 ? <Crown className="mr-2 inline size-5 fill-[#4DA9F6]" /> : `${index + 1}.`} {player.name}</span><span className="score-pop flex items-center gap-1"><Zap className="size-4 fill-[#0086D9]" />{player.score}</span></div>
                  <div className="race-meter mt-2"><span style={{ width: `${scoreShare}%` }} /></div>
                </div>
              );
            })}{!players.length && <p className="py-8 text-center font-bold text-[#667085]">Пока никого нет</p>}</div>
          </section>
        </aside>
      </div>
    </main>
  );
}
