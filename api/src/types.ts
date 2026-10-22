export type Horizon = "inbox" | "soon" | "should" | "someday";
export type TaskStatus = "open" | "done";
export type TaskSource = "manual" | "google_cal" | "google_tasks" | "github" | "md_list";
/** GitHub label 相当。TODO / WANT のフィルタ用 */
export const DOMAINS = ["assets", "engineering", "health", "self", "trip"] as const;
export type Domain = (typeof DOMAINS)[number];

export interface Env {
  DB: D1Database;
  AI?: Ai;
  SESSION_SECRET: string;
  APP_URL: string;
  ALLOW_DEV_LOGIN?: string;
  OWNER_EMAIL?: string;
  AUTOMATION_TOKEN?: string;
  VAPID_PUBLIC_KEY?: string;
  VAPID_PRIVATE_KEY?: string;
  VAPID_SUBJECT?: string;
  OPENAI_API_KEY?: string;
  OPENAI_BASE_URL?: string;
}

export interface User {
  id: string;
  email: string | null;
  name: string;
  digest_time: string;
  timezone: string;
  created_at: string;
}

export interface Task {
  id: string;
  user_id: string;
  title: string;
  notes: string | null;
  horizon: Horizon;
  due_at: string | null;
  /** 0=低 1=中 2=高（ユーザー指定。AI は勝手に付けない） */
  priority: number;
  /** assets / engineering / …。null は未分類 */
  domain: Domain | null;
  status: TaskStatus;
  source: TaskSource;
  source_ref: string | null;
  created_at: string;
  updated_at: string;
}

export interface CalEvent {
  id: string;
  user_id: string;
  title: string;
  start_at: string | null;
  end_at: string | null;
  source_ref: string | null;
  created_at: string;
}

export interface ChatMessage {
  id: string;
  user_id: string;
  role: "user" | "assistant";
  content: string;
  created_at: string;
}

export const HORIZONS: Horizon[] = ["inbox", "soon", "should", "someday"];

export function isHorizon(v: string): v is Horizon {
  return (HORIZONS as string[]).includes(v);
}

export function isDomain(v: string): v is Domain {
  return (DOMAINS as readonly string[]).includes(v);
}

/** notes の `domain=engineering` からも読む（md 取込互換） */
export function resolveDomain(
  domain?: string | null,
  notes?: string | null,
): Domain | null {
  if (domain && isDomain(domain)) return domain;
  const m = notes?.match(/(?:^|\s)domain=([a-z]+)/i);
  if (m && isDomain(m[1].toLowerCase())) return m[1].toLowerCase() as Domain;
  return null;
}

export function json(data: unknown, status = 200, headers: HeadersInit = {}): Response {
  return new Response(JSON.stringify(data), {
    status,
    headers: {
      "content-type": "application/json; charset=utf-8",
      ...headers,
    },
  });
}

export function error(message: string, status = 400): Response {
  return json({ error: message }, status);
}

export function nowIso(): string {
  return new Date().toISOString();
}

export function id(): string {
  return crypto.randomUUID();
}
