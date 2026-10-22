import { useState, type FormEvent } from "react";
import { client } from "../lib/api";
import { useAuth } from "../lib/auth";
import { AIDE_ROLE } from "../lib/principle";

export function LoginPage() {
  const { features, refresh } = useAuth();
  const [email, setEmail] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function accessLogin() {
    setBusy(true);
    setError(null);
    try {
      await client.accessLogin();
      await refresh();
    } catch (e) {
      setError(e instanceof Error ? e.message : "login failed");
    } finally {
      setBusy(false);
    }
  }

  async function ownerLogin(e: FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      await client.ownerLogin(email);
      await refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : "login failed");
    } finally {
      setBusy(false);
    }
  }

  const accessOk = Boolean(features?.accessLogin);

  return (
    <div className="login-screen">
      <div className="login-panel card fade-in stack">
        <h1>Aide</h1>
        <p className="muted" style={{ margin: 0 }}>
          {AIDE_ROLE}
        </p>

        {accessOk ? (
          <>
            <p className="muted" style={{ margin: 0, fontSize: "0.85rem" }}>
              メール認証済み
            </p>
            <button className="btn primary" disabled={busy} onClick={() => void accessLogin()}>
              {busy ? "…" : "続ける"}
            </button>
          </>
        ) : features?.allowDevLogin ? (
          <form className="stack" onSubmit={(e) => void ownerLogin(e)}>
            <p className="muted" style={{ margin: 0, fontSize: "0.85rem" }}>
              一旦は個人用のみ
            </p>
            <label className="muted" htmlFor="owner-email">
              メールアドレス
            </label>
            <input
              id="owner-email"
              className="field"
              type="email"
              autoComplete="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              required
            />
            <button className="btn primary" disabled={busy}>
              {busy ? "…" : "メールで入る"}
            </button>
          </form>
        ) : (
          <p className="muted" style={{ margin: 0, fontSize: "0.85rem" }}>
            本番は Access のメール認証のあと「続ける」
          </p>
        )}

        {error && <p style={{ color: "var(--accent)" }}>{error}</p>}
      </div>
    </div>
  );
}
