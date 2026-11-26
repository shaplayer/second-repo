"use client";

import { useQueryClient } from "@tanstack/react-query";
import React, { useState } from "react";
import { adminKey } from "@/lib/admin-query";
import type { NewsSource, NewsSourceSettings } from "@/lib/data/news-sources";

function settingsOf(source: NewsSource): NewsSourceSettings {
  return {
    enabled: source.enabled, can_store_body: source.can_store_body,
    can_summarize: source.can_summarize, terms_note: source.terms_note,
  };
}

export function NewsSourceForm({ source }: { source: NewsSource }) {
  const client = useQueryClient();
  const [original, setOriginal] = useState(() => settingsOf(source));
  const [settings, setSettings] = useState(() => settingsOf(source));
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<{ error: boolean; text: string } | null>(null);
  const changedElsewhere = JSON.stringify(original) !== JSON.stringify(settingsOf(source));

  if (source.key === "sec") return <section className="flex flex-col gap-3 border-t border-line-soft py-5">
    <div className="flex flex-wrap items-center gap-3">
      <h3 className="m-0 break-words text-base font-bold">{source.name}</h3>
      <span className="chip text-xs">Always on</span>
    </div>
    <div className="flex flex-wrap gap-x-6 gap-y-1 text-sm text-ink-2">
      <span>Store text: {source.can_store_body ? "Yes" : "No"}</span>
      <span>AI summaries: {source.can_summarize ? "Yes" : "No"}</span>
    </div>
    <p className="m-0 break-words text-sm text-muted"><strong>Terms note:</strong> {source.terms_note || "None"}</p>
  </section>;

  return <form className="flex min-w-0 flex-col gap-4 border-t border-line-soft py-5" onSubmit={async (event) => {
    event.preventDefault();
    setBusy(true);
    setMessage(null);
    try {
      const response = await fetch("/api/admin/news-sources", {
        method: "POST", headers: { "content-type": "application/json" },
        body: JSON.stringify({ key: source.key, settings, original }),
      });
      const result = await response.json();
      if (!response.ok || !result.ok) {
        setMessage({ error: true, text: result.error ?? "Could not save the news source." });
        if (response.status === 409) void client.invalidateQueries({ queryKey: adminKey("news-sources") });
      } else {
        const saved = settingsOf(result.source);
        setOriginal(saved);
        setSettings(saved);
        client.setQueryData<NewsSource[]>(adminKey("news-sources"), (sources) =>
          sources?.map((item) => item.key === source.key ? result.source : item));
        setMessage({ error: false, text: "Saved." });
      }
    } catch {
      setMessage({ error: true, text: "Could not save the news source. Please try again." });
    } finally {
      setBusy(false);
    }
  }}>
    <div className="flex items-start justify-between gap-3">
      <div className="flex min-w-0 flex-1 flex-wrap items-center gap-3">
        <h3 className="m-0 break-words text-base font-bold">{source.name}</h3>
        <span className="chip text-xs">{settings.enabled ? "On" : "Off"}</span>
      </div>
      <button className="btn btn-dark shrink-0" type="submit" disabled={busy || changedElsewhere}
        aria-label={`Save ${source.name}`}>
        {busy ? "Saving…" : "Save"}
      </button>
    </div>
    <div className="flex flex-wrap gap-x-6 gap-y-3">
      <label className="flex min-h-11 cursor-pointer items-center gap-2 text-sm text-ink-2">
        <input type="checkbox" checked={settings.enabled} disabled={busy}
          aria-label={`Enable ${source.name}`}
          className="h-4 w-4 accent-brand"
          onChange={(event) => setSettings({ ...settings, enabled: event.target.checked })} />
        Enabled
      </label>
      <label className="flex min-h-11 cursor-pointer items-center gap-2 text-sm text-ink-2">
        <input type="checkbox" checked={settings.can_store_body} disabled={busy}
          aria-label={`Allow storing article text from ${source.name}`}
          className="h-4 w-4 accent-brand"
          onChange={(event) => setSettings({ ...settings, can_store_body: event.target.checked })} />
        May store article text
      </label>
      <label className="flex min-h-11 cursor-pointer items-center gap-2 text-sm text-ink-2">
        <input type="checkbox" checked={settings.can_summarize} disabled={busy}
          aria-label={`Allow AI summaries for ${source.name}`}
          className="h-4 w-4 accent-brand"
          onChange={(event) => setSettings({ ...settings, can_summarize: event.target.checked })} />
        May create AI summaries
      </label>
    </div>
    <label className="flex min-w-0 flex-col gap-2 text-sm font-bold">
      Terms note <span className="sr-only">for {source.name}</span>
      <textarea className="field !min-h-[72px] resize-y font-normal" rows={2} maxLength={10000} value={settings.terms_note ?? ""}
        disabled={busy} onChange={(event) => setSettings({ ...settings, terms_note: event.target.value })} />
    </label>
    {changedElsewhere && <p role="alert" className="m-0 text-sm text-amber">
      These settings changed elsewhere.
      <button type="button" className="btn btn-soft mt-2 max-w-full whitespace-normal" onClick={() => {
        setOriginal(settingsOf(source));
        setSettings(settingsOf(source));
        setMessage(null);
      }}>Load latest settings</button>
    </p>}
    {message && <p role={message.error ? "alert" : "status"} className={`m-0 text-sm ${message.error ? "text-bad" : "text-muted"}`}>{message.text}</p>}
  </form>;
}
