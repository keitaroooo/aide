import { useEffect, useState, type FormEvent } from "react";
import { registerSW } from "virtual:pwa-register";
import { client } from "../lib/api";
import { useAuth } from "../lib/auth";

function urlBase64ToUint8Array(base64String: string): Uint8Array {
  const padding = "=".repeat((4 - (base64String.length % 4)) % 4);
  const base64 = (base64String + padding).replace(/-/g, "+").replace(/_/g, "/");
  const raw = atob(base64);
  const out = new Uint8Array(raw.length);
  for (let i = 0; i < raw.length; i++) out[i] = raw.charCodeAt(i);
  return out;
}

export function SettingsPage() {
  const { user, features, links, refresh, logout } = useAuth();
  const [digest, setDigest] = useState(user?.digest_time ?? "07:00");
  const [timezone, setTimezone] = useState(user?.timezone ?? "Asia/Tokyo");
  const [projectNumber, setProjectNumber] = useState("8");
  const [msg, setMsg] = useState<string | null>(null);

  useEffect(() => {
    registerSW({ immediate: true });
  }, []);

  useEffect(() => {
    if (user) {
      setDigest(user.digest_time);
      setTimezone(user.timezone);
    }
  }, [user]);

  async function save(e: FormEvent) {
    e.preventDefault();
    await client.settings({ digest_time: digest, timezone });
    await refresh();
    setMsg("設定を保存しました");
  }

  async function enablePush() {
    if (!features?.vapidPublicKey) {
      setMsg("VAPID が未設定です");
      return;
    }
    const permission = await Notification.requestPermission();
    if (permission !== "granted") {
      setMsg("通知が許可されませんでした");
      return;
    }
    const reg = await navigator.serviceWorker.ready;
    const sub = await reg.pushManager.subscribe({
      userVisibleOnly: true,
      applicationServerKey: urlBase64ToUint8Array(features.vapidPublicKey) as BufferSource,
    });
    await client.pushSubscribe(sub.toJSON());
    setMsg("Push を登録しました");
  }

  return (
    <div className="stack fade-in">
      <header>
        <h1 className="brand">設定</h1>
        <p className="muted">{user?.email || user?.name}</p>
      </header>

      <form className="card stack" onSubmit={(e) => void save(e)}>
        <label>
          <div className="muted">朝のダイジェスト時刻</div>
          <input
            className="field"
            type="time"
            value={digest}
            onChange={(e) => setDigest(e.target.value)}
          />
        </label>
        <label>
          <div className="muted">タイムゾーン</div>
          <input
            className="field"
            value={timezone}
            onChange={(e) => setTimezone(e.target.value)}
          />
        </label>
        <button className="btn primary">保存</button>
      </form>

      <section className="card stack">
        <h2 style={{ margin: 0, fontFamily: "var(--font-display)", fontSize: "1.2rem" }}>
          連携
        </h2>
        <div className="row" style={{ flexWrap: "wrap" }}>
          {features?.googleOAuth ? (
            <a className="btn" href="/api/auth/google">
              Google {links?.google ? "再連携" : "接続"}
            </a>
          ) : (
            <span className="muted">Google OAuth 未設定</span>
          )}
          {features?.githubOAuth ? (
            <a className="btn" href="/api/auth/github">
              GitHub {links?.github ? "再連携" : "接続"}
            </a>
          ) : (
            <span className="muted">GitHub OAuth 未設定</span>
          )}
        </div>

        <div className="row" style={{ flexWrap: "wrap" }}>
          <button
            className="btn"
            disabled={!links?.google}
            onClick={() =>
              void client
                .importGoogleTasks()
                .then((r) => setMsg(`Tasks: +${r.imported} / skip ${r.skipped}`))
                .catch((e) => setMsg(e.message))
            }
          >
            Google Tasks 取込
          </button>
          <button
            className="btn"
            disabled={!links?.google}
            onClick={() =>
              void client
                .importGoogleCalendar()
                .then((r) => setMsg(`Calendar: +${r.imported} / skip ${r.skipped}`))
                .catch((e) => setMsg(e.message))
            }
          >
            Calendar 取込
          </button>
        </div>

        <div className="row">
          <input
            className="field"
            style={{ maxWidth: 100 }}
            value={projectNumber}
            onChange={(e) => setProjectNumber(e.target.value)}
            placeholder="#"
          />
          <button
            className="btn"
            disabled={!links?.github}
            onClick={() =>
              void client
                .importGitHub(Number(projectNumber) || 1)
                .then((r) =>
                  setMsg(`GitHub ${r.project ?? ""}: +${r.imported} / skip ${r.skipped}`),
                )
                .catch((e) => setMsg(e.message))
            }
          >
            Projects 取込
          </button>
        </div>
      </section>

      <section className="card stack">
        <h2 style={{ margin: 0, fontFamily: "var(--font-display)", fontSize: "1.2rem" }}>
          通知
        </h2>
        <button className="btn accent" onClick={() => void enablePush()}>
          Web Push を有効化
        </button>
        <button
          className="btn"
          onClick={() =>
            void client
              .pushTest()
              .then((r) => setMsg(`送信 ${r.sent}件\n${r.body}`))
              .catch((e) => setMsg(e.message))
          }
        >
          テスト送信
        </button>
      </section>

      <button className="btn ghost" onClick={() => void logout()}>
        ログアウト
      </button>

      {msg && (
        <pre className="card" style={{ whiteSpace: "pre-wrap", margin: 0 }}>
          {msg}
        </pre>
      )}
    </div>
  );
}
