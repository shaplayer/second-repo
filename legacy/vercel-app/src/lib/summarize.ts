import Anthropic from "@anthropic-ai/sdk";
import { filingText, insiderTrades } from "./filingText";
import { categoryOf, explain } from "./plain";
import type { Filing } from "./sec";
import { getSummary, saveSummary, type Summary } from "./store";

let client: Anthropic | null = null;
const claude = () => {
  if (!process.env.ANTHROPIC_API_KEY) throw new Error("ANTHROPIC_API_KEY is missing from .env");
  return (client ??= new Anthropic());
};

const SYSTEM = `You explain SEC filings to everyday investors who have never read one and don't want to learn the jargon.

Write at an 8th-grade reading level. Use short sentences. Never use terms like "8-K", "10-Q", "EPS", "GAAP", "guidance", "Item 2.02" or "material definitive agreement" without saying what they mean in plain words - better, just say the plain words.

When the filing has numbers, give the most important ones and compare them to a year ago (for example: "Sales were $94 billion, up 6% from a year ago"). Round big numbers ("$94 billion", not "$94,036 million").

Report what the filing says. Do not tell the reader to buy, sell or hold the stock, and do not predict the stock price.`;

const SCHEMA = {
  type: "object",
  additionalProperties: false,
  required: ["headline", "bullets", "why_it_matters", "tone", "importance"],
  properties: {
    headline: { type: "string", description: "What happened, in 12 words or fewer. No jargon." },
    bullets: {
      type: "array",
      items: { type: "string" },
      description: "2 to 4 short points covering the key facts and numbers.",
    },
    why_it_matters: { type: "string", description: "One or two sentences on what this means for the company." },
    tone: {
      type: "string",
      enum: ["Good news", "Bad news", "Mixed", "Routine"],
      description: "For the company's business, is this news good, bad, mixed, or routine paperwork?",
    },
    importance: {
      type: "string",
      enum: ["High", "Medium", "Low"],
      description: "How much a typical shareholder should care.",
    },
  },
} as const;

type ClaudeSummary = {
  headline: string;
  bullets: string[];
  why_it_matters: string;
  tone: Summary["tone"];
  importance: Summary["importance"];
};

export type FilingRef = Filing & { cik: number; ticker: string; companyName: string };

const money = (n: number) => "$" + n.toLocaleString("en-US", { maximumFractionDigits: n >= 1000 ? 0 : 2 });

async function summarizeInsider(f: FilingRef): Promise<Omit<Summary, "accession" | "createdAt">> {
  const trades = await insiderTrades(f.cik, f.accession, f.primaryDocument);
  const buys = trades.filter((t) => t.action === "bought");
  const sells = trades.filter((t) => t.action === "sold");
  const owner = trades[0]?.owner ?? "An insider";
  const role = trades[0]?.role ?? "Insider";
  const total = (ts: typeof trades) => ts.reduce((s, t) => s + t.shares, 0);
  const value = (ts: typeof trades) => ts.reduce((s, t) => s + t.shares * (t.price ?? 0), 0);
  const line = (verb: string, ts: typeof trades) =>
    `${verb} ${total(ts).toLocaleString("en-US")} shares${value(ts) ? ` worth about ${money(value(ts))}` : ""}.`;

  const headline = buys.length
    ? `${role} bought ${total(buys).toLocaleString("en-US")} shares`
    : sells.length
      ? `${role} sold ${total(sells).toLocaleString("en-US")} shares`
      : `${role} reported a change in their shares`;
  const bullets = [
    `Who: ${owner} (${role}).`,
    ...(buys.length ? [line("Bought", buys)] : []),
    ...(sells.length ? [line("Sold", sells)] : []),
    ...(!buys.length && !sells.length ? ["Shares were granted, converted or given away, not bought or sold on the market."] : []),
  ];
  return {
    ticker: f.ticker,
    companyName: f.companyName,
    form: f.form,
    accepted: f.accepted,
    url: f.url,
    headline,
    bullets,
    whyItMatters: buys.length
      ? "Insiders buying with their own money is often read as confidence in the company."
      : sells.length
        ? "Insiders sell for many reasons, like taxes or planned sales, so one sale isn't a warning sign by itself."
        : "This is routine paperwork about an insider's stock awards.",
    tone: buys.length ? "Good news" : "Routine",
    importance: buys.length && value(buys) > 100_000 ? "Medium" : "Low",
    category: "insider",
  };
}

async function summarizeWithClaude(f: FilingRef): Promise<Omit<Summary, "accession" | "createdAt">> {
  const text = await filingText(f.cik, f.accession, f.primaryDocument);
  const plain = explain(f);
  const response = await claude().beta.messages.create({
    model: "claude-opus-5-5",
    max_tokens: 16000,
    betas: ["server-side-fallback-2026-07-01"],
    fallbacks: "default",
    system: SYSTEM,
    output_config: {
      effort: "low",
      format: { type: "json_schema", schema: SCHEMA },
    },
    messages: [
      {
        role: "user",
        content: `Company: ${f.companyName} (${f.ticker})\nFiling: ${plain?.title ?? f.form} (official form ${f.form})\n\n<filing>\n${text}\n</filing>\n\nSummarize this filing for an everyday investor.`,
      },
    ],
  });
  if (response.stop_reason === "refusal") throw new Error("Claude declined to summarize this filing");
  if (response.stop_reason === "max_tokens") throw new Error("Summary was cut off");
  const out = response.content.find((b) => b.type === "text");
  if (!out || out.type !== "text") throw new Error("No summary returned");
  const s = JSON.parse(out.text) as ClaudeSummary;
  return {
    ticker: f.ticker,
    companyName: f.companyName,
    form: f.form,
    accepted: f.accepted,
    url: f.url,
    headline: s.headline,
    bullets: s.bullets.slice(0, 4),
    whyItMatters: s.why_it_matters,
    tone: s.tone,
    importance: s.importance,
    category: categoryOf(f) ?? "news",
  };
}

const inFlight = new Map<string, Promise<Summary>>();

/** Plain-English summary of a filing. Each filing is summarized once, then reused for every reader. */
export async function summarize(f: FilingRef): Promise<Summary> {
  const existing = await getSummary(f.accession);
  if (existing) return existing;
  const pending = inFlight.get(f.accession);
  if (pending) return pending;
  const job = (async () => {
    const body = f.form === "4" ? await summarizeInsider(f) : await summarizeWithClaude(f);
    const summary: Summary = { ...body, accession: f.accession, createdAt: new Date().toISOString() };
    await saveSummary(summary);
    return summary;
  })().finally(() => inFlight.delete(f.accession));
  inFlight.set(f.accession, job);
  return job;
}
