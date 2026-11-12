"use client";

import { useEffect, useState } from "react";

type Row = { email: string; plan: "free" | "member"; member_until: string | null; created_at: string };

export default function MemberAdmin() {
  const [rows, setRows] = useState<Row[] | null>(null);
  const [email, setEmail] = useState("");
  const [until, setUntil] = useState("");
  const [msg, setMsg] = useState<{ ok?: string; error?: string }>({});

  const load = () =>
    fetch("/api/admin/members")
      .then((r) => r.json())
      .then((d) => (Array.isArray(d) ? setRows(d) : setMsg({ error: d.error })));
  useEffect(() => {
    load();
  }, []);

  const save = async (addr: string, plan: "free" | "member") => {
    setMsg({});
    const res = await fetch("/api/admin/members", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ email: addr, plan, until }) });
    const data = await res.json();
    if (!res.ok) return setMsg({ error: data.error });
    setMsg({ ok: plan === "member" ? `${addr} is now a member.` : `${addr} is back on the free plan.` });
    setEmail("");
    load();
  };

  return (
    <section className="panel">
      <header>
        <h2>Members</h2>
        <span className="small muted">Granted by hand until payments are added</span>
      </header>
      <form
        className="modal-body"
        onSubmit={(e) => {
          e.preventDefault();
          save(email, "member");
        }}
      >
        <label className="label" htmlFor="mem-email">Email of someone with an account</label>
        <input id="mem-email" className="field" type="email" required value={email} onChange={(e) => setEmail(e.target.value)} />
        <label className="label" htmlFor="mem-until">Member until (leave empty for no end date)</label>
        <input id="mem-until" className="field" type="date" value={until} onChange={(e) => setUntil(e.target.value)} />
        {msg.error && <div className="form-error">{msg.error}</div>}
        {msg.ok && <div className="small up">{msg.ok}</div>}
        <button className="btn primary" type="submit">Make member</button>
      </form>
      <div className="rows">
        {rows?.length === 0 && <div className="empty">No accounts yet.</div>}
        {rows?.map((r) => (
          <div key={r.email} className="row" style={{ gridTemplateColumns: "minmax(0,1fr) auto" }}>
            <span className="small" style={{ minWidth: 0, overflow: "hidden", textOverflow: "ellipsis" }}>
              {r.email}
              <br />
              <span className="muted">
                {r.plan === "member" ? `Member${r.member_until ? ` until ${new Date(r.member_until).toLocaleDateString()}` : ""}` : "Free"}
              </span>
            </span>
            {r.plan === "member" ? (
              <button className="linkish" onClick={() => save(r.email, "free")}>Remove membership</button>
            ) : (
              <button className="linkish" onClick={() => save(r.email, "member")}>Make member</button>
            )}
          </div>
        ))}
      </div>
    </section>
  );
}
