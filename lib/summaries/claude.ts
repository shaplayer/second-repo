/**
 * The one place the site calls Claude: turning a filing or press release into a plain-English summary.
 *
 * - Model claude-opus-5-5, low effort, answer as JSON that must match SCHEMA.
 * - If the model declines for a safety reason, the API retries on a fallback model in the same call
 *   (`fallbacks: "default"`); if that also declines, no summary is saved.
 * - The result is always shown with "AI-generated summary. Can contain mistakes." and a link to the
 *   original, so the prompt asks only for what the document says: never advice.
 */
import Anthropic from "@anthropic-ai/sdk";

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

function requiredEnv(name: string): string {
  const value = process.env[name]?.trim();
  if (!value) throw new Error(`${name} is required for the selected summary provider.`);
  return value;
}

function summarymodel(): string {
  const provider = process.env.SUMMARY_PROVIDER?.trim();
  switch (provider) {
    case "anthropic":
      return requiredEnv("ANTHROPIC_SUMMARY_MODEL");
    case "openrouter":
      return requiredEnv("OPENROUTER_SUMMARY_MODEL");
    case "local":
      return requiredEnv("LOCAL_SUMMARY_MODEL");
    default:
      throw new Error("SUMMARY_PROVIDER must be anthropic, openrouter, or local.");
  }
}

let client: Anthropic | null = null;
const anthropic = () => {
  const provider = process.env.SUMMARY_PROVIDER?.trim();
  switch (provider) {
    case "anthropic":
      return new Anthropic({
        baseURL: "https://api.anthropic.com",
        apiKey: requiredEnv("ANTHROPIC_API_KEY"),
      });

    case "openrouter":
      return new Anthropic({
        baseURL: requiredEnv("OPENROUTER_BASE_URL"),
        authToken: requiredEnv("OPENROUTER_API_KEY"),
      });

    case "local":
      return new Anthropic({
        baseURL: requiredEnv("LOCAL_SUMMARY_BASE_URL"),
        authToken: requiredEnv("LOCAL_SUMMARY_AUTH_TOKEN"),
      });

    case undefined:
    case "":
      return null;

    default:
      throw new Error("SUMMARY_PROVIDER must be anthropic, openrouter, or local.");
  }
};

const clean = (s: unknown, max: number) => String(s ?? "").replace(/\s+/g, " ").trim().slice(0, max);

/** Checks and tidies what the model returned. Throws SummaryRefused when it cannot be shown. */
export function parseSummary(json: string): Pick<SummaryOutput, "headline" | "oneSentence" | "bullets" | "tone" | "importance"> {
  let raw: Record<string, unknown>;
  try {
    raw = JSON.parse(json);
  } catch {
    throw new SummaryRefused("The summary came back in a form that could not be read.");
  }
  const headline = clean(raw.headline, 160);
  const oneSentence = clean(raw.one_sentence, 400);
  const bullets = (Array.isArray(raw.bullets) ? raw.bullets : []).map((b) => clean(b, 300)).filter(Boolean).slice(0, 4);
  const tone = (SCHEMA.properties.tone.enum as readonly string[]).includes(String(raw.tone)) ? (raw.tone as SummaryOutput["tone"]) : "Routine";
  const importance = (SCHEMA.properties.importance.enum as readonly string[]).includes(String(raw.importance))
    ? (raw.importance as SummaryOutput["importance"])
    : "Medium";
  if (!headline || !oneSentence) throw new SummaryRefused("The summary came back empty.");
  // The site never gives advice. A summary that slips into it is not shown.
  if (/\b(you should|we recommend|investors should)\b[^.]{0,40}\b(buy|sell|hold)\b/i.test(`${headline} ${oneSentence} ${bullets.join(" ")}`)) {
    throw new SummaryRefused("The summary read like advice, so it was not kept.");
  }
  return { headline, oneSentence, bullets, tone, importance };
}

export function userPrompt(i: SummaryInput): string {
  const name = i.ticker ? `${i.company} (${i.ticker})` : i.company;
  const kind = i.formCode ? `${i.typeLabel} (official form ${i.formCode})` : i.typeLabel;
  const note = i.shortened ? "\nThe document is very long, so only its main parts are included below. Summarize what is here.\n" : "";
  return `Company: ${name}\nDocument: ${kind}\n${note}\n<document>\n${i.text}\n</document>\n\nSummarize this document for an everyday investor.`;
}

/** Asks Claude for the summary. Throws SummaryRefused when it declines; other errors are worth retrying. */
export const summarizeWithAnthropic: Summarizer = async (input) => {
  try {
    const client = anthropic();
    if (!client) throw new Error("SUMMARY_PROVIDER is not set, so summaries cannot be written.");
    if(process.env.SUMMARY_PROVIDER?.trim() == "anthropic") {
      // SDK call for anthropic
      const response = await client.beta.messages.create({
        model: summarymodel(),
        max_tokens: 16000,
        betas: ["server-side-fallback-2026-07-01"],
        fallbacks: "default",
        system: SYSTEM,
        output_config: { effort: "low", format: { type: "json_schema", schema: SCHEMA } },
        messages: [{ role: "user", content: userPrompt(input) }],
      });
      if (response.stop_reason === "refusal") throw new SummaryRefused("Claude declined to summarize this document.");
      if (response.stop_reason === "max_tokens") throw new Error("The summary was cut off before it finished.");
      const out = response.content.find((b) => b.type === "text");
      if (!out || out.type !== "text") throw new SummaryRefused("No summary came back.");
      return {
        ...parseSummary(out.text),
        model: response.model || summarymodel(),
        inputTokens: response.usage.input_tokens ?? 0,
        outputTokens: response.usage.output_tokens ?? 0,
      };
    } else {
      // SDK call for openrouter and local models
      const response = await client.messages.create({
        model: summarymodel(),
        max_tokens: 16000,
        system: SYSTEM,
        output_config: { effort: "low", format: { type: "json_schema", schema: SCHEMA } },
        messages: [{ role: "user", content: userPrompt(input) }],
      });
      if (response.stop_reason === "refusal") throw new SummaryRefused("Claude declined to summarize this document.");
      if (response.stop_reason === "max_tokens") throw new Error("The summary was cut off before it finished.");
      const out = response.content.find((b) => b.type === "text");
      if (!out || out.type !== "text") throw new SummaryRefused("No summary came back.");
      return {
        ...parseSummary(out.text),
        model: response.model || summarymodel(),
        inputTokens: response.usage.input_tokens ?? 0,
        outputTokens: response.usage.output_tokens ?? 0,
      };
    }
  } catch (e) {
    console.error("Claude summarization failed:", e);
    throw e;
  }
};
