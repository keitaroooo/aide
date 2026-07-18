import { addChat, createTask, listChat, listTasks, updateTask } from "../db";
import type { Env, Horizon, Task, User } from "../types";
import { id, isHorizon } from "../types";

const SYSTEM = `あなたは Aide のアシスタントです。ユーザーのタスクを整理し、簡潔に日本語で答えます。
時間軸は次のみです: inbox（仕分け前）, soon（直近）, should（やるべき・期限あり）, someday（いつかやりたい）。
優先度の数値や勝手なランキングは付けない。ユーザーが自然言語で意図を示したときだけ horizon / due を更新する。
ツールでタスクを作成・更新・一覧・完了できる。推測で完了にしない。`;

type ToolName = "create_task" | "update_task" | "list_by_horizon" | "complete_task";

interface ToolCall {
  name: ToolName;
  arguments: Record<string, unknown>;
}

const TOOL_DEFS = [
  {
    type: "function",
    function: {
      name: "create_task",
      description: "新しいタスクを作る",
      parameters: {
        type: "object",
        properties: {
          title: { type: "string" },
          notes: { type: "string" },
          horizon: { type: "string", enum: ["inbox", "soon", "should", "someday"] },
          due_at: { type: "string", description: "ISO date or datetime" },
        },
        required: ["title"],
      },
    },
  },
  {
    type: "function",
    function: {
      name: "update_task",
      description: "既存タスクの horizon / due / title を更新",
      parameters: {
        type: "object",
        properties: {
          task_id: { type: "string" },
          title: { type: "string" },
          horizon: { type: "string", enum: ["inbox", "soon", "should", "someday"] },
          due_at: { type: "string" },
        },
        required: ["task_id"],
      },
    },
  },
  {
    type: "function",
    function: {
      name: "list_by_horizon",
      description: "指定 horizon の未完了タスク一覧",
      parameters: {
        type: "object",
        properties: {
          horizon: { type: "string", enum: ["inbox", "soon", "should", "someday"] },
        },
      },
    },
  },
  {
    type: "function",
    function: {
      name: "complete_task",
      description: "タスクを完了にする",
      parameters: {
        type: "object",
        properties: { task_id: { type: "string" } },
        required: ["task_id"],
      },
    },
  },
];

async function runTool(
  env: Env,
  user: User,
  call: ToolCall,
): Promise<unknown> {
  switch (call.name) {
    case "create_task": {
      const title = String(call.arguments.title ?? "").trim();
      if (!title) return { error: "title required" };
      const horizonRaw = String(call.arguments.horizon ?? "inbox");
      const horizon: Horizon = isHorizon(horizonRaw) ? horizonRaw : "inbox";
      const task = await createTask(env.DB, {
        id: id(),
        user_id: user.id,
        title,
        notes: call.arguments.notes ? String(call.arguments.notes) : null,
        horizon,
        due_at: call.arguments.due_at ? String(call.arguments.due_at) : null,
      });
      return { task };
    }
    case "update_task": {
      const taskId = String(call.arguments.task_id ?? "");
      const horizonRaw = call.arguments.horizon ? String(call.arguments.horizon) : undefined;
      const task = await updateTask(env.DB, user.id, taskId, {
        title: call.arguments.title ? String(call.arguments.title) : undefined,
        horizon: horizonRaw && isHorizon(horizonRaw) ? horizonRaw : undefined,
        due_at: call.arguments.due_at !== undefined ? String(call.arguments.due_at) : undefined,
      });
      return task ? { task } : { error: "not found" };
    }
    case "list_by_horizon": {
      const horizonRaw = call.arguments.horizon ? String(call.arguments.horizon) : undefined;
      const tasks = await listTasks(env.DB, user.id, {
        horizon: horizonRaw && isHorizon(horizonRaw) ? horizonRaw : undefined,
      });
      return {
        tasks: tasks.map((t) => ({
          id: t.id,
          title: t.title,
          horizon: t.horizon,
          due_at: t.due_at,
        })),
      };
    }
    case "complete_task": {
      const task = await updateTask(env.DB, user.id, String(call.arguments.task_id ?? ""), {
        status: "done",
      });
      return task ? { task } : { error: "not found" };
    }
    default:
      return { error: "unknown tool" };
  }
}

function formatBoardBrief(tasks: Task[]): string {
  const groups: Record<string, Task[]> = {
    soon: [],
    should: [],
    someday: [],
    inbox: [],
  };
  for (const t of tasks) groups[t.horizon]?.push(t);
  const line = (label: string, list: Task[]) =>
    `${label}: ${list.length ? list.map((t) => t.title).join(" / ") : "なし"}`;
  return [
    line("直近", groups.soon),
    line("やるべき", groups.should),
    line("いつか", groups.someday),
    line("Inbox", groups.inbox),
  ].join("\n");
}

/** Heuristic NL secretary when no LLM is available. */
export async function heuristicSecretary(
  env: Env,
  user: User,
  message: string,
): Promise<string> {
  const text = message.trim();
  const tasks = await listTasks(env.DB, user.id);

  if (/今日|なにやる|何やる|やることは|ダイジェスト|教えて/.test(text)) {
    return `いまの整理です。\n${formatBoardBrief(tasks)}`;
  }

  const moveMatch = text.match(/(.+?)[をは]?(直近|すぐ|今日|今週|やるべき|いつか|いつかやりたい|inbox|インボックス)/);
  if (moveMatch) {
    const titlePart = moveMatch[1].replace(/[「」\s]+/g, "").trim();
    const destRaw = moveMatch[2];
    let horizon: Horizon = "inbox";
    if (/直近|すぐ|今日|今週/.test(destRaw)) horizon = "soon";
    else if (/やるべき/.test(destRaw)) horizon = "should";
    else if (/いつか/.test(destRaw)) horizon = "someday";

    const hit =
      tasks.find((t) => t.title.includes(titlePart) || titlePart.includes(t.title)) ??
      null;
    if (hit) {
      await updateTask(env.DB, user.id, hit.id, { horizon });
      return `「${hit.title}」を ${horizon} に移しました。`;
    }
  }

  const addMatch = text.match(/(?:追加|メモ|タスク)[：:\s]*(.+)$/) || text.match(/^(.+)を追加/);
  if (addMatch || (!/？|\?|何|教えて|一覧/.test(text) && text.length < 80)) {
    const title = (addMatch?.[1] ?? text).trim();
    let horizon: Horizon = "inbox";
    if (/今日|明日|直近|すぐ/.test(text)) horizon = "soon";
    else if (/いつか|したい/.test(text)) horizon = "someday";
    else if (/べき|期限|まで/.test(text)) horizon = "should";
    const task = await createTask(env.DB, {
      id: id(),
      user_id: user.id,
      title: title.replace(/を追加$/, "").trim() || text,
      horizon,
    });
    return `「${task.title}」を ${task.horizon} に追加しました。`;
  }

  const doneMatch = text.match(/(.+?)[をは]?(完了|終わ|できた)/);
  if (doneMatch) {
    const titlePart = doneMatch[1].replace(/[「」\s]+/g, "").trim();
    const hit = tasks.find((t) => t.title.includes(titlePart));
    if (hit) {
      await updateTask(env.DB, user.id, hit.id, { status: "done" });
      return `「${hit.title}」を完了にしました。`;
    }
  }

  return `受け取りました。いまの整理:\n${formatBoardBrief(tasks)}\n\n例: 「買い物を追加」「宅建はいつかでいい」「今日やることは？」`;
}

async function callOpenAICompatible(
  env: Env,
  messages: Array<{ role: string; content: string }>,
): Promise<{ content?: string; tool_calls?: Array<{ id: string; function: { name: string; arguments: string } }> }> {
  const base = (env.OPENAI_BASE_URL || "https://api.openai.com/v1").replace(/\/$/, "");
  const res = await fetch(`${base}/chat/completions`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${env.OPENAI_API_KEY}`,
      "content-type": "application/json",
    },
    body: JSON.stringify({
      model: "gpt-4o-mini",
      messages,
      tools: TOOL_DEFS,
      tool_choice: "auto",
    }),
  });
  if (!res.ok) throw new Error(`OpenAI error: ${await res.text()}`);
  const data = (await res.json()) as {
    choices: Array<{ message: { content?: string; tool_calls?: Array<{ id: string; function: { name: string; arguments: string } }> } }>;
  };
  return data.choices[0]?.message ?? {};
}

async function callWorkersAI(
  env: Env,
  messages: Array<{ role: string; content: string }>,
): Promise<{ content?: string; tool_calls?: Array<{ id: string; function: { name: string; arguments: string } }> }> {
  if (!env.AI) throw new Error("no AI binding");
  // Prefer a function-calling capable model; fall back gracefully.
  const result = (await env.AI.run("@cf/meta/llama-3.3-70b-instruct-fp8-fast" as keyof AiModels, {
    messages,
    tools: TOOL_DEFS,
  } as never)) as {
    response?: string;
    tool_calls?: Array<{ name?: string; arguments?: Record<string, unknown> | string }>;
  };

  if (result.tool_calls?.length) {
    return {
      content: result.response,
      tool_calls: result.tool_calls.map((tc, i) => ({
        id: `call_${i}`,
        function: {
          name: tc.name || "list_by_horizon",
          arguments:
            typeof tc.arguments === "string" ? tc.arguments : JSON.stringify(tc.arguments ?? {}),
        },
      })),
    };
  }
  return { content: result.response ?? "" };
}

export async function runSecretary(
  env: Env,
  user: User,
  message: string,
): Promise<{ reply: string; used: "openai" | "workers-ai" | "heuristic" }> {
  await addChat(env.DB, { id: id(), user_id: user.id, role: "user", content: message });

  const history = await listChat(env.DB, user.id, 12);
  const openTasks = await listTasks(env.DB, user.id);
  const contextNote = `現在の未完了タスク:\n${openTasks
    .slice(0, 40)
    .map((t) => `- [${t.horizon}] ${t.title} (id=${t.id}${t.due_at ? `, due=${t.due_at}` : ""})`)
    .join("\n") || "(なし)"}`;

  const messages = [
    { role: "system", content: `${SYSTEM}\n\n${contextNote}` },
    ...history.map((m) => ({ role: m.role, content: m.content })),
  ];

  try {
    let used: "openai" | "workers-ai" = env.OPENAI_API_KEY ? "openai" : "workers-ai";
    let assistant = env.OPENAI_API_KEY
      ? await callOpenAICompatible(env, messages)
      : await callWorkersAI(env, messages);

    // Tool loop (max 3)
    for (let i = 0; i < 3 && assistant.tool_calls?.length; i++) {
      const toolResults: Array<{ role: string; content: string; tool_call_id?: string }> = [];
      for (const tc of assistant.tool_calls) {
        let args: Record<string, unknown> = {};
        try {
          args = JSON.parse(tc.function.arguments || "{}") as Record<string, unknown>;
        } catch {
          args = {};
        }
        const result = await runTool(env, user, {
          name: tc.function.name as ToolName,
          arguments: args,
        });
        toolResults.push({
          role: "tool",
          tool_call_id: tc.id,
          content: JSON.stringify(result),
        });
      }
      const follow = [
        ...messages,
        {
          role: "assistant",
          content: assistant.content ?? "",
          tool_calls: assistant.tool_calls,
        } as unknown as { role: string; content: string },
        ...toolResults,
      ];
      assistant = env.OPENAI_API_KEY
        ? await callOpenAICompatible(env, follow)
        : await callWorkersAI(env, follow);
      used = env.OPENAI_API_KEY ? "openai" : "workers-ai";
    }

    const reply = (assistant.content || "更新しました。").trim();
    await addChat(env.DB, { id: id(), user_id: user.id, role: "assistant", content: reply });
    return { reply, used };
  } catch {
    const reply = await heuristicSecretary(env, user, message);
    await addChat(env.DB, { id: id(), user_id: user.id, role: "assistant", content: reply });
    return { reply, used: "heuristic" };
  }
}
