import { useEffect, useMemo, useState, type ReactNode } from "react";
import { useSearchParams } from "react-router-dom";
import {
  client,
  DOMAINS,
  domainOf,
  PRIORITY_LABEL,
  type Domain,
  type Horizon,
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

function byDomain(tasks: Task[], labels: readonly Domain[]): Task[] {
  if (labels.length === 0) return tasks;
  return tasks.filter((t) => {
    const d = domainOf(t);
    return d != null && labels.includes(d);
  });
}

function isInProgress(t: Task): boolean {
  const notes = t.notes ?? "";
  if (/(?:^|\s)place=(?:TODO|WANT)(?:\s|$)/.test(notes)) return false;
  return /(?:^|\s)kind=task(?:\s|$)/.test(notes) || /(?:^|\s)status=In progress(?:\s|$)/.test(notes);
}

const DOMAIN_ORDER = ["assets", "engineering", "health", "self", "trip", "career", "works"];

function ordOf(t: Task): number | null {
  const m = (t.notes ?? "").match(/(?:^|\s)ord=(\d+)/);
  return m ? Number(m[1]) : null;
}

function domainKey(t: Task): string {
  return (t.notes ?? "").match(/(?:^|\s)domain=([a-z]+)/i)?.[1]?.toLowerCase() ?? "";
}

function fileOf(t: Task): string {
  return (t.notes ?? "").match(/(?:^|\s)file=(\S+)/)?.[1] ?? "";
}

function sortSection(tasks: Task[]): Task[] {
  return [...tasks].sort((a, b) => {
    const ao = ordOf(a);
    const bo = ordOf(b);
    if (ao != null && bo != null) {
      const ad = DOMAIN_ORDER.indexOf(domainKey(a));
      const bd = DOMAIN_ORDER.indexOf(domainKey(b));
      const ai = ad < 0 ? DOMAIN_ORDER.length : ad;
      const bi = bd < 0 ? DOMAIN_ORDER.length : bd;
      if (ai !== bi) return ai - bi;
      return ao - bo;
    }
    if (ao != null) return -1;
    if (bo != null) return 1;
    return sortTasks(a, b);
  });
}

type Place = "In Progress" | "TODO" | "WANT";

const PLACE_TONE: Record<Place, string> = {
  "In Progress": "place-progress",
  TODO: "place-todo",
  WANT: "place-want",
};

function TaskList({
  title,
  tasks,
  empty,
  onComplete,
  completingId,
  tone,
  extra,
  drag,
}: {
  title: string;
  tasks: Task[];
  empty: string;
  onComplete?: (task: Task) => void;
  completingId?: string | null;
  tone: string;
  extra?: ReactNode;
  drag?: {
    overBeforeId: string | null;
    hot: boolean;
    draggingId: string | null;
    onStart: (id: string) => void;
    onEnd: () => void;
    onOver: (beforeId: string | null) => void;
    onDrop: (beforeId: string | null) => void;
  };
}) {
  return (
    <section
      className={`card place-card ${tone}${drag?.hot ? " card-over" : ""}`}
      onDragOver={
        drag
          ? (e) => {
              e.preventDefault();
              drag.onOver(null);
            }
          : undefined
      }
      onDrop={
        drag
          ? (e) => {
              e.preventDefault();
              drag.onDrop(null);
            }
          : undefined
      }
    >
      <header className="place-head">
        <h2 className="section-title">{title}</h2>
        <span className="place-count">{tasks.length}</span>
      </header>
      {drag?.hot && <p className="drop-hint">ここに置く</p>}
      {tasks.length === 0 && !drag?.hot && <p className="muted">{empty}</p>}
      {tasks.map((t) => {
        const p = priorityOf(t);
        const d = domainKey(t);
        return (
          <div
            className={`task${drag ? " task-draggable" : ""}${drag?.overBeforeId === t.id ? " task-over" : ""}${drag?.draggingId === t.id ? " task-lift" : ""}`}
            key={t.id}
            draggable={Boolean(drag)}
            onDragStart={
              drag
                ? (e) => {
                    if ((e.target as HTMLElement).closest("input, label, button")) {
                      e.preventDefault();
                      return;
                    }
                    e.dataTransfer.setData("text/plain", t.id);
                    e.dataTransfer.effectAllowed = "move";
                    drag.onStart(t.id);
                  }
                : undefined
            }
            onDragEnd={drag ? () => drag.onEnd() : undefined}
            onDragOver={
              drag
                ? (e) => {
                    e.preventDefault();
                    e.stopPropagation();
                    drag.onOver(t.id);
                  }
                : undefined
            }
            onDrop={
              drag
                ? (e) => {
                    e.preventDefault();
                    e.stopPropagation();
                    drag.onDrop(t.id);
                  }
                : undefined
            }
          >
            <div className="task-main">
              <div className="task-title">{t.title}</div>
              <div className="muted">
                {d || "—"} {PRIORITY_LABEL[p]}
                {t.due_at ? ` · 期限 ${t.due_at.slice(0, 10)}` : ""}
              </div>
            </div>
            {onComplete && (
              <label className="task-check">
                <input
                  type="checkbox"
                  aria-label="完了"
                  disabled={completingId === t.id}
                  onChange={() => onComplete(t)}
                />
              </label>
            )}
          </div>
        );
      })}
      {extra}
    </section>
  );
}

export function HomePage() {
  const { user } = useAuth();
  const [searchParams, setSearchParams] = useSearchParams();
  const [labels, setLabels] = useState<Domain[]>([]);
  const [inbox, setInbox] = useState<Task[]>([]);
  const [soon, setSoon] = useState<Task[]>([]);
  const [should, setShould] = useState<Task[]>([]);
  const [someday, setSomeday] = useState<Task[]>([]);
  const [weekEvents, setWeekEvents] = useState<CalEvent[]>([]);
  const [today, setToday] = useState("");
  const [timezone, setTimezone] = useState(user?.timezone ?? "Asia/Tokyo");
  const [notice, setNotice] = useState<string | null>(null);
  const [completingId, setCompletingId] = useState<string | null>(null);
  const [draft, setDraft] = useState("");
  const [adding, setAdding] = useState(false);
  const [dragId, setDragId] = useState<string | null>(null);
  const [over, setOver] = useState<{ place: Place; beforeId: string | null } | null>(null);
  const local = import.meta.env.DEV;

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
  const open = useMemo(() => [...inbox, ...should, ...soon], [inbox, should, soon]);
  const inProgress = useMemo(
    () => sortSection(byDomain(open.filter(isInProgress), labels)),
    [open, labels],
  );
  const todo = useMemo(
    () => sortSection(byDomain(open.filter((t) => !isInProgress(t)), labels)),
    [open, labels],
  );

  async function completeTask(task: Task) {
    setCompletingId(task.id);
    setNotice(null);
    try {
      const res = await fetch("/__local/complete", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          source_ref: task.source_ref ?? "",
          title: task.title,
          notes: task.notes ?? "",
        }),
      });
      const body = (await res.json().catch(() => ({}))) as {
        matched?: boolean;
        task_lists?: string[];
        task_files?: string[];
        remote_error?: string | null;
        error?: string;
      };
      if (!res.ok) throw new Error(body.error || "完了できなかった");
      await client.patchTask(task.id, { status: "done" });
      setNotice(body.matched ? "完了" : "完了（task-list には無かった）");
      await loadHome();
    } catch (err) {
      setNotice(err instanceof Error ? err.message : "完了できなかった");
    } finally {
      setCompletingId(null);
    }
  }

  async function addTask() {
    const title = draft.trim();
    const domain = labels.length === 1 ? labels[0] : "";
    if (!title || !domain) return;
    setAdding(true);
    setNotice(null);
    try {
      const res = await fetch("/__local/add", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ title, domain, section: "TODO" }),
      });
      const body = (await res.json().catch(() => ({}))) as {
        matched?: boolean;
        error?: string;
        remote_error?: string | null;
        item?: { title: string; source_ref: string; notes: string; horizon: Horizon };
      };
      if (!res.ok) throw new Error(body.error || "追加できなかった");
      if (!body.matched || !body.item) throw new Error(body.error || "追加できなかった");
      await client.importMdLists([
        {
          title: body.item.title,
          source_ref: body.item.source_ref,
          notes: body.item.notes,
          horizon: body.item.horizon,
        },
      ]);
      setDraft("");
      setNotice(`追加: ${domain}`);
      await loadHome();
    } catch (err) {
      setNotice(err instanceof Error ? err.message : "追加できなかった");
    } finally {
      setAdding(false);
    }
  }

  const want = useMemo(() => sortSection(byDomain(someday, labels)), [someday, labels]);

  function placeDrag(place: Place) {
    if (!local) return undefined;
    return {
      overBeforeId: over?.place === place ? over.beforeId : null,
      hot: over?.place === place && over.beforeId === null && dragId !== null,
      draggingId: dragId,
      onStart: (id: string) => setDragId(id),
      onEnd: () => {
        setDragId(null);
        setOver(null);
      },
      onOver: (beforeId: string | null) => setOver({ place, beforeId }),
      onDrop: (beforeId: string | null) => {
        void dropTask(place, beforeId);
      },
    };
  }

  async function dropTask(place: Place, beforeId: string | null) {
    const task = [...inProgress, ...todo, ...want].find((t) => t.id === dragId);
    setDragId(null);
    setOver(null);
    if (!task || beforeId === task.id) return;
    const lists: Record<Place, Task[]> = { "In Progress": inProgress, TODO: todo, WANT: want };
    const target = lists[place].filter((t) => t.id !== task.id);
    const idx = beforeId ? target.findIndex((t) => t.id === beforeId) : target.length;
    const insertAt = idx < 0 ? target.length : idx;
    const next = [...target.slice(0, insertAt), task, ...target.slice(insertAt)];
    const file = fileOf(task);
    const before = file.endsWith("task-list.md")
      ? next.slice(insertAt + 1).find((t) => fileOf(t) === file)
      : next[insertAt + 1];
    setNotice(null);
    try {
      const res = await fetch("/__local/move", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          source_ref: task.source_ref ?? "",
          title: task.title,
          notes: task.notes ?? "",
          section: place,
          before_title: before?.title ?? "",
        }),
      });
      const body = (await res.json().catch(() => ({}))) as {
        matched?: boolean;
        moved?: boolean;
        error?: string;
        items?: Array<{
          title: string;
          source_ref: string;
          done?: boolean;
          notes: string;
          horizon: Horizon;
        }>;
      };
      if (!res.ok || !body.matched) throw new Error(body.error || "移動できなかった");
      if (body.moved && body.items?.length) {
        await client.importMdLists(body.items);
        await loadHome();
      }
    } catch (err) {
      setNotice(err instanceof Error ? err.message : "移動できなかった");
    }
  }

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

      <div className="filter-bar" role="group" aria-label="フィルター">
        <button
          type="button"
          className={`filter-chip${labels.length === 0 ? " filter-on" : ""}`}
          aria-pressed={labels.length === 0}
          onClick={() => setLabels([])}
        >
          すべて
        </button>
        {DOMAINS.map((d) => {
          const on = labels.includes(d);
          return (
            <button
              key={d}
              type="button"
              className={`filter-chip${on ? " filter-on" : ""}`}
              aria-pressed={on}
              onClick={() =>
                setLabels((cur) => (cur.includes(d) ? cur.filter((x) => x !== d) : [...cur, d]))
              }
            >
              {d}
            </button>
          );
        })}
      </div>

      <TaskList
        title="In Progress"
        tasks={inProgress}
        empty="なし"
        onComplete={local ? completeTask : undefined}
        completingId={completingId}
        tone={PLACE_TONE["In Progress"]}
        drag={placeDrag("In Progress")}
      />

      <TaskList
        title="TODO"
        tasks={todo}
        empty="なし"
        onComplete={local ? completeTask : undefined}
        completingId={completingId}
        tone={PLACE_TONE.TODO}
        drag={placeDrag("TODO")}
        extra={
          local ? (
            labels.length === 1 ? (
              <form
                className="add-row"
                onSubmit={(e) => {
                  e.preventDefault();
                  void addTask();
                }}
              >
                <span className="add-mark" aria-hidden>
                  +
                </span>
                <span className="add-domain">{labels[0]}</span>
                <input
                  value={draft}
                  onChange={(e) => setDraft(e.target.value)}
                  placeholder="TODO に追加"
                  aria-label="TODO に追加"
                  disabled={adding}
                />
              </form>
            ) : (
              <p className="add-hint">ドメインを1つ選ぶと、TODO に追加できる</p>
            )
          ) : undefined
        }
      />

      <TaskList
        title="WANT"
        tasks={want}
        empty="行きたい場所などは md / 取込から"
        onComplete={local ? completeTask : undefined}
        completingId={completingId}
        tone={PLACE_TONE.WANT}
        drag={placeDrag("WANT")}
      />

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
