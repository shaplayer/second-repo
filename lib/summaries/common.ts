/** Raise this whenever SYSTEM or SCHEMA changes, so old and new summaries can be told apart. */
export const PROMPT_VERSION = 2;

export const SYSTEM = `You explain SEC filings and company press releases to everyday investors who have never read one and don't want to learn the jargon.

Write at an 8th-grade reading level. Use short sentences. Never use terms like "8-K", "10-Q", "EPS", "GAAP", "guidance", "Item 2.02" or "material definitive agreement" without saying what they mean in plain words - better, just say the plain words.

When the document has numbers, give the most important ones and compare them to a year ago when the document does (for example: "Sales were $94 billion, up 6% from a year ago"). Round big numbers ("$94 billion", not "$94,036 million"). Use only numbers that are in the document.

Report what the document says. Do not tell the reader to buy, sell or hold the stock, do not predict the stock price, and do not mention the stock price or how it moved.

A press release is written by the company to sound good. Report the facts in it plainly, without its promotional language.`;

export const SCHEMA = {
  type: "object",
  additionalProperties: false,
  required: ["headline", "one_sentence", "bullets", "tone", "importance"],
  properties: {
    headline: { type: "string", description: "What happened, in 12 words or fewer. No jargon. No company name or ticker at the start." },
    one_sentence: { type: "string", description: "The whole story in one plain sentence of at most 30 words." },
    bullets: {
      type: "array",
      items: { type: "string" },
      description: "2 to 4 short points with the key facts and numbers from the document. One sentence each.",
    },
    tone: {
      type: "string",
      enum: ["Good news", "Bad news", "Mixed", "Routine"],
      description: "For the company's business, is this news good, bad, mixed, or routine paperwork?",
    },
    importance: { type: "string", enum: ["High", "Medium", "Low"], description: "How much a typical shareholder should care." },
  },
} as const;

export type SummaryInput = {
  company: string;
  ticker: string | null;
  /** "Quarterly report", "Company news", "Press release"... */
  typeLabel: string;
  /** The official form code, if it is a filing. */
  formCode: string | null;
  text: string;
  /** True when part of a very long document was left out (the prompt says so). */
  shortened: boolean;
};

export type SummaryOutput = {
  headline: string;
  oneSentence: string;
  bullets: string[];
  tone: "Good news" | "Bad news" | "Mixed" | "Routine";
  importance: "High" | "Medium" | "Low";
  /** The model that actually wrote it (the fallback model's name when the first one declined). */
  model: string;
  inputTokens: number;
  outputTokens: number;
};

/** The model declined (and so did the fallback), or the answer could not be used. Not worth retrying. */
export class SummaryRefused extends Error {}

export type Summarizer = (input: SummaryInput) => Promise<SummaryOutput>;

export const clean = (s: unknown, max: number) => String(s ?? "").replace(/\s+/g, " ").trim().slice(0, max);