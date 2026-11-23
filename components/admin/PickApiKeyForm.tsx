"use client";

import { useState } from "react";

export function PickApiKeyForm() {
  const [busy, setBusy] = useState(false);
  const [key, setKey] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  return (
    <form className="flex flex-col gap-3" onSubmit={async (event) => {
      event.preventDefault();
      const form = event.currentTarget;
      const name = String(new FormData(form).get("name") ?? "");
      setBusy(true);
      setError(null);
      setKey(null);
      try {
        const response = await fetch("/api/admin/pick-api-keys", {
          method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ name }),
        });
        const data = await response.json();
        if (!response.ok || !data.ok) {
          setError(data.error ?? "Could not create the API key.");
        } else {
          setKey(data.key);
          form.reset();
        }
      } catch {
        setError("Could not create the API key. Please try again.");
      } finally {
        setBusy(false);
      }
    }}>
      <p className="m-0 text-sm text-ink-2">Give each application its own key. It can publish picks and send emails to the pick list.</p>
      <label className="flex flex-col gap-1 text-sm font-bold">Application name
        <input name="name" required maxLength={100} className="field" />
      </label>
      <button type="submit" disabled={busy} className="btn btn-dark self-start">{busy ? "Creating…" : "Create API key"}</button>
      {key && <div role="status" className="min-w-0 text-sm">
        <p className="font-bold">Copy this key now. It will not be shown again.</p>
        <code className="block select-all break-all">{key}</code>
      </div>}
      {error && <p role="alert" className="m-0 text-sm text-bad">{error}</p>}
    </form>
  );
}
