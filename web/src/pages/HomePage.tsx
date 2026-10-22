import { useEffect, useMemo, useState } from "react";
import { useSearchParams } from "react-router-dom";
import {
  client,
  DOMAINS,
  domainOf,
  PRIORITY_LABEL,
  type Domain,
  type Task,
} from "../lib/api";
import { useAuth } from "../lib/auth";
import { AIDE_ROLE } from "../lib/principle";

function priorityOf(t: Task): number {
  const p = t.priority ?? 1;
  return p < 0 ? 0 : p > 2 ? 2 : p;
}

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

function sortTasks(a: Task, b: Task): number {
  const aDue = a.due_at ? 0 : 1;
  const bDue = b.due_at ? 0 : 1;
  if (aDue !== bDue) return aDue - bDue;
  if (a.due_at && b.due_at && a.due_at !== b.due_at) {
    return a.due_at < b.due_at ? -1 : 1;
  }
  const ap = priorityOf(a);
  const bp = priorityOf(b);
  if (ap !== bp) return bp - ap;
  return 0;
}

function byDomain(tasks: Task[], label: Domain | null): Task[] {
  if (!label) return tasks;
  return tasks.filter((t) => domainOf(t) === label);
}

function TaskList({
  title,
  tasks,
  empty,
}: {
  title: string;
  tasks: Task[];
  empty: string;
}) {
  return (
    <section className="card">
      <h2 className="section-title" style={{ marginBottom: "0.5rem" }}>
        {title}
      </h2>
      {tasks.length === 0 && <p className="muted">{empty}</p>}
      {tasks.map((t) => {
        const p = priorityOf(t);
        const d = domainOf(t);
        return (
          <div className="task" key={t.id}>
            <div>
              <div>{t.title}</div>
              {t.due_at && <div className="muted">期限 {t.due_at.slice(0, 10)}</div>}
            </div>
            <div className="row muted" style={{ gap: "0.35rem", flexShrink: 0 }}>
              <span>{d ?? "—"}</span>
              <span>{PRIORITY_LABEL[p]}</span>
            </div>
          </div>
        );
      })}
    </section>
  );
}

export function HomePage() {
  const { user } = useAuth();
  const [searchParams, setSearchParams] = useSearchParams();
  const [label, setLabel] = useState<Domain | null>(null);
  const [inbox, setInbox] = useState<Task[]>([]);
  const [soon, setSoon] = useState<Task[]>([]);
  const [should, setShould] = useState<Task[]>([]);
  const [someday, setSomeday] = useState<Task[]>([]);
  const [weekEvents, setWeekEvents] = useState<CalEvent[]>([]);
  const [today, setToday] = useState("");
  const [timezone, setTimezone] = useState(user?.timezone ?? "Asia/Tokyo");
  const [notice, setNotice] = useState<string | null>(null);

  async function loadHome() {
    const data = await client.home();
    setInbox(data.inbox ?? []);
    setSoon(data.soon);
    setShould(data.should);
    setSomeday(data.someday ?? []);
    setWeekEvents(data.weekEvents);
    setToday(data.today);
    setTimezone(data.timezone);
  }

  useEffect(() => {
    void loadHome();
  }, []);

  useEffect(() => {
    if (!searchParams.has("error")) return;
    const next = new URLSearchParams(searchParams);
    next.delete("error");
    setSearchParams(next, { replace: true });
    setNotice("エラー");
  }, [searchParams, setSearchParams]);

  const dayGroups = useMemo(() => groupByDay(weekEvents), [weekEvents]);
  const todo = useMemo(
    () => byDomain([...inbox, ...should, ...soon].sort(sortTasks), label),
    [inbox, should, soon, label],
  );
  const want = useMemo(
    () => byDomain([...someday].sort(sortTasks), label),
    [someday, label],
  );

  return (
    <div className="stack fade-in">
      <header>
        <h1 style={{ margin: 0, fontSize: "1.35rem" }}>Aide</h1>
        <p className="muted" style={{ margin: "0.2rem 0 0" }}>
          {AIDE_ROLE}
        </p>
      </header>

      {notice && (
        <p className="muted" style={{ margin: 0 }}>
          {notice}
        </p>
      )}

      <div className="chip-row" role="group" aria-label="label">
        {DOMAINS.map((d) => (
          <button
            key={d}
            type="button"
            className={`btn ghost${label === d ? " chip-on" : ""}`}
            onClick={() => setLabel((cur) => (cur === d ? null : d))}
          >
            {d}
          </button>
        ))}
      </div>

      <TaskList title="TODO" tasks={todo} empty="なし" />

      <TaskList title="WANT" tasks={want} empty="行きたい場所などは md / 取込から" />

      <section className="card stack">
        <h2 className="section-title">SCHEDULE</h2>
        {dayGroups.length === 0 && <p className="muted">なし</p>}
        {dayGroups.map((group) => (
          <div key={group.day} className="stack" style={{ gap: "0.25rem" }}>
            <p className="timeline-day">{formatDayLabel(group.day, today, timezone)}</p>
            {group.items.map((ev) => (
              <div className="timeline-row" key={ev.id}>
                <div className="timeline-time muted">{formatEventTime(ev.start_at, timezone)}</div>
                <div className="timeline-body">{ev.title}</div>
              </div>
            ))}
          </div>
        ))}
      </section>
    </div>
  );
}
