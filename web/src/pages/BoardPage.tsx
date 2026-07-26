import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { client, HORIZON_LABEL, type Horizon, type Task } from "../lib/api";

const COLUMNS: Horizon[] = ["inbox", "soon", "should", "someday"];

const EMPTY_BOARD: Record<Horizon, Task[]> = {
  inbox: [],
  soon: [],
  should: [],
  someday: [],
};

export function BoardPage() {
  const [board, setBoard] = useState<Record<Horizon, Task[]>>(EMPTY_BOARD);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  async function loadBoard() {
    setError(null);
    try {
      const data = await client.board();
      setBoard({ ...EMPTY_BOARD, ...data.board });
    } catch (err) {
      setError(err instanceof Error ? err.message : "読み込みに失敗しました");
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    void loadBoard();
  }, []);

  async function complete(id: string) {
    await client.patchTask(id, { status: "done" });
    await loadBoard();
  }

  return (
    <div className="stack fade-in">
      <header
        className="hero-home row"
        style={{ justifyContent: "space-between", alignItems: "flex-start" }}
      >
        <div>
          <h1>ボード</h1>
          <p className="muted">Inbox · 直近 · やるべき · いつか</p>
        </div>
        <Link to="/" className="btn ghost">
          ホーム
        </Link>
      </header>

      {loading && <p className="muted">読み込み中…</p>}
      {error && (
        <div className="card" style={{ borderColor: "var(--accent-soft)" }}>
          <p style={{ margin: 0 }}>{error}</p>
        </div>
      )}

      {!loading && !error && (
        <div className="board">
          {COLUMNS.map((horizon) => {
            const tasks = board[horizon] ?? [];
            return (
              <section className="board-col card" key={horizon}>
                <h2>
                  {HORIZON_LABEL[horizon]}
                  <span className="muted" style={{ fontSize: "0.85rem", marginLeft: "0.4rem" }}>
                    ({tasks.length})
                  </span>
                </h2>
                <div className="board-col-list">
                  {tasks.length === 0 && <p className="muted">なし</p>}
                  {tasks.map((t) => (
                    <div className="task" key={t.id}>
                      <div>
                        <div>{t.title}</div>
                        {t.due_at && <div className="muted">{t.due_at.slice(0, 10)}</div>}
                      </div>
                      <button className="btn ghost" onClick={() => void complete(t.id)}>
                        完了
                      </button>
                    </div>
                  ))}
                </div>
              </section>
            );
          })}
        </div>
      )}
    </div>
  );
}
