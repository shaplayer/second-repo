"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";

export default function AdminLogin() {
  const router = useRouter();
  const [password, setPassword] = useState("");
  const [error, setError] = useState("");
  return (
    <section className="panel" style={{ maxWidth: 420, margin: "48px auto" }}>
      <form
        className="modal-body"
        onSubmit={async (e) => {
          e.preventDefault();
          const res = await fetch("/api/admin/login", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ password }),
          });
          if (res.ok) router.refresh();
          else setError((await res.json()).error ?? "Couldn't sign in.");
        }}
      >
        <h2>Team sign-in</h2>
        <p className="muted small" style={{ margin: 0 }}>
          For BigStocks staff who post picks. The password is ADMIN_PASSWORD in the .env file.
        </p>
        <label className="label" htmlFor="admin-password">
          Password
        </label>
        <input id="admin-password" className="field" type="password" autoComplete="current-password" value={password} onChange={(e) => setPassword(e.target.value)} />
        {error && <div className="form-error">{error}</div>}
        <button className="btn primary" type="submit">
          Sign in
        </button>
      </form>
    </section>
  );
}
