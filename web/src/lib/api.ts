export type Horizon = "inbox" | "soon" | "should" | "someday";
export const DOMAINS = ["assets", "engineering", "health", "self", "trip"] as const;
export type Domain = (typeof DOMAINS)[number];

export interface User {
  id: string;
  email: string | null;
  name: string;
  digest_time: string;
  timezone: string;
}

export interface Task {
  id: string;
  title: string;
  notes: string | null;
  horizon: Horizon;
  due_at: string | null;
  /** 0=低 1=中 2=高 */
  priority?: number;
  domain?: Domain | null;
  status: string;
  source: string;
  source_ref?: string | null;
}

export const PRIORITY_LABEL = ["低", "中", "高"] as const;

export function domainOf(t: Task): Domain | null {
  if (t.domain && (DOMAINS as readonly string[]).includes(t.domain)) return t.domain;
  const m = t.notes?.match(/(?:^|\s)domain=([a-z]+)/i);
  const d = m?.[1]?.toLowerCase();
  if (d && (DOMAINS as readonly string[]).includes(d)) return d as Domain;
  return null;
}

export interface Features {
  googleOAuth: boolean;
  githubOAuth: boolean;
  webPush: boolean;
  vapidPublicKey: string | null;
  allowDevLogin: boolean;
  /** Access OTP 済み（本番スマホ）。Google なしで入れる */
  accessLogin?: boolean;
}

async function api<T>(path: string, init?: RequestInit): Promise<T> {
  const res = await fetch(path, {
    ...init,
    credentials: "include",
    headers: {
      "content-type": "application/json",
      ...(init?.headers ?? {}),
    },
  });
  const data = (await res.json().catch(() => ({}))) as T & { error?: string };
  if (!res.ok) throw new Error(data.error || res.statusText);
  return data;
}

export const client = {
  me: () =>
    api<{
      user: User | null;
      links?: { google: boolean; github: boolean };
      features?: Features;
    }>("/api/auth/me"),
  devLogin: (name: string) =>
    api<{ user: User }>("/api/auth/dev-login", {
      method: "POST",
      body: JSON.stringify({ name }),
    }),
  logout: () => api<{ ok: boolean }>("/api/auth/logout", { method: "POST" }),
  accessLogin: () =>
    api<{ user: User }>("/api/auth/access-login", { method: "POST" }),
  ownerLogin: (email: string) =>
    api<{ user: User }>("/api/auth/owner-login", {
      method: "POST",
      body: JSON.stringify({ email }),
    }),
  home: () =>
    api<{
      inbox: Task[];
      soon: Task[];
      should: Task[];
      someday: Task[];
      todayEvents: Array<{ id: string; title: string; start_at: string | null; day?: string }>;
      weekEvents: Array<{ id: string; title: string; start_at: string | null; day?: string }>;
      timezone: string;
      today: string;
    }>("/api/home"),
  createTask: (input: {
    title: string;
    notes?: string;
    horizon?: Horizon;
    due_at?: string | null;
    domain?: Domain | null;
  }) => api<{ task: Task }>("/api/tasks", { method: "POST", body: JSON.stringify(input) }),
  patchTask: (id: string, patch: Partial<Task>) =>
    api<{ task: Task }>(`/api/tasks/${id}`, { method: "PATCH", body: JSON.stringify(patch) }),
  chat: (message: string) =>
    api<{ reply: string; used: string }>("/api/chat", {
      method: "POST",
      body: JSON.stringify({ message }),
    }),
  chatHistory: () =>
    api<{ messages: Array<{ id: string; role: "user" | "assistant"; content: string }> }>(
      "/api/chat",
    ),
  settings: (patch: { digest_time?: string; timezone?: string; name?: string }) =>
    api<{ user: User }>("/api/settings", { method: "PATCH", body: JSON.stringify(patch) }),
  importMdLists: (
    items: Array<{
      title: string;
      source_ref: string;
      done?: boolean;
      notes?: string | null;
      horizon?: "someday" | "soon" | "should" | "inbox";
    }>,
  ) =>
    api<{ imported: number; updated: number; skipped: number; completed: number }>(
      "/api/import/md-lists",
      { method: "POST", body: JSON.stringify({ items }) },
    ),
  pushSubscribe: (sub: PushSubscriptionJSON) =>
    api<{ ok: boolean }>("/api/push/subscribe", {
      method: "POST",
      body: JSON.stringify(sub),
    }),
  pushTest: () => api<{ sent: number; body: string }>("/api/push/test", { method: "POST" }),
  eventToTask: (eventId: string) =>
    api<{ task: Task }>(`/api/events/${eventId}/to-task`, { method: "POST" }),
};
