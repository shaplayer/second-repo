"use client";

import { useEffect, useState } from "react";

type Row = { id: number; user_id: string; display_name: string; body: string; hidden: boolean; report_count: number; created_at: string };

/** Moderators: review reported messages, hide or restore them, and turn off chat for abusive users. */
export default function ChatAdmin() {
  const [rows, setRows] = useState<Row[] | null>(null);
  const load = () => fetch("/api/admin/chat").then((r) => r.json()).then((d) => setRows(Array.isArray(d) ? d : []));
  useEffect(() => {
    load();
  }, []);
  const act = async (body: object) => {
    await fetch("/api/admin/chat", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
    load();
  };
  return (
    <section className="panel">
      <header>
        <h2>Chat moderation</h2>
        <span className="small muted">Reported or hidden messages</span>
      </header>
      <div className="rows">
        {rows?.length === 0 && <div className="empty">Nothing reported.</div>}
        {rows?.map((r) => (
          <div key={r.id} className="msg">
            <div className="who">
              {r.display_name} <span>{new Date(r.created_at).toLocaleString()}</span>
              <span>
                {r.report_count} report{r.report_count === 1 ? "" : "s"}
                {r.hidden ? " · hidden" : ""}
              </span>
            </div>
            <div className="msg-body">{r.body}</div>
            <div style={{ display: "flex", gap: 12 }}>
              <button className="linkish" onClick={() => act({ id: r.id, hidden: !r.hidden })}>
                {r.hidden ? "Restore message" : "Hide message"}
              </button>
              <button
                className="linkish"
                style={{ color: "var(--down)" }}
                onClick={() => window.confirm(`Turn off chat for ${r.display_name} and hide all their messages?`) && act({ userId: r.user_id, banned: true })}
              >
                Ban from chat
              </button>
            </div>
          </div>
        ))}
      </div>
    </section>
  );
}
