import { createTask, listEvents, listTasks, updateTask, updateUserSettings } from "../db";
import type { Env, Horizon } from "../types";
import { error, id, isHorizon, json } from "../types";
import { requireUser } from "../auth/session";

/** Calendar date YYYY-MM-DD in a timezone. */
function ymdInTz(date: Date, timeZone: string): string {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(date);
}

/** Day key for an event start (date-only or datetime ISO). */
function eventDay(startAt: string, timeZone: string): string {
  if (/^\d{4}-\d{2}-\d{2}$/.test(startAt)) return startAt;
  const d = new Date(startAt);
  if (Number.isNaN(d.getTime())) return startAt.slice(0, 10);
  return ymdInTz(d, timeZone);
}

export async function handleTasks(req: Request, env: Env, path: string): Promise<Response | null> {
  if (path === "/api/tasks" && req.method === "GET") {
    const user = await requireUser(env, req);
    if (user instanceof Response) return user;
    const url = new URL(req.url);
    const horizon = url.searchParams.get("horizon");
    const status = url.searchParams.get("status") ?? undefined;
    const tasks = await listTasks(env.DB, user.id, {
      horizon: horizon && isHorizon(horizon) ? horizon : undefined,
      status,
    });
    return json({ tasks });
  }

  if (path === "/api/tasks" && req.method === "POST") {
    const user = await requireUser(env, req);
    if (user instanceof Response) return user;
    const body = (await req.json()) as {
      title?: string;
      notes?: string;
      horizon?: string;
      due_at?: string | null;
    };
    if (!body.title?.trim()) return error("title required");
    const horizon: Horizon =
      body.horizon && isHorizon(body.horizon) ? body.horizon : "inbox";
    const task = await createTask(env.DB, {
      id: id(),
      user_id: user.id,
      title: body.title.trim(),
      notes: body.notes ?? null,
      horizon,
      due_at: body.due_at ?? null,
    });
    return json({ task }, 201);
  }

  const taskMatch = path.match(/^\/api\/tasks\/([^/]+)$/);
  if (taskMatch && req.method === "PATCH") {
    const user = await requireUser(env, req);
    if (user instanceof Response) return user;
    const taskId = taskMatch[1];
    const body = (await req.json()) as {
      title?: string;
      notes?: string | null;
      horizon?: string;
      due_at?: string | null;
      status?: "open" | "done";
    };
    if (body.horizon && !isHorizon(body.horizon)) return error("invalid horizon");
    const task = await updateTask(env.DB, user.id, taskId, {
      title: body.title,
      notes: body.notes,
      horizon: body.horizon as Horizon | undefined,
      due_at: body.due_at,
      status: body.status,
    });
    if (!task) return error("not found", 404);
    return json({ task });
  }

  if (taskMatch && req.method === "DELETE") {
    const user = await requireUser(env, req);
    if (user instanceof Response) return user;
    const task = await updateTask(env.DB, user.id, taskMatch[1], { status: "done" });
    if (!task) return error("not found", 404);
    return json({ task });
  }

  if (path === "/api/home" && req.method === "GET") {
    const user = await requireUser(env, req);
    if (user instanceof Response) return user;
    const [soon, should, events] = await Promise.all([
      listTasks(env.DB, user.id, { horizon: "soon" }),
      listTasks(env.DB, user.id, { horizon: "should" }),
      listEvents(env.DB, user.id),
    ]);
    const tz = user.timezone || "Asia/Tokyo";
    const today = ymdInTz(new Date(), tz);
    const weekEnd = ymdInTz(new Date(Date.now() + 6 * 24 * 60 * 60 * 1000), tz);
    const dueToday = should.filter((t) => t.due_at && eventDay(t.due_at, tz) <= today);
    const dated = events
      .filter((e) => e.start_at)
      .map((e) => ({ ...e, day: eventDay(e.start_at!, tz) }))
      .filter((e) => e.day >= today && e.day <= weekEnd)
      .sort((a, b) => (a.start_at! < b.start_at! ? -1 : a.start_at! > b.start_at! ? 1 : 0));
    const todayEvents = dated.filter((e) => e.day === today);
    const weekEvents = dated;
    return json({
      soon,
      should: dueToday.length ? dueToday : should.slice(0, 8),
      todayEvents,
      weekEvents,
      timezone: tz,
      today,
    });
  }

  if (path === "/api/board" && req.method === "GET") {
    const user = await requireUser(env, req);
    if (user instanceof Response) return user;
    const tasks = await listTasks(env.DB, user.id);
    const board = {
      inbox: tasks.filter((t) => t.horizon === "inbox"),
      soon: tasks.filter((t) => t.horizon === "soon"),
      should: tasks.filter((t) => t.horizon === "should"),
      someday: tasks.filter((t) => t.horizon === "someday"),
    };
    return json({ board });
  }

  if (path === "/api/settings" && req.method === "PATCH") {
    const user = await requireUser(env, req);
    if (user instanceof Response) return user;
    const body = (await req.json()) as {
      digest_time?: string;
      timezone?: string;
      name?: string;
    };
    if (body.digest_time && !/^\d{2}:\d{2}$/.test(body.digest_time)) {
      return error("digest_time must be HH:MM");
    }
    const updated = await updateUserSettings(env.DB, user.id, body);
    return json({ user: updated });
  }

  // Convert calendar event to task
  const evMatch = path.match(/^\/api\/events\/([^/]+)\/to-task$/);
  if (evMatch && req.method === "POST") {
    const user = await requireUser(env, req);
    if (user instanceof Response) return user;
    const ev = await env.DB.prepare(`SELECT * FROM events WHERE id = ? AND user_id = ?`)
      .bind(evMatch[1], user.id)
      .first<{ id: string; title: string; start_at: string | null; source_ref: string | null }>();
    if (!ev) return error("not found", 404);
    const task = await createTask(env.DB, {
      id: id(),
      user_id: user.id,
      title: ev.title,
      horizon: "should",
      due_at: ev.start_at,
      source: "google_cal",
      source_ref: ev.source_ref,
    });
    return json({ task }, 201);
  }

  if (path === "/api/events" && req.method === "GET") {
    const user = await requireUser(env, req);
    if (user instanceof Response) return user;
    const events = await listEvents(env.DB, user.id);
    return json({ events });
  }

  return null;
}
