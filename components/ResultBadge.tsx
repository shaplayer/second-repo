import type { AlertResult } from "@/lib/alerts";

const MAP: Record<AlertResult, { label: string; glyph: string; cls: string }> = {
  win: { label: "Win", glyph: "▲", cls: "bg-brand/10 text-brand" },
  loss: { label: "Loss", glyph: "▼", cls: "bg-down/10 text-down" },
  flat: { label: "Flat", glyph: "–", cls: "bg-white/[0.06] text-muted" },
  open: { label: "Open", glyph: "○", cls: "bg-white/[0.06] text-muted" },
};

/** Result never relies on color alone: glyph + label. */
export function ResultBadge({ result }: { result: AlertResult }) {
  const m = MAP[result];
  return (
    <span className={`inline-flex items-center gap-1 rounded-md px-2 py-0.5 text-[12px] font-semibold ${m.cls}`}>
      <span aria-hidden="true" className="text-[10px]">{m.glyph}</span>{m.label}
    </span>
  );
}

export const RESULT_META = MAP;
