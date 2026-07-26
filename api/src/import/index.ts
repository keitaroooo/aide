import { createTask, findTaskBySource, getOauthToken, updateTask, upsertEvent } from "../db";
import type { Env, Horizon, User } from "../types";
import { id, isHorizon } from "../types";

export type MdListItem = {
  title: string;
  source_ref: string; // e.g. "keitaro-yamaguchi#142"
  done?: boolean;
  notes?: string | null; // e.g. "domain=engineering kind=reading prio=P1"
  horizon?: "someday" | "soon" | "should" | "inbox"; // default someday
};

export async function importMdLists(
  env: Env,
  user: User,
  items: MdListItem[],
): Promise<{ imported: number; updated: number; skipped: number; completed: number }> {
  let imported = 0;
  let updated = 0;
  let skipped = 0;
  let completed = 0;

  for (const item of items) {
    const title = item.title?.trim();
    const source_ref = item.source_ref?.trim();
    if (!title || !source_ref) {
      skipped++;
      continue;
    }

    const notes = item.notes === undefined ? null : item.notes;
    const horizon: Horizon =
      item.horizon && isHorizon(item.horizon) ? item.horizon : "someday";
    const done = Boolean(item.done);

    const existing = await findTaskBySource(env.DB, user.id, "md_list", source_ref);
    if (!existing) {
      const task = await createTask(env.DB, {
        id: id(),
        user_id: user.id,
        title,
        notes,
        horizon,
        source: "md_list",
        source_ref,
      });
      imported++;
      if (done) {
        await updateTask(env.DB, user.id, task.id, { status: "done" });
        completed++;
      }
      continue;
    }

    const patch: Partial<{
      title: string;
      notes: string | null;
      horizon: Horizon;
      status: "done";
    }> = {};
    let fieldsChanged = false;
    let statusCompleted = false;

    if (existing.title !== title) {
      patch.title = title;
      fieldsChanged = true;
    }
    const nextNotes = notes;
    if ((existing.notes ?? null) !== (nextNotes ?? null)) {
      patch.notes = nextNotes;
      fieldsChanged = true;
    }
    if (existing.horizon !== horizon) {
      patch.horizon = horizon;
      fieldsChanged = true;
    }
    if (done && existing.status === "open") {
      patch.status = "done";
      statusCompleted = true;
    }

    if (!fieldsChanged && !statusCompleted) {
      skipped++;
      continue;
    }

    await updateTask(env.DB, user.id, existing.id, patch);
    if (fieldsChanged) updated++;
    if (statusCompleted) completed++;
  }

  return { imported, updated, skipped, completed };
}

async function googleAccessToken(env: Env, user: User): Promise<string> {
  const row = await getOauthToken(env.DB, user.id, "google");
  if (!row) throw new Error("Google 未連携です。設定から接続してください。");
  // Refresh if expired and refresh_token exists
  if (row.expires_at && row.expires_at < new Date().toISOString() && row.refresh_token) {
    if (!env.GOOGLE_CLIENT_ID || !env.GOOGLE_CLIENT_SECRET) {
      throw new Error("Google OAuth credentials missing for refresh");
    }
    const res = await fetch("https://oauth2.googleapis.com/token", {
      method: "POST",
      headers: { "content-type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({
        client_id: env.GOOGLE_CLIENT_ID,
        client_secret: env.GOOGLE_CLIENT_SECRET,
        refresh_token: row.refresh_token,
        grant_type: "refresh_token",
      }),
    });
    if (!res.ok) throw new Error(`Google refresh failed: ${await res.text()}`);
    const data = (await res.json()) as { access_token: string; expires_in?: number };
    const expires_at = data.expires_in
      ? new Date(Date.now() + data.expires_in * 1000).toISOString()
      : null;
    await env.DB.prepare(
      `UPDATE oauth_tokens SET access_token = ?, expires_at = ? WHERE user_id = ? AND provider = 'google'`,
    )
      .bind(data.access_token, expires_at, user.id)
      .run();
    return data.access_token;
  }
  return row.access_token;
}

export async function importGoogleTasks(
  env: Env,
  user: User,
): Promise<{ imported: number; skipped: number }> {
  const token = await googleAccessToken(env, user);
  const listsRes = await fetch("https://tasks.googleapis.com/tasks/v1/users/@me/lists", {
    headers: { Authorization: `Bearer ${token}` },
  });
  if (!listsRes.ok) throw new Error(`Tasks lists failed: ${await listsRes.text()}`);
  const lists = (await listsRes.json()) as { items?: Array<{ id: string; title: string }> };

  let imported = 0;
  let skipped = 0;
  for (const list of lists.items ?? []) {
    const tasksRes = await fetch(
      `https://tasks.googleapis.com/tasks/v1/lists/${list.id}/tasks?showCompleted=false&maxResults=100`,
      { headers: { Authorization: `Bearer ${token}` } },
    );
    if (!tasksRes.ok) continue;
    const tasksJson = (await tasksRes.json()) as {
      items?: Array<{ id: string; title?: string; notes?: string; due?: string }>;
    };
    for (const t of tasksJson.items ?? []) {
      if (!t.title) continue;
      const ref = `tasks:${list.id}:${t.id}`;
      const existing = await findTaskBySource(env.DB, user.id, "google_tasks", ref);
      if (existing) {
        skipped++;
        continue;
      }
      await createTask(env.DB, {
        id: id(),
        user_id: user.id,
        title: t.title,
        notes: t.notes ?? `from: ${list.title}`,
        horizon: t.due ? "should" : "inbox",
        due_at: t.due ?? null,
        source: "google_tasks",
        source_ref: ref,
      });
      imported++;
    }
  }
  return { imported, skipped };
}

export async function importGoogleCalendar(
  env: Env,
  user: User,
): Promise<{ imported: number; skipped: number }> {
  const token = await googleAccessToken(env, user);
  const now = new Date();
  const timeMin = now.toISOString();
  const timeMax = new Date(now.getTime() + 14 * 24 * 60 * 60 * 1000).toISOString();
  const url = new URL("https://www.googleapis.com/calendar/v3/calendars/primary/events");
  url.searchParams.set("timeMin", timeMin);
  url.searchParams.set("timeMax", timeMax);
  url.searchParams.set("singleEvents", "true");
  url.searchParams.set("orderBy", "startTime");
  url.searchParams.set("maxResults", "50");

  const res = await fetch(url.toString(), {
    headers: { Authorization: `Bearer ${token}` },
  });
  if (!res.ok) throw new Error(`Calendar failed: ${await res.text()}`);
  const data = (await res.json()) as {
    items?: Array<{
      id: string;
      summary?: string;
      start?: { dateTime?: string; date?: string };
      end?: { dateTime?: string; date?: string };
    }>;
  };

  let imported = 0;
  let skipped = 0;
  for (const ev of data.items ?? []) {
    if (!ev.summary) continue;
    const ref = `cal:${ev.id}`;
    const existing = await env.DB.prepare(
      `SELECT id FROM events WHERE user_id = ? AND source_ref = ?`,
    )
      .bind(user.id, ref)
      .first();
    if (existing) {
      skipped++;
      continue;
    }
    await upsertEvent(env.DB, {
      id: id(),
      user_id: user.id,
      title: ev.summary,
      start_at: ev.start?.dateTime || ev.start?.date || null,
      end_at: ev.end?.dateTime || ev.end?.date || null,
      source_ref: ref,
    });
    imported++;
  }
  return { imported, skipped };
}

export async function importGitHubProjects(
  env: Env,
  user: User,
  opts: { owner?: string; number?: number } = {},
): Promise<{ imported: number; skipped: number; project?: string }> {
  const row = await getOauthToken(env.DB, user.id, "github");
  if (!row) throw new Error("GitHub 未連携です。設定から接続してください。");

  const headers = {
    Authorization: `Bearer ${row.access_token}`,
    Accept: "application/vnd.github+json",
    "User-Agent": "aide-app",
    "X-GitHub-Api-Version": "2022-11-28",
  };

  // Resolve viewer login if owner not provided
  let owner = opts.owner;
  if (!owner) {
    const me = await fetch("https://api.github.com/user", { headers });
    if (!me.ok) throw new Error(`GitHub user failed: ${await me.text()}`);
    const meJson = (await me.json()) as { login: string };
    owner = meJson.login;
  }

  const projectsRes = await fetch(
    `https://api.github.com/users/${owner}/projectsV2?per_page=20`,
    { headers: { ...headers, Accept: "application/vnd.github.inertia-preview+json" } },
  ).catch(() => null);

  // Prefer GraphQL Projects V2
  const projectNumber = opts.number;
  const gql = await fetch("https://api.github.com/graphql", {
    method: "POST",
    headers: { ...headers, "content-type": "application/json" },
    body: JSON.stringify({
      query: `
        query($login: String!, $number: Int!) {
          user(login: $login) {
            projectV2(number: $number) {
              title
              items(first: 50) {
                nodes {
                  id
                  content {
                    ... on DraftIssue { title body }
                    ... on Issue { title body state }
                    ... on PullRequest { title body state }
                  }
                  fieldValues(first: 10) {
                    nodes {
                      ... on ProjectV2ItemFieldSingleSelectValue {
                        name
                        field { ... on ProjectV2SingleSelectField { name } }
                      }
                    }
                  }
                }
              }
            }
          }
        }
      `,
      variables: { login: owner, number: projectNumber ?? 1 },
    }),
  });

  if (!gql.ok) {
    void projectsRes;
    throw new Error(`GitHub GraphQL failed: ${await gql.text()}`);
  }

  const gqlJson = (await gql.json()) as {
    data?: {
      user?: {
        projectV2?: {
          title: string;
          items: {
            nodes: Array<{
              id: string;
              content?: { title?: string; body?: string; state?: string } | null;
            }>;
          };
        } | null;
      };
    };
    errors?: unknown;
  };

  const project = gqlJson.data?.user?.projectV2;
  if (!project) {
    throw new Error(
      `Project #${projectNumber ?? 1} が見つかりません。settings で番号を指定してください。`,
    );
  }

  let imported = 0;
  let skipped = 0;
  for (const node of project.items.nodes) {
    const title = node.content?.title;
    if (!title) continue;
    if (node.content?.state === "CLOSED" || node.content?.state === "MERGED") {
      skipped++;
      continue;
    }
    const ref = `gh:${node.id}`;
    const existing = await findTaskBySource(env.DB, user.id, "github", ref);
    if (existing) {
      skipped++;
      continue;
    }
    await createTask(env.DB, {
      id: id(),
      user_id: user.id,
      title,
      notes: node.content?.body?.slice(0, 500) ?? `from: ${project.title}`,
      horizon: "inbox",
      source: "github",
      source_ref: ref,
    });
    imported++;
  }

  return { imported, skipped, project: project.title };
}
