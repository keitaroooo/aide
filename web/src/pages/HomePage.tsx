import { useEffect, useState, type FormEvent } from "react";
import { Link } from "react-router-dom";
import { client, type Task } from "../lib/api";
import { useAuth } from "../lib/auth";

export function HomePage() {
  const { user } = useAuth();
  const [soon, setSoon] = useState<Task[]>([]);
  const [should, setShould] = useState<Task[]>([]);
  const [events, setEvents] = useState<Array<{ id: string; title: string; start_at: string | null }>>(
    [],
  );
  const [message, setMessage] = useState("");
  const [reply, setReply] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function load() {
    const data = await client.home();
    setSoon(data.soon);
    setShould(data.should);
    setEvents(data.todayEvents);
  }

  useEffect(() => {
    void load();
  }, []);

  async function ask(e: FormEvent) {
    e.preventDefault();
    if (!message.trim()) return;
    setBusy(true);
    try {
      const res = await client.chat(message.trim());
      setReply(res.reply);
      setMessage("");
      await load();
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="stack fade-in">
      <header className="hero-home">
        <p className="muted">こんにちは、{user?.name}</p>
        <h1>今日、何をする？</h1>
        <p className="muted">アシスタントに聞いて、直近とやるべきを確認しましょう。</p>
      </header>

      <form className="card row" onSubmit={(e) => void ask(e)}>
        <input
          className="field"
          placeholder="例: 今日やることは？ / 買い物を追加"
          value={message}
          onChange={(e) => setMessage(e.target.value)}
        />
        <button className="btn primary" disabled={busy}>
          聞く
        </button>
      </form>

      {reply && (
        <div className="card">
          <p className="muted">アシスタント</p>
          <p style={{ whiteSpace: "pre-wrap", margin: "0.35rem 0 0" }}>{reply}</p>
          <p style={{ marginTop: "0.75rem" }}>
            <Link className="muted" to="/chat">
              会話を続ける →
            </Link>
          </p>
        </div>
      )}

      <section className="card">
        <h2 className="brand" style={{ fontSize: "1.2rem" }}>
          直近
        </h2>
        {soon.length === 0 && <p className="muted">まだありません</p>}
        {soon.map((t) => (
          <div className="task" key={t.id}>
            <div>
              <div>{t.title}</div>
              {t.due_at && <div className="muted">{t.due_at.slice(0, 10)}</div>}
            </div>
            <button
              className="btn ghost"
              onClick={() => void client.patchTask(t.id, { status: "done" }).then(load)}
            >
              完了
            </button>
          </div>
        ))}
      </section>

      <section className="card">
        <h2 className="brand" style={{ fontSize: "1.2rem" }}>
          やるべき
        </h2>
        {should.length === 0 && <p className="muted">期限付きはなし</p>}
        {should.map((t) => (
          <div className="task" key={t.id}>
            <div>
              <div>{t.title}</div>
              {t.due_at && <div className="muted">期限 {t.due_at.slice(0, 10)}</div>}
            </div>
            <button
              className="btn ghost"
              onClick={() => void client.patchTask(t.id, { status: "done" }).then(load)}
            >
              完了
            </button>
          </div>
        ))}
      </section>

      {events.length > 0 && (
        <section className="card">
          <h2 className="brand" style={{ fontSize: "1.2rem" }}>
            今日の予定
          </h2>
          {events.map((ev) => (
            <div className="task" key={ev.id}>
              <div>
                <div>{ev.title}</div>
                {ev.start_at && <div className="muted">{ev.start_at}</div>}
              </div>
              <button
                className="btn"
                onClick={() => void client.eventToTask(ev.id).then(load)}
              >
                タスクに
              </button>
            </div>
          ))}
        </section>
      )}
    </div>
  );
}
