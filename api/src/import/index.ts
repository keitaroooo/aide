import { createTask, findEventBySource, findTaskBySource, insertEvent, updateEventTimes, updateTask } from "../db";
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

export type CalImportItem = {
  title: string;
  source_ref: string;
  start_at?: string | null;
  end_at?: string | null;
};

export async function importEvents(
  env: Env,
  user: User,
  items: CalImportItem[],
): Promise<{ imported: number; updated: number; skipped: number }> {
  let imported = 0;
  let updated = 0;
  let skipped = 0;

  for (const item of items) {
    const title = item.title?.trim();
    const source_ref = item.source_ref?.trim();
    if (!title || !source_ref) {
      skipped++;
      continue;
    }
    const start_at = item.start_at ?? null;
    const end_at = item.end_at ?? null;
    const existing = await findEventBySource(env.DB, user.id, source_ref);
    if (!existing) {
      await insertEvent(env.DB, {
        id: id(),
        user_id: user.id,
        title,
        start_at,
        end_at,
        source_ref,
      });
      imported++;
      continue;
    }
    if (existing.title === title && existing.start_at === start_at && existing.end_at === end_at) {
      skipped++;
      continue;
    }
    await updateEventTimes(env.DB, user.id, existing.id, { title, start_at, end_at });
    updated++;
  }

  return { imported, updated, skipped };
}
