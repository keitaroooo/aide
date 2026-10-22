import { createUser, getUser, getUserByEmail, updateUserSettings } from "../db";
import type { Env, User } from "../types";
import { id, nowIso } from "../types";

/** Access 通過後にだけ付く。Origin 直叩きでは信用しない（API は Access 背後前提）。 */
export function accessAuthenticatedEmail(request: Request): string | null {
  const email = request.headers.get("Cf-Access-Authenticated-User-Email");
  return email?.trim().toLowerCase() || null;
}

const DEV_USER_ID = "dev:local";

const COOKIE = "aide_session";
const SESSION_DAYS = 30;
const AUTOMATION_HEADER = "X-Aide-Automation-Token";

export function cookieHeader(sessionId: string, maxAgeSec: number): string {
  const secure = true;
  return `${COOKIE}=${sessionId}; Path=/; HttpOnly; SameSite=Lax; Max-Age=${maxAgeSec}${secure ? "; Secure" : ""}`;
}

/** Local http://127.0.0.1 may reject Secure cookies — omit Secure for localhost. */
export function setSessionCookie(sessionId: string, requestUrl: string): string {
  const maxAge = SESSION_DAYS * 24 * 60 * 60;
  const host = new URL(requestUrl).hostname;
  const isLocal = host === "127.0.0.1" || host === "localhost";
  return `${COOKIE}=${sessionId}; Path=/; HttpOnly; SameSite=Lax; Max-Age=${maxAge}${isLocal ? "" : "; Secure"}`;
}

export function clearSessionCookie(requestUrl: string): string {
  const host = new URL(requestUrl).hostname;
  const isLocal = host === "127.0.0.1" || host === "localhost";
  return `${COOKIE}=; Path=/; HttpOnly; SameSite=Lax; Max-Age=0${isLocal ? "" : "; Secure"}`;
}

export function readSessionId(request: Request): string | null {
  const raw = request.headers.get("Cookie") ?? "";
  const match = raw.match(new RegExp(`(?:^|;\\s*)${COOKIE}=([^;]+)`));
  return match?.[1] ?? null;
}

export async function createSession(env: Env, userId: string): Promise<string> {
  const sessionId = id();
  const expires = new Date(Date.now() + SESSION_DAYS * 24 * 60 * 60 * 1000).toISOString();
  await env.DB.prepare(
    `INSERT INTO sessions (id, user_id, expires_at, created_at) VALUES (?, ?, ?, ?)`,
  )
    .bind(sessionId, userId, expires, nowIso())
    .run();
  return sessionId;
}

export async function destroySession(env: Env, sessionId: string): Promise<void> {
  await env.DB.prepare(`DELETE FROM sessions WHERE id = ?`).bind(sessionId).run();
}

function constantTimeEqual(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}

/** Cookie を持てない取込スクリプト用。オーナーとして扱うので Access の内側でのみ使う。 */
async function automationUser(env: Env, request: Request): Promise<User | null> {
  const token = request.headers.get(AUTOMATION_HEADER);
  if (!token || !env.AUTOMATION_TOKEN || !env.OWNER_EMAIL) return null;
  if (!constantTimeEqual(token, env.AUTOMATION_TOKEN)) return null;
  const row = await env.DB.prepare(`SELECT id FROM users WHERE email = ? LIMIT 1`)
    .bind(env.OWNER_EMAIL)
    .first<{ id: string }>();
  if (!row) return null;
  return getUser(env.DB, row.id);
}

export async function requireUser(env: Env, request: Request): Promise<User | Response> {
  const automation = await automationUser(env, request);
  if (automation) return automation;

  const sessionId = readSessionId(request);
  if (!sessionId) return new Response(JSON.stringify({ error: "unauthorized" }), { status: 401 });
  const row = await env.DB.prepare(
    `SELECT user_id, expires_at FROM sessions WHERE id = ?`,
  )
    .bind(sessionId)
    .first<{ user_id: string; expires_at: string }>();
  if (!row || row.expires_at < nowIso()) {
    if (sessionId) await destroySession(env, sessionId);
    return new Response(JSON.stringify({ error: "unauthorized" }), { status: 401 });
  }
  const user = await getUser(env.DB, row.user_id);
  if (!user) {
    return new Response(JSON.stringify({ error: "unauthorized" }), { status: 401 });
  }
  return user;
}

/** 個人用の1ユーザー。ローカルの dev:local に入った行はここへ寄せる。 */
export async function ensureOwner(env: Env): Promise<User | null> {
  const email = env.OWNER_EMAIL?.trim();
  if (!email) return null;
  let user = await getUserByEmail(env.DB, email);
  if (!user) {
    user = await createUser(env.DB, {
      id: `owner:${email.toLowerCase()}`,
      name: email.split("@")[0] || "Owner",
      email,
    });
  }
  for (const table of ["tasks", "events", "chat_messages", "push_subscriptions"] as const) {
    await env.DB.prepare(`UPDATE ${table} SET user_id = ? WHERE user_id = ?`)
      .bind(user.id, DEV_USER_ID)
      .run();
  }
  return user;
}

/** Stable single user for ALLOW_DEV_LOGIN — session is reissued, user is reused. */
export async function createDevUser(env: Env, name: string): Promise<User> {
  const existing = await getUser(env.DB, DEV_USER_ID);
  if (existing) {
    if (name && name !== existing.name) {
      return (await updateUserSettings(env.DB, DEV_USER_ID, { name })) ?? existing;
    }
    return existing;
  }
  return createUser(env.DB, { id: DEV_USER_ID, name, email: "dev@local" });
}
