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
import { OpenRouter } from "@openrouter/sdk";
import type { SummaryInput, Summarizer } from "./common";
import { SummaryRefused, SCHEMA, SYSTEM, debugFetch } from "./common";
import { parseSummaryJSON, parseOpenRouterSummaryJSON, parseSummaryText } from "./parser";

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
    case "do":
      return requiredEnv("DO_SUMMARY_MODEL");
    default:
      throw new Error("SUMMARY_PROVIDER must be anthropic, openrouter, local, or do.");
  }
}

let client: Anthropic | null = null;
const anthropic = () => {
  const provider = process.env.SUMMARY_PROVIDER?.trim();
  switch (provider) {
    case "anthropic":
      return new Anthropic({
        apiKey: requiredEnv("ANTHROPIC_API_KEY"),
      });

    case "openrouter":
      return new OpenRouter({
        apiKey: requiredEnv("OPENROUTER_API_KEY"),
      });
    
    case "do":
      return new Anthropic({
        baseURL: requiredEnv("DO_BASE_URL"),
        authToken: requiredEnv("DO_INFERENCE_KEY"),
        // fetch: debugFetch, // Enable to log raw requests and responses for debugging purposes.
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
      throw new Error("SUMMARY_PROVIDER must be anthropic, openrouter, local, or do.");
  }
};

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
      const response = await (client as Anthropic).beta.messages.create({
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
        ...parseSummaryJSON(out.text),
        model: response.model || summarymodel(),
        inputTokens: response.usage.input_tokens ?? 0,
        outputTokens: response.usage.output_tokens ?? 0,
      };
    } else if (process.env.SUMMARY_PROVIDER?.trim() == "openrouter") {
      // SDK call for openrouter models
      const response = await (client as OpenRouter).chat.send({
        chatRequest: {
          messages: [
            { role: "user", content: userPrompt(input) },
            { role: "system", content: SYSTEM },
          ],
          model: summarymodel(),
          maxTokens: 16000,
          reasoning: { "effort": "medium", "summary": "concise" },
          responseFormat: {
            type: "json_schema",
            jsonSchema: {
              name: "summary",
              description: "Summary in JSON format",
              schema: SCHEMA,
              strict: true,
            },
          },
        }
      });
      if (response.choices[0].finishReason === "refusal" || response.choices[0].message.refusal) throw new SummaryRefused(`Openrouter stopped execution due to error ${JSON.stringify(response.choices[0].message)}`);
      const out = response.choices[0].message.content;
      return {
        ...parseOpenRouterSummaryJSON(out as string),
        model: response.model || summarymodel(),
        inputTokens:  (response?.usage?.totalTokens ?? 0 - (response?.usage?.completionTokens ?? 0)),
        outputTokens: response?.usage?.completionTokens ?? 0,
      };
    } else {
      // SDK call for openrouter and local models
      const response = await (client as Anthropic).messages.create({
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
        ...typeof out.text === "object" ? parseSummaryJSON(out.text) : parseSummaryText(out.text),
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
