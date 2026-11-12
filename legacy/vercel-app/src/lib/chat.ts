import { companies } from "./sec";

export type ChatMessage = {
  id: number;
  display_name: string;
  body: string;
  tickers: string[];
  created_at: string;
};

/** $AAPL-style mentions of real Nasdaq/NYSE stocks, so "$100" or "$LOL" don't count. */
export async function mentionedTickers(body: string) {
  const cos = await companies();
  const found = [...body.toUpperCase().matchAll(/\$([A-Z]{1,5}(?:\.[A-Z])?)\b/g)].map((m) => m[1]);
  return [...new Set(found.filter((t) => cos.has(t)))].slice(0, 10);
}

/** Links are the main tool of chat spam and pump-and-dump schemes, so chat doesn't allow them. */
export const hasLink = (body: string) => /(https?:\/\/|www\.|\b[a-z0-9-]+\.(com|net|org|io|co|xyz|ly|gg|me|app|link|info|biz)\b)/i.test(body);

export const validName = (name: string) => /^[A-Za-z0-9_]{3,20}$/.test(name);
