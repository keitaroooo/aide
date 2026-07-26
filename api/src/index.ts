import { handleAuth } from "./auth/routes";
import { requireUser } from "./auth/session";
import { deletePushSub, listChat, savePushSub } from "./db";
import {
  importGitHubProjects,
  importGoogleCalendar,
  importGoogleTasks,
  importMdLists,
  type MdListItem,
} from "./import";
import { runDigestCron } from "./push/webpush";
import { handleTasks } from "./routes/tasks";
import { runSecretary } from "./secretary";
import type { Env } from "./types";
import { error, id, json } from "./types";

function corsHeaders(req: Request, env: Env): HeadersInit {
  const origin = req.headers.get("Origin") || env.APP_URL;
  const allowed = new Set([
    env.APP_URL.replace(/\/$/, ""),
    "http://127.0.0.1:5180",
    "http://localhost:5180",
    "http://127.0.0.1:5173",
    "http://localhost:5173",
  ]);
  const allow = allowed.has(origin.replace(/\/$/, "")) ? origin : env.APP_URL;
  return {
    "Access-Control-Allow-Origin": allow,
    "Access-Control-Allow-Credentials": "true",
    "Access-Control-Allow-Headers": "content-type",
    "Access-Control-Allow-Methods": "GET,POST,PATCH,DELETE,OPTIONS",
  };
}

function withCors(res: Response, req: Request, env: Env): Response {
  const headers = new Headers(res.headers);
  for (const [k, v] of Object.entries(corsHeaders(req, env))) headers.set(k, v);
  return new Response(res.body, { status: res.status, statusText: res.statusText, headers });
}

async function route(req: Request, env: Env): Promise<Response> {
  const url = new URL(req.url);
  const path = url.pathname;

  if (req.method === "OPTIONS") {
    return new Response(null, { status: 204, headers: corsHeaders(req, env) });
  }

  const authRes = await handleAuth(req, env, path);
  if (authRes) return authRes;

  const taskRes = await handleTasks(req, env, path);
  if (taskRes) return taskRes;

  if (path === "/api/chat" && req.method === "GET") {
    const user = await requireUser(env, req);
    if (user instanceof Response) return user;
    const messages = await listChat(env.DB, user.id, 50);
    return json({ messages });
  }

  if (path === "/api/chat" && req.method === "POST") {
    const user = await requireUser(env, req);
    if (user instanceof Response) return user;
    const body = (await req.json()) as { message?: string };
    if (!body.message?.trim()) return error("message required");
    const result = await runSecretary(env, user, body.message.trim());
    return json(result);
  }

  if (path === "/api/import/google-tasks" && req.method === "POST") {
    const user = await requireUser(env, req);
    if (user instanceof Response) return user;
    try {
      const result = await importGoogleTasks(env, user);
      return json(result);
    } catch (e) {
      return error(e instanceof Error ? e.message : "import failed", 400);
    }
  }

  if (path === "/api/import/google-calendar" && req.method === "POST") {
    const user = await requireUser(env, req);
    if (user instanceof Response) return user;
    try {
      const result = await importGoogleCalendar(env, user);
      return json(result);
    } catch (e) {
      return error(e instanceof Error ? e.message : "import failed", 400);
    }
  }

  if (path === "/api/import/github-projects" && req.method === "POST") {
    const user = await requireUser(env, req);
    if (user instanceof Response) return user;
    const body = (await req.json().catch(() => ({}))) as { owner?: string; number?: number };
    try {
      const result = await importGitHubProjects(env, user, body);
      return json(result);
    } catch (e) {
      return error(e instanceof Error ? e.message : "import failed", 400);
    }
  }

  if (path === "/api/import/md-lists" && req.method === "POST") {
    const user = await requireUser(env, req);
    if (user instanceof Response) return user;
    const body = (await req.json().catch(() => ({}))) as { items?: MdListItem[] };
    if (!Array.isArray(body.items) || body.items.length === 0) {
      return error("items must be a non-empty array");
    }
    try {
      const result = await importMdLists(env, user, body.items);
      return json(result);
    } catch (e) {
      return error(e instanceof Error ? e.message : "import failed", 400);
    }
  }

  if (path === "/api/push/subscribe" && req.method === "POST") {
    const user = await requireUser(env, req);
    if (user instanceof Response) return user;
    const body = (await req.json()) as {
      endpoint?: string;
      keys?: { p256dh?: string; auth?: string };
    };
    if (!body.endpoint || !body.keys?.p256dh || !body.keys?.auth) {
      return error("invalid subscription");
    }
    await savePushSub(env.DB, {
      id: id(),
      user_id: user.id,
      endpoint: body.endpoint,
      p256dh: body.keys.p256dh,
      auth: body.keys.auth,
    });
    return json({ ok: true });
  }

  if (path === "/api/push/unsubscribe" && req.method === "POST") {
    const user = await requireUser(env, req);
    if (user instanceof Response) return user;
    const body = (await req.json()) as { endpoint?: string };
    if (!body.endpoint) return error("endpoint required");
    await deletePushSub(env.DB, user.id, body.endpoint);
    return json({ ok: true });
  }

  if (path === "/api/push/test" && req.method === "POST") {
    const user = await requireUser(env, req);
    if (user instanceof Response) return user;
    const { buildDigest, sendPush } = await import("./push/webpush");
    const { listPushSubs } = await import("./db");
    const body = await buildDigest(env, user);
    const subs = await listPushSubs(env.DB, user.id);
    let sent = 0;
    for (const sub of subs) {
      if (await sendPush(env, sub, { title: "Aide — テスト", body, url: "/" })) sent++;
    }
    return json({ sent, body });
  }

  if (path === "/api/health") {
    return json({ ok: true });
  }

  return error("not found", 404);
}

export default {
  async fetch(req: Request, env: Env): Promise<Response> {
    try {
      const res = await route(req, env);
      return withCors(res, req, env);
    } catch (e) {
      console.error(e);
      return withCors(
        error(e instanceof Error ? e.message : "internal error", 500),
        req,
        env,
      );
    }
  },

  async scheduled(_event: ScheduledEvent, env: Env, ctx: ExecutionContext): Promise<void> {
    ctx.waitUntil(
      runDigestCron(env).then((r) => console.log("digest", r)).catch((e) => console.error(e)),
    );
  },
};
