"use client";

import { AdminSection } from "@/components/admin/AdminSection";
import { NewsSourceForm } from "@/components/admin/NewsSourceForm";

export default function AdminNewsSourcesPage() {
  return <AdminSection title="News sources" section="news-sources">{(sources) => <>
    <p className="m-0 text-sm text-ink-2">
      Switch on a source only after its terms allow our use. Record what was agreed, by whom and when.
      Switching a source off does not remove existing articles or summaries.
    </p>
    {sources.length === 0 ? <p className="m-0 text-sm text-muted">No news sources yet.</p> :
      <div className="flex flex-col">
        {sources.map((source) => <NewsSourceForm key={source.key} source={source} />)}
      </div>}
  </>}</AdminSection>;
}
