import type { Env } from "../types";
import { error, json } from "../types";
import {
  accessAuthenticatedEmail,
  clearSessionCookie,
  createDevUser,
  createSession,
  ensureOwner,
  destroySession,
  readSessionId,
  requireUser,
  setSessionCookie,
} from "./session";

export async function handleAuth(req: Request, env: Env, path: string): Promise<Response | null> {
  if (path === "/api/auth/me" && req.method === "GET") {
    const accessEmail = accessAuthenticatedEmail(req);
    const accessLogin = !!(
      accessEmail &&
      env.OWNER_EMAIL &&
      accessEmail === env.OWNER_EMAIL.toLowerCase()
    );
    const features = {
      // アプリ内 OAuth は廃止。取込は CLI（手元トークン）
      googleOAuth: false,
      githubOAuth: false,
      webPush: !!(env.VAPID_PUBLIC_KEY && env.VAPID_PRIVATE_KEY),
      vapidPublicKey: env.VAPID_PUBLIC_KEY ?? null,
      allowDevLogin: env.ALLOW_DEV_LOGIN === "true",
      accessLogin,
    };
    const user = await requireUser(env, req);
    if (user instanceof Response) {
      return json({ user: null, links: { google: false, github: false }, features });
    }
    return json({
      user,
      links: { google: false, github: false },
      features,
    });
  }

  if (path === "/api/auth/logout" && req.method === "POST") {
    const sid = readSessionId(req);
    if (sid) await destroySession(env, sid);
    return json({ ok: true }, 200, { "Set-Cookie": clearSessionCookie(req.url) });
  }

  if (path === "/api/auth/dev-login" && req.method === "POST") {
    if (env.ALLOW_DEV_LOGIN !== "true") return error("dev login disabled", 403);
    const body = (await req.json().catch(() => ({}))) as { name?: string };
    const owner = await ensureOwner(env);
    const user = owner ?? (await createDevUser(env, body.name?.trim() || "Dev User"));
    const sid = await createSession(env, user.id);
    return json({ user }, 200, { "Set-Cookie": setSessionCookie(sid, req.url) });
  }

  // ローカルのみ。登録メールが一致したときだけ個人用ユーザーに入る。
  if (path === "/api/auth/owner-login" && req.method === "POST") {
    if (env.ALLOW_DEV_LOGIN !== "true") return error("use Access email login", 403);
    const body = (await req.json().catch(() => ({}))) as { email?: string };
    const email = body.email?.trim().toLowerCase() ?? "";
    if (!env.OWNER_EMAIL || email !== env.OWNER_EMAIL.trim().toLowerCase()) {
      return error("個人用のみ", 403);
    }
    const user = await ensureOwner(env);
    if (!user) return error("OWNER_EMAIL unset", 500);
    const sid = await createSession(env, user.id);
    return json({ user }, 200, { "Set-Cookie": setSessionCookie(sid, req.url) });
  }

  // Access メール OTP → セッション。個人用のみ。OAuth トークンは D1 に置かない。
  if (path === "/api/auth/access-login" && req.method === "POST") {
    const accessEmail = accessAuthenticatedEmail(req);
    if (!accessEmail) return error("Access required", 401);
    if (!env.OWNER_EMAIL || accessEmail !== env.OWNER_EMAIL.toLowerCase()) {
      return error("個人用のみ", 403);
    }
    const user = await ensureOwner(env);
    if (!user) return error("OWNER_EMAIL unset", 500);
    const sid = await createSession(env, user.id);
    return json({ user }, 200, { "Set-Cookie": setSessionCookie(sid, req.url) });
  }

  if (
    path === "/api/auth/google" ||
    path === "/api/auth/google/callback" ||
    path === "/api/auth/github" ||
    path === "/api/auth/github/callback"
  ) {
    return error("OAuth disabled — use Access login and CLI import", 410);
  }

  return null;
}
