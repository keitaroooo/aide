import { useEffect, useMemo, useRef, useState, type FormEvent } from "react";
import { Link, useSearchParams } from "react-router-dom";
import { client, type Task } from "../lib/api";
import { useAuth } from "../lib/auth";
import { SettingsPanel } from "./SettingsPanel";

type CalEvent = { id: string; title: string; start_at: string | null; day?: string };

function formatDayLabel(ymd: string, today: string, timeZone: string): string {
  if (ymd === today) return "今日";
  const tomYmd = new Intl.DateTimeFormat("en-CA", {
    timeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(new Date(Date.now() + 24 * 60 * 60 * 1000));
  if (ymd === tomYmd) return "明日";
  const d = new Date(`${ymd}T12:00:00`);
  return new Intl.DateTimeFormat("ja-JP", {
    timeZone,
    weekday: "short",
    month: "numeric",
    day: "numeric",
  }).format(d);
}

function formatEventTime(startAt: string | null, timeZone: string): string {
  if (!startAt) return "";
  if (/^\d{4}-\d{2}-\d{2}$/.test(startAt)) return "終日";
  const d = new Date(startAt);
  if (Number.isNaN(d.getTime())) return startAt;
  return new Intl.DateTimeFormat("ja-JP", {
    timeZone,
    hour: "2-digit",
    minute: "2-digit",
  }).format(d);
}

function groupByDay(events: CalEvent[]): Array<{ day: string; items: CalEvent[] }> {
  const map = new Map<string, CalEvent[]>();
  for (const ev of events) {
    const day = ev.day || (ev.start_at ? ev.start_at.slice(0, 10) : "");
    if (!day) continue;
    const list = map.get(day) ?? [];
    list.push(ev);
    map.set(day, list);
  }
  return [...map.entries()].map(([day, items]) => ({ day, items }));
}

export function HomePage() {
  const { user } = useAuth();
  const [searchParams, setSearchParams] = useSearchParams();
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [soon, setSoon] = useState<Task[]>([]);
  const [should, setShould] = useState<Task[]>([]);
  const [weekEvents, setWeekEvents] = useState<CalEvent[]>([]);
  const [today, setToday] = useState("");
  const [timezone, setTimezone] = useState(user?.timezone ?? "Asia/Tokyo");
  const [messages, setMessages] = useState<
    Array<{ id: string; role: "user" | "assistant"; content: string }>
  >([]);
  const [notice, setNotice] = useState<string | null>(null);
  const [text, setText] = useState("");
  const [busy, setBusy] = useState(false);
  const bottomRef = useRef<HTMLDivElement>(null);

  async function loadHome() {
    const data = await client.home();
    setSoon(data.soon);
    setShould(data.should);
    setWeekEvents(data.weekEvents);
    setToday(data.today);
    setTimezone(data.timezone);
  }

  useEffect(() => {
    void loadHome();
    void client.chatHistory().then((d) => setMessages(d.messages));
  }, []);

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages]);

  useEffect(() => {
    if (!searchParams.has("google") && !searchParams.has("linked") && !searchParams.has("error")) {
      return;
    }
    const tasks = searchParams.get("tasks");
    const cal = searchParams.get("cal");
    const linked = searchParams.get("linked");
    const next = new URLSearchParams(searchParams);
    next.delete("google");
    next.delete("tasks");
    next.delete("cal");
    next.delete("linked");
    next.delete("error");
    setSearchParams(next, { replace: true });

    if (searchParams.has("google") || linked === "google") {
      const t = tasks != null ? Number(tasks) : 0;
      const c = cal != null ? Number(cal) : 0;
      setNotice(
        `Google と連携しました。Tasks ${t} 件・カレンダー ${c} 件を取り込みました。`,
      );
      void loadHome();
      return;
    }
    if (linked === "github") {
      setSettingsOpen(true);
      void (async () => {
        try {
          await client.importGitHub(8);
          setNotice("GitHub Projects を取り込みました。");
          await loadHome();
        } catch {
          setNotice("GitHub 連携は完了。Projects 取込は設定から実行できます。");
        }
      })();
    }
  }, [searchParams, setSearchParams]);

  const dayGroups = useMemo(() => groupByDay(weekEvents), [weekEvents]);
  const todayEvents = useMemo(
    () => dayGroups.find((g) => g.day === today)?.items ?? [],
    [dayGroups, today],
  );

  async function send(e: FormEvent) {
    e.preventDefault();
    if (!text.trim() || busy) return;
    const content = text.trim();
    setText("");
    setBusy(true);
    setMessages((m) => [...m, { id: crypto.randomUUID(), role: "user", content }]);
    try {
      const res = await client.chat(content);
      setMessages((m) => [
        ...m,
        { id: crypto.randomUUID(), role: "assistant", content: res.reply },
      ]);
      await loadHome();
    } catch (err) {
      setMessages((m) => [
        ...m,
        {
          id: crypto.randomUUID(),
          role: "assistant",
          content: err instanceof Error ? err.message : "エラー",
        },
      ]);
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="stack fade-in">
      <header
        className="hero-home row"
        style={{ justifyContent: "space-between", alignItems: "flex-start" }}
      >
        <div>
          <p className="muted">こんにちは、{user?.name}</p>
          <h1>今日、何をする？</h1>
          <p className="muted">話すだけで、やることを整える。</p>
        </div>
        <div className="row" style={{ gap: "0.35rem" }}>
          <Link to="/board" className="btn ghost">
            ボード
          </Link>
          <button type="button" className="btn ghost" onClick={() => setSettingsOpen(true)}>
            設定
          </button>
        </div>
      </header>

      {notice && (
        <div className="card" style={{ borderColor: "var(--accent-soft)" }}>
          <p style={{ margin: 0 }}>{notice}</p>
        </div>
      )}

      <div className="card chat-log">
        {messages.length === 0 && (
          <p className="muted">まだ会話がありません。話しかけてみてください。</p>
        )}
        {messages.map((m) => (
          <div key={m.id} className={`bubble ${m.role}`}>
            {m.content}
          </div>
        ))}
        <div ref={bottomRef} />
      </div>

      <form className="row" onSubmit={(e) => void send(e)}>
        <input
          className="field"
          placeholder="例: 今日やることは？ / 買い物を追加"
          value={text}
          onChange={(e) => setText(e.target.value)}
        />
        <button className="btn primary" disabled={busy}>
          {busy ? "…" : "送る"}
        </button>
      </form>

      <section className="card stack">
        <h2 className="brand" style={{ fontSize: "1.2rem", margin: 0 }}>
          今日の予定
        </h2>
        {todayEvents.length === 0 && <p className="muted">今日の予定はありません</p>}
        {todayEvents.map((ev) => (
          <div className="timeline-row" key={ev.id}>
            <div className="timeline-time muted">{formatEventTime(ev.start_at, timezone)}</div>
            <div className="timeline-body">
              <div>{ev.title}</div>
            </div>
            <button className="btn ghost" onClick={() => void client.eventToTask(ev.id).then(loadHome)}>
              タスクに
            </button>
          </div>
        ))}
      </section>

      <section className="card stack">
        <h2 className="brand" style={{ fontSize: "1.2rem", margin: 0 }}>
          一週間の予定
        </h2>
        {dayGroups.length === 0 && <p className="muted">今後1週間の予定はありません</p>}
        {dayGroups.map((group) => (
          <div key={group.day} className="stack" style={{ gap: "0.35rem" }}>
            <p className="timeline-day">{formatDayLabel(group.day, today, timezone)}</p>
            {group.items.map((ev) => (
              <div className="timeline-row" key={ev.id}>
                <div className="timeline-time muted">{formatEventTime(ev.start_at, timezone)}</div>
                <div className="timeline-body">
                  <div>{ev.title}</div>
                </div>
                <button
                  className="btn ghost"
                  onClick={() => void client.eventToTask(ev.id).then(loadHome)}
                >
                  タスクに
                </button>
              </div>
            ))}
          </div>
        ))}
      </section>

      <section className="card">
        <h2 className="brand" style={{ fontSize: "1.2rem" }}>
          直近
        </h2>
        {soon.length === 0 && <p className="muted">まだありません</p>}
        {soon.map((t) => (
          <div className="task" key={t.id}>
            <div>
              <div>{t.title}</div>
              {t.due_at && <div className="muted">{t.due_at.slice(0, 10)}</div>}
            </div>
            <button
              className="btn ghost"
              onClick={() => void client.patchTask(t.id, { status: "done" }).then(loadHome)}
            >
              完了
            </button>
          </div>
        ))}
      </section>

      <section className="card">
        <h2 className="brand" style={{ fontSize: "1.2rem" }}>
          やるべき
        </h2>
        {should.length === 0 && <p className="muted">期限付きはなし</p>}
        {should.map((t) => (
          <div className="task" key={t.id}>
            <div>
              <div>{t.title}</div>
              {t.due_at && <div className="muted">期限 {t.due_at.slice(0, 10)}</div>}
            </div>
            <button
              className="btn ghost"
              onClick={() => void client.patchTask(t.id, { status: "done" }).then(loadHome)}
            >
              完了
            </button>
          </div>
        ))}
      </section>

      <SettingsPanel open={settingsOpen} onClose={() => setSettingsOpen(false)} />
    </div>
  );
}
