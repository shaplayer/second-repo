"use client";

import Link from "next/link";
import { Fragment, useEffect, useRef, useState } from "react";
import type { ChatMessage } from "@/lib/chat";
import { supabaseBrowser } from "@/lib/supabase/client";

type Me = { name: string | null; banned: boolean } | null;

const time = (iso: string) => {
  const d = new Date(iso);
  const today = d.toDateString() === new Date().toDateString();
  return today
    ? d.toLocaleTimeString("en-US", { hour: "numeric", minute: "2-digit" })
    : d.toLocaleDateString("en-US", { month: "short", day: "numeric" }) + ", " + d.toLocaleTimeString("en-US", { hour: "numeric", minute: "2-digit" });
};

/** Message text with $TICKER mentions turned into links to that stock. */
function Body({ text, tickers }: { text: string; tickers: string[] }) {
  const parts = text.split(/(\$[A-Za-z]{1,5}(?:\.[A-Za-z])?\b)/g);
  return (
    <>
      {parts.map((p, i) => {
        const t = p.startsWith("$") ? p.slice(1).toUpperCase() : "";
        return t && tickers.includes(t) ? (
          <Link key={i} href={`/stock/${t}`} className="mention">
            ${t}
          </Link>
        ) : (
          <Fragment key={i}>{p}</Fragment>
        );
      })}
    </>
  );
}

/** The everyone room, or one stock's room when `ticker` is set. New messages arrive live. */
export default function Chat({ ticker, compact = false }: { ticker?: string; compact?: boolean }) {
  const [messages, setMessages] = useState<ChatMessage[] | null>(null);
  const [me, setMe] = useState<Me>(null);
  const [text, setText] = useState("");
  const [name, setName] = useState("");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const [reported, setReported] = useState<number[]>([]);
  const list = useRef<HTMLDivElement>(null);

  useEffect(() => {
    let live = true;
    fetch(`/api/chat${ticker ? `?ticker=${ticker}` : ""}`)
      .then((r) => r.json())
      .then((d) => {
        if (!live) return;
        setMessages(d.messages ?? []);
        setMe(d.me);
      })
      .catch(() => setMessages([]));

    const channel = supabaseBrowser()
      .channel(`chat-${ticker ?? "all"}`)
      .on("postgres_changes", { event: "INSERT", schema: "public", table: "chat_messages" }, (payload) => {
        const m = payload.new as ChatMessage & { hidden?: boolean };
        if (m.hidden || (ticker && !m.tickers.includes(ticker))) return;
        setMessages((prev) => (prev && !prev.some((x) => x.id === m.id) ? [...prev, m].slice(-200) : prev));
      })
      .on("postgres_changes", { event: "INSERT", schema: "public", table: "chat_hidden" }, (payload) => {
        const id = (payload.new as { message_id: number }).message_id;
        setMessages((prev) => prev?.filter((x) => x.id !== id) ?? prev);
      })
      .subscribe();
    return () => {
      live = false;
      supabaseBrowser().removeChannel(channel);
    };
  }, [ticker]);

  useEffect(() => {
    if (list.current) list.current.scrollTop = list.current.scrollHeight;
  }, [messages]);

  const post = async (e: React.FormEvent) => {
    e.preventDefault();
    const body = ticker && !new RegExp(`\\$${ticker.replace(".", "\\.")}\\b`, "i").test(text) ? `$${ticker} ${text}` : text;
    setBusy(true);
    setError("");
    const res = await fetch("/api/chat", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ body }) }).catch(() => null);
    const data = res ? await res.json() : { error: "Couldn’t reach BigStocks." };
    setBusy(false);
    if (!res?.ok) return setError(data.error);
    setText("");
  };

  const pickName = async (e: React.FormEvent) => {
    e.preventDefault();
    setError("");
    const res = await fetch("/api/chat/name", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ name }) });
    const data = await res.json();
    if (!res.ok) return setError(data.error);
    setMe((m) => (m ? { ...m, name: data.name } : m));
  };

  const report = async (id: number) => {
    setReported((r) => [...r, id]);
    await fetch("/api/chat/report", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ id }) });
  };

  return (
    <section className="panel chat">
      <header>
        <h2>{ticker ? `$${ticker} chat` : "Everyone chat"}</h2>
        <span className="live">{ticker ? `Posts that mention $${ticker}` : "Live"}</span>
      </header>
      <div className="chat-list rows" ref={list} style={{ maxHeight: compact ? 340 : 520 }}>
        {messages === null && <div className="empty">Loading chat…</div>}
        {messages?.length === 0 && (
          <div className="empty">{ticker ? `No one has mentioned $${ticker} yet. Start the conversation.` : "No messages yet. Say hello."}</div>
        )}
        {messages?.map((m) => (
          <div key={m.id} className="msg">
            <div className="who">
              {m.display_name} <span>{time(m.created_at)}</span>
              {me && (
                <button className="rep" onClick={() => report(m.id)} disabled={reported.includes(m.id)}>
                  {reported.includes(m.id) ? "Reported" : "Report"}
                </button>
              )}
            </div>
            <div className="msg-body">
              <Body text={m.body} tickers={m.tickers} />
            </div>
          </div>
        ))}
      </div>
      {!me && (
        <div className="chat-foot">
          <Link href={`/signin?next=${ticker ? `/stock/${ticker}?tab=chat` : "/"}`} className="btn primary">
            Sign in to chat
          </Link>
          <span className="small muted">Free, one click.</span>
        </div>
      )}
      {me?.banned && <div className="chat-foot small muted">Your chat access has been turned off by a moderator.</div>}
      {me && !me.banned && !me.name && (
        <form className="chat-foot" onSubmit={pickName}>
          <input id="chat-name" className="field" placeholder="Pick a chat name, e.g. value_hunter" value={name} onChange={(e) => setName(e.target.value)} aria-label="Chat name" />
          <button className="btn primary" type="submit">
            Save
          </button>
        </form>
      )}
      {me && !me.banned && me.name && (
        <form className="chat-foot" onSubmit={post}>
          <input
            id={`chat-input-${ticker ?? "all"}`}
            className="field"
            maxLength={500}
            autoComplete="off"
            placeholder={ticker ? `Talk about $${ticker}` : "Mention a stock like $AAPL to post it to that stock’s chat too"}
            value={text}
            onChange={(e) => setText(e.target.value)}
            aria-label="Chat message"
          />
          <button className="btn primary" type="submit" disabled={busy || !text.trim()}>
            Post
          </button>
        </form>
      )}
      {error && <div className="form-error chat-err">{error}</div>}
      <div className="disc chat-rules">Be civil. No links, no spam, no paid promotion. Chat is people’s opinions, not investment advice.</div>
    </section>
  );
}
