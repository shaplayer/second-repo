"use client";

import { useState } from "react";
import { supabaseBrowser } from "@/lib/supabase/client";

// Google and Apple buttons appear once each is switched on in Supabase (see .env).
const GOOGLE = process.env.NEXT_PUBLIC_AUTH_GOOGLE === "on";
const APPLE = process.env.NEXT_PUBLIC_AUTH_APPLE === "on";

export default function SignIn({ next = "/", error }: { next?: string; error?: string }) {
  const [email, setEmail] = useState("");
  const [state, setState] = useState<{ busy?: boolean; sent?: boolean; error?: string }>({
    error: error === "expired" ? "That sign-in link expired or was already used. Send a new one." : error ? "Sign-in didn’t finish. Try again." : undefined,
  });

  const oauth = async (provider: "google" | "apple") => {
    const { error } = await supabaseBrowser().auth.signInWithOAuth({
      provider,
      options: { redirectTo: `${window.location.origin}/auth/callback?next=${encodeURIComponent(next)}` },
    });
    if (error) setState({ error: error.message });
  };

  if (state.sent)
    return (
      <div className="modal-body">
        <h2>Check your email</h2>
        <p style={{ margin: 0 }}>
          We sent a sign-in link to <strong>{email}</strong>. Open it on this device and you’re in.
        </p>
        <p className="small muted" style={{ margin: 0 }}>
          Don’t see it? Check spam, or{" "}
          <button className="linkish" onClick={() => setState({})}>
            try again
          </button>
          .
        </p>
      </div>
    );

  return (
    <form
      className="modal-body"
      onSubmit={async (e) => {
        e.preventDefault();
        setState({ busy: true });
        const res = await fetch("/api/auth/email", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ email, next }),
        }).catch(() => null);
        const data = res ? await res.json() : { error: "Couldn’t reach BigStocks." };
        setState(res?.ok ? { sent: true } : { error: data.error });
      }}
    >
      <h2>Sign in or join free</h2>
      <p className="muted" style={{ margin: 0 }}>
        One click, no password. New here? This creates your free account.
      </p>
      {GOOGLE && (
        <button type="button" className="btn" onClick={() => oauth("google")}>
          Continue with Google
        </button>
      )}
      {APPLE && (
        <button type="button" className="btn" onClick={() => oauth("apple")}>
          Continue with Apple
        </button>
      )}
      {(GOOGLE || APPLE) && <div className="or">or</div>}
      <label className="label" htmlFor="signin-email">
        Email
      </label>
      <input id="signin-email" className="field" type="email" required autoComplete="email" placeholder="you@example.com" value={email} onChange={(e) => setEmail(e.target.value)} />
      {state.error && <div className="form-error">{state.error}</div>}
      <button className="btn primary" type="submit" disabled={state.busy}>
        {state.busy ? "Sending…" : "Email me a sign-in link"}
      </button>
    </form>
  );
}
