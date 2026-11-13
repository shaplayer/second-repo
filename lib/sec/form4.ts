/**
 * Insider trades, read straight from the filing's own data file. No AI: the summary is built from
 * the numbers in the filing, so it is always exactly what was reported. Pure functions.
 *
 * The wording never says what anyone should do with the stock. It says who traded, how much, and
 * whether it was a trade on the open market or shares from an award.
 */
import { decodeEntities } from "./text";

export type InsiderTrade = {
  /** "Timothy D Cook", or "Jane Doe and others" when several people report together. */
  owner: string;
  /** "Director, Chief Executive Officer", "10% owner", "Insider"... */
  role: string;
  action: "bought" | "sold" | "received" | "gave up";
  shares: number;
  price: number | null;
  date: string | null;
};

export type Form4 = {
  issuerCik: number | null;
  issuerName: string | null;
  trades: InsiderTrade[];
  /** The same owner and role as on every trade; also filled when the filing lists no share trades. */
  owner: string | null;
  role: string | null;
  /** True when the filing reports options or other awards changing hands. */
  hasAwardChanges: boolean;
};

export type InsiderSummary = {
  headline: string;
  oneSentence: string;
  bullets: string[];
  whyItMatters: string;
  tone: "Good news" | "Bad news" | "Mixed" | "Routine";
  importance: "High" | "Medium" | "Low";
};

/* ---------- reading the filing ---------- */

const OPEN_MARKET: Record<string, InsiderTrade["action"]> = { P: "bought", S: "sold" };

// Officer titles in filings are full of abbreviations; spell out the common ones.
const TITLE_WORDS: [RegExp, string][] = [
  [/\bCEO\b/gi, "Chief Executive Officer"],
  [/\bCFO\b/gi, "Chief Financial Officer"],
  [/\bCOO\b/gi, "Chief Operating Officer"],
  [/\bCTO\b/gi, "Chief Technology Officer"],
  [/\bCAO\b/gi, "Chief Accounting Officer"],
  [/\bCLO\b/gi, "Chief Legal Officer"],
  [/\bEVP\b/gi, "Executive Vice President"],
  [/\bSVP\b/gi, "Senior Vice President"],
  [/\bVP\b/gi, "Vice President"],
  [/\bGC\b/gi, "General Counsel"],
  [/\bSr\.?(?=\s)/gi, "Senior"],
  [/\bExec\.?(?=\s)/gi, "Executive"],
  [/\bPres\.(?=\s|$)/gi, "President"],
];
const SMALL_WORDS = new Set(["and", "of", "the", "for", "to", "in"]);

/** "EVP & CFO" -> "Executive Vice President & Chief Financial Officer"; "CHIEF FINANCIAL OFFICER" -> "Chief Financial Officer". */
export function plainTitle(title: string): string {
  const t = decodeEntities(title).replace(/\s+/g, " ").trim();
  if (!t) return "";
  // A title typed in capitals (not just a string of abbreviations) is put into ordinary case.
  const shouting = t === t.toUpperCase() && /[A-Z]{6,}/.test(t);
  const cased = shouting
    ? t.replace(/[A-Z][A-Z']*/g, (w) => {
        if (SMALL_WORDS.has(w.toLowerCase())) return w.toLowerCase();
        return w.length >= 4 ? w[0] + w.slice(1).toLowerCase() : w;
      })
    : t;
  return TITLE_WORDS.reduce((s, [re, word]) => s.replace(re, word), cased);
}

const ORGANISATION =
  /\b(?:inc|incorporated|llc|l\.l\.c|lp|l\.p|llp|ltd|limited|corp|corporation|company|trust|trustee|fund|funds|capital|partners|partnership|holdings?|group|management|advisors?|advisers?|associates|ventures?|investments?|investors|bank|foundation|plc|gmbh|ag|sa|nv|bv|gp|estate|enterprises|equity|assets?|securities|financial|international|technologies|master|family|revocable|irrevocable|living|university|society)\b|&|\d/i;
const KEEP_UPPER = new Set(["LLC", "LP", "LLP", "PLC", "NV", "SA", "AG", "BV", "GP", "II", "III", "IV", "USA", "US"]);
const NAME_SUFFIX = new Set(["jr", "jr.", "sr", "sr.", "ii", "iii", "iv"]);

const nameWord = (w: string): string => {
  if (KEEP_UPPER.has(w.toUpperCase().replace(/\.$/, "")) && w.length > 1) return w.toUpperCase();
  const lower = w.toLowerCase();
  const cased = lower.replace(/(^|['’-])([a-z])/g, (_, pre: string, c: string) => pre + c.toUpperCase());
  return /^mc[a-z]{2,}/.test(lower) ? "Mc" + cased[2].toUpperCase() + cased.slice(3) : cased;
};

/** Filings list people last name first: "COOK TIMOTHY D" -> "Timothy D Cook". Organisations keep their order. */
export function plainName(raw: string): string {
  const name = decodeEntities(raw).replace(/\s+/g, " ").trim();
  if (!name) return "";
  if (ORGANISATION.test(name)) {
    return name === name.toUpperCase() ? name.split(" ").map(nameWord).join(" ") : name;
  }
  if (name.includes(",")) {
    const [last, ...rest] = name.split(",").map((p) => p.trim()).filter(Boolean);
    return [...rest.join(" ").split(" "), last].filter(Boolean).map(nameWord).join(" ");
  }
  const parts = name.split(" ").map(nameWord);
  if (parts.length < 2) return parts.join(" ");
  const [last, ...rest] = parts;
  const suffix = rest.length > 1 && NAME_SUFFIX.has(rest[rest.length - 1].toLowerCase()) ? rest.pop()! : null;
  return [...rest, last, ...(suffix ? [suffix] : [])].join(" ");
}

/** The text of a tag, whether it is written directly or inside <value>. */
const tag = (xml: string, name: string) =>
  decodeEntities(new RegExp(`<${name}\\b[^>]*>\\s*(?:<value\\b[^>]*>)?\\s*([^<]*)`, "i").exec(xml)?.[1] ?? "").trim();
const yes = (v: string) => v === "1" || v.toLowerCase() === "true";
const blocks = (xml: string, name: string) => xml.match(new RegExp(`<${name}\\b[^>]*>[\\s\\S]*?</${name}\\s*>`, "gi")) ?? [];

/** Reads an insider-trade filing's XML. Never throws: an unreadable file gives no trades. */
export function parseForm4(xml: string): Form4 {
  const doc = String(xml ?? "");
  const issuerCik = Number(tag(doc, "issuerCik"));
  const issuerName = tag(doc, "issuerName") || null;
  const owners = blocks(doc, "reportingOwner");
  const first = owners[0] ?? doc;
  const firstName = plainName(tag(first, "rptOwnerName"));
  const owner = firstName ? (owners.length > 1 ? `${firstName} and others` : firstName) : null;
  const roles = [
    yes(tag(first, "isDirector")) ? "Director" : "",
    plainTitle(tag(first, "officerTitle")) || (yes(tag(first, "isOfficer")) ? "Officer" : ""),
    yes(tag(first, "isTenPercentOwner")) ? "10% owner" : "",
  ].filter(Boolean);
  const role = roles.join(", ") || "Insider";

  const trades: InsiderTrade[] = [];
  for (const t of blocks(doc, "nonDerivativeTransaction")) {
    const shares = parseFloat(tag(t, "transactionShares"));
    if (!(shares > 0)) continue;
    const code = tag(t, "transactionCode").toUpperCase();
    const acquired = tag(t, "transactionAcquiredDisposedCode").toUpperCase() === "A";
    const price = parseFloat(tag(t, "transactionPricePerShare"));
    const date = /^\d{4}-\d{2}-\d{2}/.exec(tag(t, "transactionDate"))?.[0] ?? null;
    trades.push({
      owner: owner ?? "An insider",
      role,
      action: OPEN_MARKET[code] ?? (acquired ? "received" : "gave up"),
      shares,
      price: Number.isFinite(price) && price > 0 ? price : null,
      date,
    });
  }
  return {
    issuerCik: Number.isSafeInteger(issuerCik) && issuerCik > 0 ? issuerCik : null,
    issuerName,
    trades,
    owner,
    role: owner ? role : null,
    hasAwardChanges: blocks(doc, "derivativeTransaction").length > 0,
  };
}

/* ---------- saying it in plain English ---------- */

const count = (n: number) => Math.round(n).toLocaleString("en-US");
const trim0 = (s: string) => s.replace(/\.0$/, "");

/** "$1.1 million", "$850,000", "$4,300": rounded, because "about" is all a reader needs. */
export function roundMoney(value: number): string {
  const v = Math.abs(value);
  if (v >= 999_500_000) return `$${trim0((v / 1e9).toFixed(1))} billion`;
  if (v >= 999_500) return `$${trim0((v / 1e6).toFixed(1))} million`;
  const step = v >= 10_000 ? 1000 : v >= 1000 ? 100 : 1;
  return "$" + Math.max(Math.round(v / step) * step, 1).toLocaleString("en-US");
}

/** "$27.50": what one share cost. */
export function sharePrice(price: number): string {
  if (price >= 1) return "$" + price.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  return "$" + price.toFixed(4).replace(/0{1,2}$/, "");
}

const sumShares = (ts: InsiderTrade[]) => ts.reduce((s, t) => s + t.shares, 0);
const sumValue = (ts: InsiderTrade[]) => ts.reduce((s, t) => s + t.shares * (t.price ?? 0), 0);
/** Average price per share over the trades that state a price, or null when none does. */
function averagePrice(ts: InsiderTrade[]): number | null {
  const priced = ts.filter((t) => t.price !== null);
  const shares = sumShares(priced);
  return shares > 0 ? sumValue(priced) / shares : null;
}

/** The role as the start of a headline ("Chief Financial Officer") and of a sentence ("The Chief Financial Officer"). */
function subject(role: string): { head: string; sentence: string } {
  const title = role.replace(/^Director(?:, |$)/, "").replace(/(?:^|, )10% owner$/, "").trim();
  if (title && title !== "Insider" && title !== "Officer") {
    if (title.split(/\s+/).length <= 7) return { head: title, sentence: `The ${title}` };
    return { head: "An executive", sentence: "An executive" };
  }
  if (title === "Officer") return { head: "An officer", sentence: "An officer of the company" };
  if (/^Director/.test(role)) return { head: "Director", sentence: "A director" };
  if (/10% owner/.test(role)) return { head: "Major shareholder", sentence: "A major shareholder" };
  return { head: "An insider", sentence: "An insider" };
}

function tradeLine(verb: string, ts: InsiderTrade[], withTotal: boolean): string {
  const price = averagePrice(ts);
  const value = sumValue(ts);
  let line = `${verb} ${count(sumShares(ts))} shares`;
  if (price !== null) line += ` at about ${sharePrice(price)} a share`;
  if (withTotal && price !== null && value > 0) line += `, about ${roundMoney(value)} in total`;
  return line + ".";
}

/**
 * The summary shown for an insider-trade filing. `who` names the insider when the filing lists no
 * share trades (a change in options or other awards only); otherwise it is taken from the trades.
 */
export function insiderSummary(trades: InsiderTrade[], who?: { owner?: string | null; role?: string | null }): InsiderSummary {
  const owner = trades[0]?.owner ?? who?.owner ?? "";
  const role = trades[0]?.role ?? who?.role ?? "Insider";
  const { head, sentence } = subject(role);
  const of = (action: InsiderTrade["action"]) => trades.filter((t) => t.action === action && t.shares > 0);
  const buys = of("bought");
  const sells = of("sold");
  const received = of("received");
  const gaveUp = of("gave up");
  const market = buys.length + sells.length > 0;
  const awards = received.length + gaveUp.length > 0;

  const whoLine = owner ? `Who: ${owner} (${role}).` : "Who: a company insider.";
  const lines: string[] = [];
  if (buys.length) lines.push(tradeLine("Bought", buys, true));
  if (sells.length) lines.push(tradeLine("Sold", sells, true));
  if (received.length) lines.push(tradeLine("Received", received, false));
  if (gaveUp.length) lines.push(tradeLine("Gave up", gaveUp, false));
  const how = market && awards
    ? "Part was an open-market trade; the rest came from stock awards, option exercises or similar transfers."
    : market
      ? "This was an open-market trade, made at the market price."
      : awards
        ? "This was not an open-market trade: it came from a stock award, an option exercise, a gift or a similar transfer."
        : "No shares were bought or sold on the open market.";
  const bullets = [whoLine, ...lines.slice(0, 2), how];

  let headline: string;
  let oneSentence: string;
  let whyItMatters: string;
  let tone: InsiderSummary["tone"] = "Routine";
  let importance: InsiderSummary["importance"] = "Low";

  const worth = (ts: InsiderTrade[]) => (averagePrice(ts) !== null && sumValue(ts) > 0 ? sumValue(ts) : 0);
  if (buys.length && sells.length) {
    headline = `${head} bought and sold shares`;
    oneSentence = `${sentence} bought ${count(sumShares(buys))} shares and sold ${count(sumShares(sells))} shares on the open market.`;
    whyItMatters = "The insider both bought and sold, so this filing does not point clearly one way.";
    tone = "Mixed";
    if (worth(buys) > 100_000 || worth(sells) > 1_000_000) importance = "Medium";
  } else if (buys.length) {
    const value = worth(buys);
    headline = `${head} bought ${count(sumShares(buys))} shares`;
    oneSentence = value
      ? `${sentence} bought about ${roundMoney(value)} of stock on the open market.`
      : `${sentence} bought ${count(sumShares(buys))} shares on the open market.`;
    whyItMatters = "Insiders buying with their own money is often read as a sign of confidence in the company.";
    tone = "Good news";
    importance = value >= 1_000_000 ? "High" : value > 100_000 ? "Medium" : "Low";
  } else if (sells.length) {
    const value = worth(sells);
    headline = `${head} sold ${count(sumShares(sells))} shares`;
    oneSentence = value
      ? `${sentence} sold about ${roundMoney(value)} of stock on the open market.`
      : `${sentence} sold ${count(sumShares(sells))} shares on the open market.`;
    whyItMatters = "Insiders sell for many reasons, such as taxes or planned sales, so one sale is not a warning sign by itself.";
    if (value > 1_000_000) importance = "Medium";
  } else if (received.length && gaveUp.length) {
    headline = `${head} reported a change in their shares`;
    oneSentence = `${sentence} received ${count(sumShares(received))} shares and gave up ${count(sumShares(gaveUp))} shares through awards or exercises, not open-market trades.`;
    whyItMatters = "This is routine paperwork about an insider's stock awards.";
  } else if (received.length) {
    headline = `${head} received ${count(sumShares(received))} shares`;
    oneSentence = `${sentence} received ${count(sumShares(received))} shares through an award or an option exercise, not an open-market trade.`;
    whyItMatters = "This is routine paperwork about an insider's stock awards.";
  } else if (gaveUp.length) {
    headline = `${head} gave up ${count(sumShares(gaveUp))} shares`;
    oneSentence = `${sentence} gave up ${count(sumShares(gaveUp))} shares, for example to cover taxes or as a gift, not in an open-market trade.`;
    whyItMatters = "This is routine paperwork about an insider's shares.";
  } else {
    headline = `${head} reported a change in their stock awards`;
    oneSentence = `${sentence} reported a change in their stock awards; no shares were bought or sold on the open market.`;
    whyItMatters = "This is routine paperwork about an insider's stock awards.";
  }

  return { headline, oneSentence, bullets, whyItMatters, tone, importance };
}
