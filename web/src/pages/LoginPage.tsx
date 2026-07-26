import { useState } from "react";
import { client } from "../lib/api";
import { useAuth } from "../lib/auth";

export function LoginPage() {
  const { features, refresh } = useAuth();
  const [name, setName] = useState("Keitaro");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function devLogin() {
    setBusy(true);
    setError(null);
    try {
      await client.devLogin(name);
      await refresh();
    } catch (e) {
      setError(e instanceof Error ? e.message : "login failed");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="login-screen">
      <div className="login-panel card fade-in stack">
        <p className="muted">暮らしのアシスタント</p>
        <h1>Aide</h1>
        <p className="muted">話すだけで、やることを整える。</p>

        <a className="btn primary" href="/api/auth/google">
          Google でログイン
        </a>
        <p className="muted" style={{ margin: 0 }}>
          Google のログイン画面へ移動し、Tasks / カレンダーを取り込みます。
        </p>

        <a className="btn" href="/api/auth/github">
          GitHub でログイン
        </a>

        {features?.allowDevLogin && (
          <>
            <hr style={{ border: 0, borderTop: "1px solid var(--line)", margin: "0.4rem 0" }} />
            <label className="muted" htmlFor="dev-name">
              開発用（OAuth なし）
            </label>
            <input
              id="dev-name"
              className="field"
              value={name}
              onChange={(e) => setName(e.target.value)}
            />
            <button className="btn accent" disabled={busy} onClick={() => void devLogin()}>
              {busy ? "…" : "開発ログイン"}
            </button>
          </>
        )}

        {error && <p style={{ color: "var(--accent)" }}>{error}</p>}
      </div>
    </div>
  );
}
