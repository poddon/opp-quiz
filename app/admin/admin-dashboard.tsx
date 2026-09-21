"use client";

import { FormEvent, useCallback, useEffect, useState } from "react";
import { ChevronLeft, ChevronRight, Clipboard, Coffee, ExternalLink, Factory, LoaderCircle, LogOut, Medal, MinusCircle, MonitorUp, MoreHorizontal, Play, Plus, PlusCircle, RotateCcw, Smartphone, Square, Users } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Progress } from "@/components/ui/progress";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuLabel, DropdownMenuSeparator, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";

type Room = { id: string; code: string; title: string; status: "lobby" | "live" | "finished"; currentQuestion: number; playerCount: number };
type Player = { id: string; name: string; score: number; joinedAt: number; lastReason?: string | null; lastDelta?: number | null };
type AdminState = {
  room: Room & { questionCount: number };
  question: { index: number; topic: string; question: string; options: string[]; total: number; correctIndex: number; explanation: string } | null;
  players: Player[];
};

async function readJson(response: Response) {
  const data = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(data.error ?? "Не удалось выполнить действие");
  return data;
}

function adminFetch(input: RequestInfo | URL, init?: RequestInit) {
  return fetch(input, { ...init, credentials: "include" });
}

const statusText = { lobby: "Сбор участников", live: "Идёт викторина", finished: "Завершено" };
const statusClass = { lobby: "bg-[#4DA9F6]", live: "bg-[#00B8F0]", finished: "bg-[#DDEAF5]" };

export function AdminDashboard() {
  const [authenticated, setAuthenticated] = useState<boolean | null>(null);
  const [username, setUsername] = useState("admin");
  const [password, setPassword] = useState("");
  const [rooms, setRooms] = useState<Room[]>([]);
  const [selectedCode, setSelectedCode] = useState("");
  const [state, setState] = useState<AdminState | null>(null);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);

  const loadRooms = useCallback(async () => {
    const response = await adminFetch("/api/admin/rooms", { cache: "no-store" });
    const data = await readJson(response) as { rooms: Room[] };
    setRooms(data.rooms);
    setSelectedCode((current) => current || data.rooms[0]?.code || "");
  }, []);

  const loadRoom = useCallback(async (code: string) => {
    if (!code) return;
    const response = await adminFetch(`/api/admin/room/${code}`, { cache: "no-store" });
    const data = await readJson(response) as AdminState;
    setState(data);
  }, []);

  useEffect(() => {
    void adminFetch("/api/admin/me", { cache: "no-store" })
      .then((response) => {
        setAuthenticated(response.ok);
        if (response.ok) return loadRooms();
      })
      .catch(() => setAuthenticated(false));
  }, [loadRooms]);

  useEffect(() => {
    if (!authenticated || !selectedCode) return;
    let active = true;
    const refresh = async () => {
      try {
        if (active) await loadRoom(selectedCode);
      } catch (caught) {
        if (active) setError(caught instanceof Error ? caught.message : "Не удалось обновить комнату");
      }
    };
    void refresh();
    const timer = window.setInterval(refresh, 1500);
    return () => {
      active = false;
      window.clearInterval(timer);
    };
  }, [authenticated, loadRoom, selectedCode]);

  async function login(event: FormEvent) {
    event.preventDefault();
    setBusy(true);
    setError("");
    try {
      await readJson(await adminFetch("/api/admin/login", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ username, password }),
      }));
      setAuthenticated(true);
      await loadRooms();
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Не удалось войти");
    } finally {
      setBusy(false);
    }
  }

  async function createRoom() {
    setBusy(true);
    setError("");
    try {
      const data = await readJson(await adminFetch("/api/admin/rooms", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ title: "Коммерческая деятельность производства" }),
      })) as { room: Room };
      await loadRooms();
      setSelectedCode(data.room.code);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Не удалось создать комнату");
    } finally {
      setBusy(false);
    }
  }

  async function control(action: "start" | "next" | "previous" | "finish" | "lobby") {
    if (!selectedCode) return;
    setBusy(true);
    setError("");
    try {
      await readJson(await adminFetch(`/api/admin/room/${selectedCode}/control`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action }),
      }));
      await loadRoom(selectedCode);
      await loadRooms();
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Команда не выполнена");
    } finally {
      setBusy(false);
    }
  }

  async function adjustScore(playerId: string, delta: number, reason: string) {
    if (!selectedCode) return;
    setError("");
    try {
      await readJson(await adminFetch(`/api/admin/room/${selectedCode}/score`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ playerId, delta, reason }),
      }));
      await loadRoom(selectedCode);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Баллы не изменены");
    }
  }

  async function logout() {
    await adminFetch("/api/admin/logout", { method: "POST" });
    setAuthenticated(false);
    setRooms([]);
    setState(null);
  }

  if (authenticated === null) {
    return <main className="admin-shell grid min-h-screen place-items-center"><LoaderCircle className="size-12 animate-spin" /></main>;
  }

  if (!authenticated) {
    return (
      <main className="admin-shell flex min-h-screen items-center justify-center p-5">
        <section className="toon-card pop-in w-full max-w-md bg-white p-7 sm:p-10">
          <div className="mb-7 flex items-center gap-4">
            <span className="grid size-14 place-items-center rounded-2xl border-[3px] border-[#003C7E] bg-[#4DA9F6] shadow-[4px_4px_0_#003C7E]"><Factory className="size-8" /></span>
            <div><p className="text-sm font-black uppercase tracking-widest text-[#0077CC]">Панель ведущего</p><h1 className="text-3xl font-black">Вход</h1></div>
          </div>
          <form onSubmit={login} className="space-y-5">
            <label className="block"><span className="mb-2 block text-sm font-black uppercase">Должность</span><Input value={username} onChange={(event) => setUsername(event.target.value)} className="h-13 rounded-xl border-[3px] border-[#003C7E] bg-[#FFFFFF] px-4 text-lg font-bold shadow-[3px_3px_0_#003C7E]" /></label>
            <label className="block"><span className="mb-2 block text-sm font-black uppercase">Пароль</span><Input type="password" value={password} onChange={(event) => setPassword(event.target.value)} className="h-13 rounded-xl border-[3px] border-[#003C7E] bg-[#FFFFFF] px-4 text-lg font-bold shadow-[3px_3px_0_#003C7E]" /></label>
            {error && <p role="alert" className="rounded-xl border-2 border-[#c92a2a] bg-[#ffe3e3] p-3 font-bold text-[#c92a2a]">{error}</p>}
            <Button disabled={busy} className="h-14 w-full rounded-xl border-[3px] border-[#003C7E] bg-[#0086D9] text-lg font-black text-white shadow-[4px_4px_0_#003C7E] hover:bg-[#006CB8]">{busy && <LoaderCircle className="animate-spin" />} Войти</Button>
          </form>
          <a href="/" className="mt-6 block text-center font-bold underline underline-offset-4">Вернуться к входу участника</a>
        </section>
      </main>
    );
  }

  const question = state?.question;
  const currentRoom = state?.room;
  const progress = question ? ((question.index + 1) / question.total) * 100 : 0;

  return (
    <main className="admin-shell min-h-screen p-4 sm:p-6">
      <header className="mx-auto mb-5 flex max-w-[1600px] flex-wrap items-center justify-between gap-4">
        <div className="flex items-center gap-3">
          <span className="grid size-12 place-items-center rounded-xl border-[3px] border-[#003C7E] bg-[#0086D9] shadow-[3px_3px_0_#003C7E]"><Factory className="size-7" /></span>
          <div><p className="text-xs font-black uppercase tracking-[0.18em] text-[#0077CC]">Панель ведущего</p><h1 className="text-2xl font-black sm:text-3xl">Коммерческая деятельность</h1></div>
        </div>
        <div className="flex flex-wrap gap-2">
          <Button onClick={createRoom} disabled={busy} className="rounded-xl border-2 border-[#003C7E] bg-[#0086D9] font-black text-white shadow-[2px_2px_0_#003C7E] hover:bg-[#006CB8]"><Plus /> Новая комната</Button>
          <Button onClick={logout} variant="outline" className="rounded-xl border-2 border-[#003C7E] bg-white font-black shadow-[2px_2px_0_#003C7E]"><LogOut /> Выйти</Button>
        </div>
      </header>

      {error && <div role="alert" className="mx-auto mb-5 max-w-[1600px] rounded-xl border-2 border-[#c92a2a] bg-[#ffe3e3] px-4 py-3 font-bold text-[#c92a2a]">{error}</div>}

      {!selectedCode || !currentRoom ? (
        <section className="toon-card mx-auto mt-20 max-w-xl bg-white p-10 text-center">
          <Users className="mx-auto mb-5 size-16" />
          <h2 className="text-3xl font-black">Создайте комнату</h2>
          <p className="mt-3 font-bold text-[#667085]">После этого появится QR-код для участников и таблица рейтинга.</p>
          <Button onClick={createRoom} className="mt-7 h-13 rounded-xl border-[3px] border-[#003C7E] bg-[#0086D9] px-6 font-black text-white shadow-[4px_4px_0_#003C7E] hover:bg-[#006CB8]"><Plus /> Создать комнату</Button>
        </section>
      ) : (
        <div className="mx-auto grid max-w-[1600px] gap-5 xl:grid-cols-[310px_minmax(0,1fr)_460px]">
          <aside className="space-y-5">
            <section className="toon-card bg-[#FFFFFF] p-5 text-center">
              <div className={`mx-auto mb-4 inline-flex rounded-full border-2 border-[#003C7E] px-4 py-1.5 text-sm font-black ${statusClass[currentRoom.status]}`}>{statusText[currentRoom.status]}</div>
              <p className="text-sm font-black uppercase tracking-widest">Код комнаты</p>
              <button type="button" onClick={() => void navigator.clipboard.writeText(currentRoom.code)} className="my-2 flex w-full items-center justify-center gap-3 text-5xl font-black tracking-[0.12em]" title="Скопировать код">{currentRoom.code}<Clipboard className="size-5" /></button>
              <img src={`/api/qr?room=${currentRoom.code}`} alt={`QR-код комнаты ${currentRoom.code}`} className="mx-auto mt-4 aspect-square w-full max-w-[230px] rounded-2xl border-[3px] border-[#003C7E] bg-[#FFFFFF] p-2" />
              <p className="mt-3 text-sm font-bold text-[#667085]">Наведите камеру телефона</p>
              <Button asChild className="mt-4 w-full rounded-xl border-2 border-[#003C7E] bg-[#0086D9] font-black text-white shadow-[2px_2px_0_#003C7E] hover:bg-[#006CB8]"><a href={`/display/${currentRoom.code}`} target="_blank" rel="noreferrer"><MonitorUp /> Большой экран <ExternalLink /></a></Button>
            </section>
            {rooms.length > 1 && (
              <section className="rounded-2xl border-[3px] border-[#003C7E] bg-white p-4 shadow-[4px_4px_0_#003C7E]">
                <p className="mb-3 text-sm font-black uppercase tracking-wider">Комнаты</p>
                <div className="space-y-2">{rooms.map((room) => <button key={room.id} type="button" onClick={() => setSelectedCode(room.code)} className={`flex w-full items-center justify-between rounded-xl border-2 border-[#003C7E] px-3 py-2 font-black ${room.code === selectedCode ? "bg-[#CDEFFF]" : "bg-[#F4F9FD]"}`}><span>{room.code}</span><span>{room.playerCount}</span></button>)}</div>
              </section>
            )}
          </aside>

          <section className="toon-card bg-white p-5 sm:p-7">
            <div className="mb-5 flex items-center justify-between gap-3">
              <div><p className="text-sm font-black uppercase tracking-widest text-[#0077CC]">Управление игрой</p><h2 className="text-2xl font-black">{currentRoom.title}</h2></div>
              <span className="rounded-full border-2 border-[#003C7E] bg-[#E6F4FF] px-4 py-2 font-black"><Users className="mr-2 inline size-4" />{state.players.length}</span>
            </div>
            {question ? (
              <div className="rounded-2xl border-[3px] border-[#003C7E] bg-[#FFFFFF] p-5 shadow-[4px_4px_0_#003C7E]">
                <div className="mb-3 flex items-center justify-between text-sm font-black uppercase tracking-wide"><span>{question.topic}</span><span>{question.index + 1} / {question.total}</span></div>
                <Progress value={progress} className="mb-5 h-3 border-2 border-[#003C7E] bg-white [&_[data-slot=progress-indicator]]:bg-[#0086D9]" />
                <h3 className="text-2xl font-black leading-tight">{question.question}</h3>
                <div className="mt-5 grid gap-3 sm:grid-cols-2">
                  {question.options.map((option, index) => <div key={option} className={`rounded-xl border-2 border-[#003C7E] px-4 py-3 font-bold ${index === question.correctIndex ? "bg-[#CDEFFF] shadow-[3px_3px_0_#003C7E]" : "bg-white"}`}><span className="mr-2 font-black">{index + 1}.</span>{option}</div>)}
                </div>
                <p className="mt-5 rounded-xl bg-white p-4 text-sm font-bold leading-relaxed text-[#344054]">{question.explanation}</p>
              </div>
            ) : (
              <div className="grid min-h-[360px] place-items-center rounded-2xl border-[3px] border-dashed border-[#003C7E] bg-[#FFFFFF] p-7 text-center"><div><Play className="mx-auto mb-4 size-16 fill-[#4DA9F6]" /><h3 className="text-3xl font-black">Всё готово</h3><p className="mt-2 font-bold text-[#667085]">Соберите участников и запускайте первый вопрос.</p></div></div>
            )}
            <div className="mt-6 grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
              {currentRoom.status === "lobby" ? <Button onClick={() => control("start")} disabled={busy} className="h-12 rounded-xl border-[3px] border-[#003C7E] bg-[#00B8F0] font-black text-[#003C7E] shadow-[3px_3px_0_#003C7E] hover:bg-[#009FD1] sm:col-span-2"><Play /> Начать викторину</Button> : <Button onClick={() => control("previous")} disabled={busy || currentRoom.currentQuestion === 0} variant="outline" className="h-12 rounded-xl border-[3px] border-[#003C7E] bg-white font-black shadow-[3px_3px_0_#003C7E]"><ChevronLeft /> Назад</Button>}
              {currentRoom.status === "live" && <Button onClick={() => control("next")} disabled={busy || currentRoom.currentQuestion >= currentRoom.questionCount - 1} className="h-12 rounded-xl border-[3px] border-[#003C7E] bg-[#0086D9] font-black text-white shadow-[3px_3px_0_#003C7E] hover:bg-[#006CB8]">Следующий <ChevronRight /></Button>}
              {currentRoom.status !== "finished" ? <Button onClick={() => control("finish")} disabled={busy} variant="destructive" className="h-12 rounded-xl border-[3px] border-[#003C7E] font-black shadow-[3px_3px_0_#003C7E]"><Square /> Завершить</Button> : <Button onClick={() => control("lobby")} disabled={busy} className="h-12 rounded-xl border-[3px] border-[#003C7E] bg-[#4DA9F6] font-black text-[#003C7E] shadow-[3px_3px_0_#003C7E] hover:bg-[#268FE3]"><RotateCcw /> В лобби</Button>}
            </div>
          </section>

          <section className="toon-card min-w-0 bg-white p-5">
            <div className="mb-4 flex items-center justify-between"><div><p className="text-sm font-black uppercase tracking-widest text-[#0077CC]">Рейтинг</p><h2 className="text-2xl font-black">Участники</h2></div><Medal className="size-9 text-[#0077CC]" /></div>
            <Table>
              <TableHeader><TableRow className="border-[#003C7E]"><TableHead className="w-10 font-black">#</TableHead><TableHead className="font-black">Фамилия и имя</TableHead><TableHead className="text-right font-black">Очки</TableHead><TableHead className="w-10" /></TableRow></TableHeader>
              <TableBody>
                {state.players.map((player, index) => (
                  <TableRow key={player.id} className={index === 0 ? "bg-[#D6ECFF]" : ""}>
                    <TableCell className="font-black">{index + 1}</TableCell>
                    <TableCell><div className="max-w-[210px] truncate font-extrabold">{player.name}</div>{player.lastReason && <div className={`max-w-[210px] truncate text-xs font-bold ${Number(player.lastDelta) < 0 ? "text-[#c92a2a]" : "text-[#0077CC]"}`}>{Number(player.lastDelta) > 0 ? "+" : ""}{player.lastDelta} · {player.lastReason}</div>}</TableCell>
                    <TableCell className="text-right text-lg font-black">{player.score}</TableCell>
                    <TableCell>
                      <DropdownMenu>
                        <DropdownMenuTrigger asChild><Button variant="ghost" size="icon" aria-label={`Изменить баллы ${player.name}`}><MoreHorizontal /></Button></DropdownMenuTrigger>
                        <DropdownMenuContent align="end" className="w-56 border-2 border-[#003C7E] bg-white font-bold shadow-[4px_4px_0_#003C7E]">
                          <DropdownMenuLabel>Изменить баллы</DropdownMenuLabel>
                          <DropdownMenuSeparator />
                          <DropdownMenuItem onSelect={() => void adjustScore(player.id, -50, "Сон на занятии")}><Coffee /> −50 · Сон</DropdownMenuItem>
                          <DropdownMenuItem onSelect={() => void adjustScore(player.id, -30, "Телефон на занятии")}><Smartphone /> −30 · Телефон</DropdownMenuItem>
                          <DropdownMenuItem onSelect={() => void adjustScore(player.id, -20, "Нарушение дисциплины")}><MinusCircle /> −20 · Нарушение</DropdownMenuItem>
                          <DropdownMenuSeparator />
                          <DropdownMenuItem onSelect={() => void adjustScore(player.id, 50, "Активность на занятии")}><PlusCircle /> +50 · Активность</DropdownMenuItem>
                        </DropdownMenuContent>
                      </DropdownMenu>
                    </TableCell>
                  </TableRow>
                ))}
                {!state.players.length && <TableRow><TableCell colSpan={4} className="py-12 text-center font-bold text-[#667085]">Участники появятся после входа по QR-коду</TableCell></TableRow>}
              </TableBody>
            </Table>
          </section>
        </div>
      )}
    </main>
  );
}
