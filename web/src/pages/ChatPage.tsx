import { useEffect, useRef, useState, type FormEvent } from "react";
import { client } from "../lib/api";

export function ChatPage() {
  const [messages, setMessages] = useState<Array<{ id: string; role: "user" | "assistant"; content: string }>>(
    [],
  );
  const [text, setText] = useState("");
  const [busy, setBusy] = useState(false);
  const bottomRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    void client.chatHistory().then((d) => setMessages(d.messages));
  }, []);

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages]);

  async function send(e: FormEvent) {
    e.preventDefault();
    if (!text.trim() || busy) return;
    const content = text.trim();
    setText("");
    setBusy(true);
    setMessages((m) => [...m, { id: crypto.randomUUID(), role: "user", content }]);
    try {
      const res = await client.chat(content);
      setMessages((m) => [
        ...m,
        { id: crypto.randomUUID(), role: "assistant", content: res.reply },
      ]);
    } catch (err) {
      setMessages((m) => [
        ...m,
        {
          id: crypto.randomUUID(),
          role: "assistant",
          content: err instanceof Error ? err.message : "エラー",
        },
      ]);
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="stack fade-in">
      <header>
        <h1 className="brand">アシスタント</h1>
        <p className="muted">
          「今日やることは？」「これはいつかでいい」— 優先は言葉で。勝手にランキングはしません。
        </p>
      </header>

      <div className="card chat-log">
        {messages.length === 0 && (
          <p className="muted">まだ会話がありません。話しかけてみてください。</p>
        )}
        {messages.map((m) => (
          <div key={m.id} className={`bubble ${m.role}`}>
            {m.content}
          </div>
        ))}
        <div ref={bottomRef} />
      </div>

      <form className="row" onSubmit={(e) => void send(e)}>
        <input
          className="field"
          placeholder="アシスタントに伝える…"
          value={text}
          onChange={(e) => setText(e.target.value)}
        />
        <button className="btn primary" disabled={busy}>
          {busy ? "…" : "送る"}
        </button>
      </form>
    </div>
  );
}
