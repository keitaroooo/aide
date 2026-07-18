import { upsertOauthToken } from "../db";
import type { Env } from "../types";
import { error, id, json } from "../types";
import {
  clearSessionCookie,
  createDevUser,
  createSession,
  destroySession,
  findOrCreateOAuthUser,
  makeOAuthState,
  parseOAuthState,
  readSessionId,
  requireUser,
  setSessionCookie,
} from "./session";

function appUrl(env: Env): string {
  return env.APP_URL.replace(/\/$/, "");
}

export async function handleAuth(req: Request, env: Env, path: string): Promise<Response | null> {
  if (path === "/api/auth/me" && req.method === "GET") {
    const user = await requireUser(env, req);
    if (user instanceof Response) return json({ user: null });
    const google = await env.DB.prepare(
      `SELECT 1 as ok FROM oauth_tokens WHERE user_id = ? AND provider = 'google'`,
    )
      .bind(user.id)
      .first();
    const github = await env.DB.prepare(
      `SELECT 1 as ok FROM oauth_tokens WHERE user_id = ? AND provider = 'github'`,
    )
      .bind(user.id)
      .first();
    return json({
      user,
      links: { google: !!google, github: !!github },
      features: {
        googleOAuth: !!(env.GOOGLE_CLIENT_ID && env.GOOGLE_CLIENT_SECRET),
        githubOAuth: !!(env.GITHUB_CLIENT_ID && env.GITHUB_CLIENT_SECRET),
        webPush: !!(env.VAPID_PUBLIC_KEY && env.VAPID_PRIVATE_KEY),
        vapidPublicKey: env.VAPID_PUBLIC_KEY ?? null,
        allowDevLogin: env.ALLOW_DEV_LOGIN === "true",
      },
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
    const user = await createDevUser(env, body.name?.trim() || "Dev User");
    const sid = await createSession(env, user.id);
    return json({ user }, 200, { "Set-Cookie": setSessionCookie(sid, req.url) });
  }

  if (path === "/api/auth/google" && req.method === "GET") {
    if (!env.GOOGLE_CLIENT_ID || !env.GOOGLE_CLIENT_SECRET) {
      return error("Google OAuth is not configured", 503);
    }
    const user = await requireUser(env, req);
    const linkOnly = !(user instanceof Response);
    const state = await makeOAuthState(env, {
      provider: "google",
      mode: linkOnly ? "link" : "login",
      userId: linkOnly ? user.id : "",
    });
    const redirectUri = `${appUrl(env)}/api/auth/google/callback`;
    const scopes = [
      "openid",
      "email",
      "profile",
      "https://www.googleapis.com/auth/calendar.readonly",
      "https://www.googleapis.com/auth/tasks.readonly",
    ].join(" ");
    const url = new URL("https://accounts.google.com/o/oauth2/v2/auth");
    url.searchParams.set("client_id", env.GOOGLE_CLIENT_ID);
    url.searchParams.set("redirect_uri", redirectUri);
    url.searchParams.set("response_type", "code");
    url.searchParams.set("scope", scopes);
    url.searchParams.set("access_type", "offline");
    url.searchParams.set("prompt", "consent");
    url.searchParams.set("state", state);
    return Response.redirect(url.toString(), 302);
  }

  if (path === "/api/auth/google/callback" && req.method === "GET") {
    if (!env.GOOGLE_CLIENT_ID || !env.GOOGLE_CLIENT_SECRET) {
      return error("Google OAuth is not configured", 503);
    }
    const u = new URL(req.url);
    const code = u.searchParams.get("code");
    const stateRaw = u.searchParams.get("state");
    if (!code || !stateRaw) return error("missing code/state");
    const state = await parseOAuthState(env, stateRaw);
    if (!state || state.provider !== "google") return error("invalid state", 403);

    const redirectUri = `${appUrl(env)}/api/auth/google/callback`;
    const tokenRes = await fetch("https://oauth2.googleapis.com/token", {
      method: "POST",
      headers: { "content-type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({
        code,
        client_id: env.GOOGLE_CLIENT_ID,
        client_secret: env.GOOGLE_CLIENT_SECRET,
        redirect_uri: redirectUri,
        grant_type: "authorization_code",
      }),
    });
    if (!tokenRes.ok) return error(`Google token exchange failed: ${await tokenRes.text()}`, 502);
    const tokenJson = (await tokenRes.json()) as {
      access_token: string;
      refresh_token?: string;
      expires_in?: number;
      scope?: string;
    };

    const profileRes = await fetch("https://www.googleapis.com/oauth2/v2/userinfo", {
      headers: { Authorization: `Bearer ${tokenJson.access_token}` },
    });
    if (!profileRes.ok) return error("Failed to fetch Google profile", 502);
    const profile = (await profileRes.json()) as { id: string; email?: string; name?: string };

    let userId = state.userId;
    let setCookie: string | undefined;
    if (state.mode === "link" && userId) {
      // keep existing user
    } else {
      const user = await findOrCreateOAuthUser(env, {
        provider: "google",
        providerUserId: profile.id,
        email: profile.email ?? null,
        name: profile.name || profile.email || "Google User",
      });
      userId = user.id;
      const sid = await createSession(env, user.id);
      setCookie = setSessionCookie(sid, req.url);
    }

    const expires_at = tokenJson.expires_in
      ? new Date(Date.now() + tokenJson.expires_in * 1000).toISOString()
      : null;
    await upsertOauthToken(env.DB, {
      id: id(),
      user_id: userId,
      provider: "google",
      access_token: tokenJson.access_token,
      refresh_token: tokenJson.refresh_token ?? null,
      expires_at,
      scopes: tokenJson.scope ?? null,
    });

    const headers: HeadersInit = {};
    if (setCookie) headers["Set-Cookie"] = setCookie;
    return new Response(null, {
      status: 302,
      headers: { ...headers, Location: `${appUrl(env)}/settings?linked=google` },
    });
  }

  if (path === "/api/auth/github" && req.method === "GET") {
    if (!env.GITHUB_CLIENT_ID || !env.GITHUB_CLIENT_SECRET) {
      return error("GitHub OAuth is not configured", 503);
    }
    const user = await requireUser(env, req);
    const linkOnly = !(user instanceof Response);
    const state = await makeOAuthState(env, {
      provider: "github",
      mode: linkOnly ? "link" : "login",
      userId: linkOnly ? user.id : "",
    });
    const redirectUri = `${appUrl(env)}/api/auth/github/callback`;
    const url = new URL("https://github.com/login/oauth/authorize");
    url.searchParams.set("client_id", env.GITHUB_CLIENT_ID);
    url.searchParams.set("redirect_uri", redirectUri);
    url.searchParams.set("scope", "read:user user:email project");
    url.searchParams.set("state", state);
    return Response.redirect(url.toString(), 302);
  }

  if (path === "/api/auth/github/callback" && req.method === "GET") {
    if (!env.GITHUB_CLIENT_ID || !env.GITHUB_CLIENT_SECRET) {
      return error("GitHub OAuth is not configured", 503);
    }
    const u = new URL(req.url);
    const code = u.searchParams.get("code");
    const stateRaw = u.searchParams.get("state");
    if (!code || !stateRaw) return error("missing code/state");
    const state = await parseOAuthState(env, stateRaw);
    if (!state || state.provider !== "github") return error("invalid state", 403);

    const tokenRes = await fetch("https://github.com/login/oauth/access_token", {
      method: "POST",
      headers: {
        Accept: "application/json",
        "content-type": "application/json",
      },
      body: JSON.stringify({
        client_id: env.GITHUB_CLIENT_ID,
        client_secret: env.GITHUB_CLIENT_SECRET,
        code,
        redirect_uri: `${appUrl(env)}/api/auth/github/callback`,
      }),
    });
    if (!tokenRes.ok) return error(`GitHub token exchange failed: ${await tokenRes.text()}`, 502);
    const tokenJson = (await tokenRes.json()) as { access_token?: string; scope?: string; error?: string };
    if (!tokenJson.access_token) return error(tokenJson.error || "no access_token", 502);

    const profileRes = await fetch("https://api.github.com/user", {
      headers: {
        Authorization: `Bearer ${tokenJson.access_token}`,
        Accept: "application/vnd.github+json",
        "User-Agent": "aide-app",
      },
    });
    if (!profileRes.ok) return error("Failed to fetch GitHub profile", 502);
    const profile = (await profileRes.json()) as {
      id: number;
      login: string;
      name?: string;
      email?: string;
    };

    let userId = state.userId;
    let setCookie: string | undefined;
    if (state.mode === "link" && userId) {
      // keep
    } else {
      const user = await findOrCreateOAuthUser(env, {
        provider: "github",
        providerUserId: String(profile.id),
        email: profile.email ?? null,
        name: profile.name || profile.login,
      });
      userId = user.id;
      const sid = await createSession(env, user.id);
      setCookie = setSessionCookie(sid, req.url);
    }

    await upsertOauthToken(env.DB, {
      id: id(),
      user_id: userId,
      provider: "github",
      access_token: tokenJson.access_token,
      scopes: tokenJson.scope ?? null,
    });

    const headers: HeadersInit = {};
    if (setCookie) headers["Set-Cookie"] = setCookie;
    return new Response(null, {
      status: 302,
      headers: { ...headers, Location: `${appUrl(env)}/settings?linked=github` },
    });
  }

  return null;
}
