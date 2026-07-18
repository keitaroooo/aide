import { createUser, getUser } from "../db";
import type { Env, User } from "../types";
import { id, nowIso } from "../types";

const COOKIE = "aide_session";
const SESSION_DAYS = 30;

async function hmacSign(secret: string, value: string): Promise<string> {
  const key = await crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(secret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"],
  );
  const sig = await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(value));
  return btoa(String.fromCharCode(...new Uint8Array(sig)));
}

async function hmacVerify(secret: string, value: string, signature: string): Promise<boolean> {
  const expected = await hmacSign(secret, value);
  return expected === signature;
}

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

export async function requireUser(env: Env, request: Request): Promise<User | Response> {
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

export async function findOrCreateOAuthUser(
  env: Env,
  input: { provider: string; providerUserId: string; email?: string | null; name: string },
): Promise<User> {
  const stableId = `${input.provider}:${input.providerUserId}`;
  const existing = await getUser(env.DB, stableId);
  if (existing) return existing;
  return createUser(env.DB, {
    id: stableId,
    name: input.name,
    email: input.email ?? null,
  });
}

export async function createDevUser(env: Env, name: string): Promise<User> {
  return createUser(env.DB, { id: `dev:${id()}`, name, email: null });
}

/** Signed state for OAuth CSRF. */
export async function makeOAuthState(env: Env, payload: Record<string, string>): Promise<string> {
  const body = btoa(JSON.stringify(payload));
  const sig = await hmacSign(env.SESSION_SECRET, body);
  return `${body}.${sig}`;
}

export async function parseOAuthState(
  env: Env,
  state: string,
): Promise<Record<string, string> | null> {
  const [body, sig] = state.split(".");
  if (!body || !sig) return null;
  if (!(await hmacVerify(env.SESSION_SECRET, body, sig))) return null;
  try {
    return JSON.parse(atob(body)) as Record<string, string>;
  } catch {
    return null;
  }
}
