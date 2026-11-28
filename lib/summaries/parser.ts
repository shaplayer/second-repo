const sentences = new Intl.Segmenter("en", { granularity: "sentence" });
import type { SummaryOutput } from "./common";
import { clean, SummaryRefused } from "./common";
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

/** Checks and tidies what the model returned. Throws SummaryRefused when it cannot be shown. */
export function parseSummaryJSON(textcontent: string): Pick<SummaryOutput, "headline" | "oneSentence" | "bullets" | "tone" | "importance"> {
  let raw: Record<string, unknown>;
  try {
    raw = JSON.parse(textcontent);
  } catch {
    throw new SummaryRefused("The summary came back in a form that could not be read.");
  }
  const headline = clean(raw.headline, 160);
  const oneSentence = clean(raw.one_sentence, 400);
  console.log(oneSentence);
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

export function parseOpenRouterSummaryJSON(textcontent: string): Pick<SummaryOutput, "headline" | "oneSentence" | "bullets" | "tone" | "importance"> {
  let raw: Record<string, unknown>;
  try {
    raw = JSON.parse(textcontent);
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
  return { headline, oneSentence, bullets, tone, importance };
}

export function parseSummaryText(textcontent: string): Pick<SummaryOutput, "headline" | "oneSentence" | "bullets" | "tone" | "importance"> {
  const text = textcontent
    .split(/\r?\n/)
    .filter((line) => {
      const trimmed = line.trim();
      const heading = trimmed.replace(/^#{1,6}\s*/, "").replace(/^\*\*(.*?)\*\*$/, "$1").replace(/^__(.*?)__$/, "$1").trim();
      return !(
        !trimmed ||
        /^#{1,6}\s/.test(trimmed) ||
        /^\*\*[^*]+\*\*$/.test(trimmed) ||
        /^__[^_]+__$/.test(trimmed) ||
        /^(?:what (?:the filing|this|it) is about|what it says|key performance numbers|headline|one sentence|summary|key points|bullets?)\s*:?\s*$/i.test(heading) ||
        (/^[A-Z0-9][A-Z0-9\s&/-]{1,60}$/.test(heading) && !/[.!?]$/.test(heading))
      );
    })
    .map((line) => line.replace(/^\s*(?:[-*•]\s+|\d+[.)]\s+)/, "").replace(/\*\*(.*?)\*\*/g, "$1").replace(/__(.*?)__/g, "$1").trim())
    .join(" ");
  const parts = [...sentences.segment(text)]
    .map(({ segment }) => clean(segment, 300))
    .filter(Boolean);
  if (parts.length < 2) throw new SummaryRefused("The summary did not contain enough meaningful sentences.");

  return {
    headline: clean(parts[0].replace(/[.!?]+$/, ""), 160),
    oneSentence: clean(parts[1], 400),
    bullets: parts.slice(2, 6),
    tone: "Routine",
    importance: "Low",
  };
}