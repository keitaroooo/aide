import { useEffect, useState, type FormEvent } from "react";
import { client, HORIZON_LABEL, type Horizon, type Task } from "../lib/api";

const COLS: Horizon[] = ["inbox", "soon", "should", "someday"];

export function BoardPage() {
  const [board, setBoard] = useState<Record<Horizon, Task[]> | null>(null);
  const [title, setTitle] = useState("");
  const [horizon, setHorizon] = useState<Horizon>("inbox");

  async function load() {
    const data = await client.board();
    setBoard(data.board);
  }

  useEffect(() => {
    void load();
  }, []);

  async function add(e: FormEvent) {
    e.preventDefault();
    if (!title.trim()) return;
    await client.createTask({ title: title.trim(), horizon });
    setTitle("");
    await load();
  }

  async function move(task: Task, next: Horizon) {
    await client.patchTask(task.id, { horizon: next });
    await load();
  }

  if (!board) return <p className="muted">読み込み中…</p>;

  return (
    <div className="stack fade-in">
      <header>
        <h1 className="brand">ボード</h1>
        <p className="muted">可視化は人のため。並べ替えはアシスタントに任せるか、必要ならここで移動。</p>
      </header>

      <form className="card row" onSubmit={(e) => void add(e)}>
        <input
          className="field"
          placeholder="メモやタスクを追加"
          value={title}
          onChange={(e) => setTitle(e.target.value)}
        />
        <select
          className="field"
          style={{ maxWidth: 120 }}
          value={horizon}
          onChange={(e) => setHorizon(e.target.value as Horizon)}
        >
          {COLS.map((h) => (
            <option key={h} value={h}>
              {HORIZON_LABEL[h]}
            </option>
          ))}
        </select>
        <button className="btn primary">追加</button>
      </form>

      <div className="board">
        {COLS.map((h) => (
          <section className="card board-col" key={h}>
            <h2>
              <span className={`horizon-pill horizon-${h}`}>{HORIZON_LABEL[h]}</span>
            </h2>
            {board[h].length === 0 && <p className="muted">空</p>}
            {board[h].map((t) => (
              <div className="task" key={t.id}>
                <div>
                  <div>{t.title}</div>
                  {t.notes && <div className="muted">{t.notes.slice(0, 80)}</div>}
                </div>
                <div className="stack" style={{ gap: 4 }}>
                  <select
                    className="field"
                    style={{ padding: "0.35rem 0.5rem", fontSize: "0.8rem" }}
                    value={t.horizon}
                    onChange={(e) => void move(t, e.target.value as Horizon)}
                  >
                    {COLS.map((opt) => (
                      <option key={opt} value={opt}>
                        {HORIZON_LABEL[opt]}
                      </option>
                    ))}
                  </select>
                  <button
                    className="btn ghost"
                    onClick={() => void client.patchTask(t.id, { status: "done" }).then(load)}
                  >
                    完了
                  </button>
                </div>
              </div>
            ))}
          </section>
        ))}
      </div>
    </div>
  );
}
