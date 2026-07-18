import type { CalEvent, ChatMessage, Horizon, Task, TaskSource, User } from "./types";

export async function getUser(db: D1Database, userId: string): Promise<User | null> {
  return db.prepare("SELECT * FROM users WHERE id = ?").bind(userId).first<User>();
}

export async function createUser(
  db: D1Database,
  input: { id: string; name: string; email?: string | null },
): Promise<User> {
  const created_at = new Date().toISOString();
  await db
    .prepare(
      `INSERT INTO users (id, email, name, digest_time, timezone, created_at)
       VALUES (?, ?, ?, '07:00', 'Asia/Tokyo', ?)`,
    )
    .bind(input.id, input.email ?? null, input.name, created_at)
    .run();
  return (await getUser(db, input.id))!;
}

export async function updateUserSettings(
  db: D1Database,
  userId: string,
  patch: { digest_time?: string; timezone?: string; name?: string },
): Promise<User | null> {
  const user = await getUser(db, userId);
  if (!user) return null;
  const digest_time = patch.digest_time ?? user.digest_time;
  const timezone = patch.timezone ?? user.timezone;
  const name = patch.name ?? user.name;
  await db
    .prepare(`UPDATE users SET digest_time = ?, timezone = ?, name = ? WHERE id = ?`)
    .bind(digest_time, timezone, name, userId)
    .run();
  return getUser(db, userId);
}

export async function listTasks(
  db: D1Database,
  userId: string,
  opts: { horizon?: Horizon; status?: string } = {},
): Promise<Task[]> {
  const clauses = ["user_id = ?"];
  const binds: string[] = [userId];
  if (opts.horizon) {
    clauses.push("horizon = ?");
    binds.push(opts.horizon);
  }
  if (opts.status) {
    clauses.push("status = ?");
    binds.push(opts.status);
  } else {
    clauses.push("status = 'open'");
  }
  const sql = `SELECT * FROM tasks WHERE ${clauses.join(" AND ")}
    ORDER BY CASE WHEN due_at IS NULL THEN 1 ELSE 0 END, due_at ASC, updated_at DESC`;
  const res = await db
    .prepare(sql)
    .bind(...binds)
    .all<Task>();
  return res.results ?? [];
}

export async function getTask(db: D1Database, userId: string, taskId: string): Promise<Task | null> {
  return db
    .prepare("SELECT * FROM tasks WHERE id = ? AND user_id = ?")
    .bind(taskId, userId)
    .first<Task>();
}

export async function createTask(
  db: D1Database,
  input: {
    id: string;
    user_id: string;
    title: string;
    notes?: string | null;
    horizon?: Horizon;
    due_at?: string | null;
    source?: TaskSource;
    source_ref?: string | null;
  },
): Promise<Task> {
  const ts = new Date().toISOString();
  await db
    .prepare(
      `INSERT INTO tasks
        (id, user_id, title, notes, horizon, due_at, status, source, source_ref, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, 'open', ?, ?, ?, ?)`,
    )
    .bind(
      input.id,
      input.user_id,
      input.title,
      input.notes ?? null,
      input.horizon ?? "inbox",
      input.due_at ?? null,
      input.source ?? "manual",
      input.source_ref ?? null,
      ts,
      ts,
    )
    .run();
  return (await getTask(db, input.user_id, input.id))!;
}

export async function updateTask(
  db: D1Database,
  userId: string,
  taskId: string,
  patch: Partial<Pick<Task, "title" | "notes" | "horizon" | "due_at" | "status">>,
): Promise<Task | null> {
  const existing = await getTask(db, userId, taskId);
  if (!existing) return null;
  const next = {
    title: patch.title ?? existing.title,
    notes: patch.notes !== undefined ? patch.notes : existing.notes,
    horizon: patch.horizon ?? existing.horizon,
    due_at: patch.due_at !== undefined ? patch.due_at : existing.due_at,
    status: patch.status ?? existing.status,
  };
  const updated_at = new Date().toISOString();
  await db
    .prepare(
      `UPDATE tasks SET title = ?, notes = ?, horizon = ?, due_at = ?, status = ?, updated_at = ?
       WHERE id = ? AND user_id = ?`,
    )
    .bind(next.title, next.notes, next.horizon, next.due_at, next.status, updated_at, taskId, userId)
    .run();
  return getTask(db, userId, taskId);
}

export async function findTaskBySource(
  db: D1Database,
  userId: string,
  source: TaskSource,
  sourceRef: string,
): Promise<Task | null> {
  return db
    .prepare("SELECT * FROM tasks WHERE user_id = ? AND source = ? AND source_ref = ?")
    .bind(userId, source, sourceRef)
    .first<Task>();
}

export async function upsertEvent(
  db: D1Database,
  input: {
    id: string;
    user_id: string;
    title: string;
    start_at?: string | null;
    end_at?: string | null;
    source_ref?: string | null;
  },
): Promise<void> {
  const existing = input.source_ref
    ? await db
        .prepare("SELECT id FROM events WHERE user_id = ? AND source_ref = ?")
        .bind(input.user_id, input.source_ref)
        .first<{ id: string }>()
    : null;
  if (existing) {
    await db
      .prepare(
        `UPDATE events SET title = ?, start_at = ?, end_at = ? WHERE id = ? AND user_id = ?`,
      )
      .bind(input.title, input.start_at ?? null, input.end_at ?? null, existing.id, input.user_id)
      .run();
    return;
  }
  await db
    .prepare(
      `INSERT INTO events (id, user_id, title, start_at, end_at, source_ref, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?)`,
    )
    .bind(
      input.id,
      input.user_id,
      input.title,
      input.start_at ?? null,
      input.end_at ?? null,
      input.source_ref ?? null,
      new Date().toISOString(),
    )
    .run();
}

export async function listEvents(db: D1Database, userId: string): Promise<CalEvent[]> {
  const res = await db
    .prepare(`SELECT * FROM events WHERE user_id = ? ORDER BY start_at ASC`)
    .bind(userId)
    .all<CalEvent>();
  return res.results ?? [];
}

export async function listChat(db: D1Database, userId: string, limit = 40): Promise<ChatMessage[]> {
  const res = await db
    .prepare(
      `SELECT * FROM chat_messages WHERE user_id = ? ORDER BY created_at DESC LIMIT ?`,
    )
    .bind(userId, limit)
    .all<ChatMessage>();
  return (res.results ?? []).reverse();
}

export async function addChat(
  db: D1Database,
  input: { id: string; user_id: string; role: "user" | "assistant"; content: string },
): Promise<void> {
  await db
    .prepare(
      `INSERT INTO chat_messages (id, user_id, role, content, created_at) VALUES (?, ?, ?, ?, ?)`,
    )
    .bind(input.id, input.user_id, input.role, input.content, new Date().toISOString())
    .run();
}

export async function upsertOauthToken(
  db: D1Database,
  input: {
    id: string;
    user_id: string;
    provider: string;
    access_token: string;
    refresh_token?: string | null;
    expires_at?: string | null;
    scopes?: string | null;
  },
): Promise<void> {
  await db
    .prepare(
      `INSERT INTO oauth_tokens (id, user_id, provider, access_token, refresh_token, expires_at, scopes)
       VALUES (?, ?, ?, ?, ?, ?, ?)
       ON CONFLICT(user_id, provider) DO UPDATE SET
         access_token = excluded.access_token,
         refresh_token = COALESCE(excluded.refresh_token, oauth_tokens.refresh_token),
         expires_at = excluded.expires_at,
         scopes = excluded.scopes`,
    )
    .bind(
      input.id,
      input.user_id,
      input.provider,
      input.access_token,
      input.refresh_token ?? null,
      input.expires_at ?? null,
      input.scopes ?? null,
    )
    .run();
}

export async function getOauthToken(
  db: D1Database,
  userId: string,
  provider: string,
): Promise<{ access_token: string; refresh_token: string | null; expires_at: string | null } | null> {
  return db
    .prepare(
      `SELECT access_token, refresh_token, expires_at FROM oauth_tokens WHERE user_id = ? AND provider = ?`,
    )
    .bind(userId, provider)
    .first();
}

export async function listUsersForDigest(db: D1Database): Promise<User[]> {
  const res = await db.prepare(`SELECT * FROM users`).all<User>();
  return res.results ?? [];
}

export async function listPushSubs(
  db: D1Database,
  userId: string,
): Promise<Array<{ id: string; endpoint: string; p256dh: string; auth: string }>> {
  const res = await db
    .prepare(`SELECT id, endpoint, p256dh, auth FROM push_subscriptions WHERE user_id = ?`)
    .bind(userId)
    .all<{ id: string; endpoint: string; p256dh: string; auth: string }>();
  return res.results ?? [];
}

export async function savePushSub(
  db: D1Database,
  input: { id: string; user_id: string; endpoint: string; p256dh: string; auth: string },
): Promise<void> {
  await db
    .prepare(
      `INSERT INTO push_subscriptions (id, user_id, endpoint, p256dh, auth, created_at)
       VALUES (?, ?, ?, ?, ?, ?)
       ON CONFLICT(endpoint) DO UPDATE SET
         user_id = excluded.user_id,
         p256dh = excluded.p256dh,
         auth = excluded.auth`,
    )
    .bind(
      input.id,
      input.user_id,
      input.endpoint,
      input.p256dh,
      input.auth,
      new Date().toISOString(),
    )
    .run();
}

export async function deletePushSub(db: D1Database, userId: string, endpoint: string): Promise<void> {
  await db
    .prepare(`DELETE FROM push_subscriptions WHERE user_id = ? AND endpoint = ?`)
    .bind(userId, endpoint)
    .run();
}
