export type Horizon = "inbox" | "soon" | "should" | "someday";

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
  status: string;
  source: string;
}

export interface Features {
  googleOAuth: boolean;
  githubOAuth: boolean;
  webPush: boolean;
  vapidPublicKey: string | null;
  allowDevLogin: boolean;
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
  home: () =>
    api<{
      soon: Task[];
      should: Task[];
      todayEvents: Array<{ id: string; title: string; start_at: string | null }>;
    }>("/api/home"),
  board: () =>
    api<{
      board: Record<Horizon, Task[]>;
    }>("/api/board"),
  createTask: (input: {
    title: string;
    notes?: string;
    horizon?: Horizon;
    due_at?: string | null;
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
  importGoogleTasks: () =>
    api<{ imported: number; skipped: number }>("/api/import/google-tasks", { method: "POST" }),
  importGoogleCalendar: () =>
    api<{ imported: number; skipped: number }>("/api/import/google-calendar", {
      method: "POST",
    }),
  importGitHub: (number?: number) =>
    api<{ imported: number; skipped: number; project?: string }>(
      "/api/import/github-projects",
      { method: "POST", body: JSON.stringify({ number }) },
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

export const HORIZON_LABEL: Record<Horizon, string> = {
  inbox: "Inbox",
  soon: "直近",
  should: "やるべき",
  someday: "いつか",
};
