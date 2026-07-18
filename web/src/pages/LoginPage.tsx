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
        <p className="muted">アシスタント型タスク</p>
        <h1>Aide</h1>
        <p className="muted">
          直近・やるべき・いつかを、自然言語で整える。優先度の並べ替えはあなたが言葉で伝える。
        </p>

        {features?.googleOAuth && (
          <a className="btn primary" href="/api/auth/google">
            Google で続ける
          </a>
        )}
        {features?.githubOAuth && (
          <a className="btn" href="/api/auth/github">
            GitHub で続ける
          </a>
        )}

        {features?.allowDevLogin && (
          <>
            <hr style={{ border: 0, borderTop: "1px solid var(--line)", margin: "0.4rem 0" }} />
            <label className="muted" htmlFor="dev-name">
              開発用ログイン
            </label>
            <input
              id="dev-name"
              className="field"
              value={name}
              onChange={(e) => setName(e.target.value)}
            />
            <button className="btn accent" disabled={busy} onClick={() => void devLogin()}>
              {busy ? "…" : "はじめる"}
            </button>
          </>
        )}

        {!features?.allowDevLogin && !features?.googleOAuth && !features?.githubOAuth && (
          <p className="muted">OAuth が未設定です。サーバーの環境変数を確認してください。</p>
        )}

        {error && <p style={{ color: "var(--accent)" }}>{error}</p>}
      </div>
    </div>
  );
}
