export type Horizon = "inbox" | "soon" | "should" | "someday";
export type TaskStatus = "open" | "done";
export type TaskSource = "manual" | "google_cal" | "google_tasks" | "github" | "md_list";

export interface Env {
  DB: D1Database;
  AI?: Ai;
  SESSION_SECRET: string;
  APP_URL: string;
  ALLOW_DEV_LOGIN?: string;
  GOOGLE_CLIENT_ID?: string;
  GOOGLE_CLIENT_SECRET?: string;
  GITHUB_CLIENT_ID?: string;
  GITHUB_CLIENT_SECRET?: string;
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
