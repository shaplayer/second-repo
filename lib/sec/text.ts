/**
 * Turning SEC documents into plain text, and finding a press release's headline in that text.
 * Pure functions: no network, no database.
 */

const NAMED: Record<string, string> = {
  amp: "&", lt: "<", gt: ">", quot: '"', apos: "'", nbsp: " ", ensp: " ", emsp: " ", thinsp: " ",
  rsquo: "’", lsquo: "‘", ldquo: "“", rdquo: "”", sbquo: "‚", bdquo: "„",
  mdash: "—", ndash: "–", minus: "−", hellip: "…", bull: "•", middot: "·",
  reg: "®", trade: "™", copy: "©", sect: "§", para: "¶", deg: "°",
  cent: "¢", pound: "£", euro: "€", yen: "¥", times: "×", divide: "÷",
  plusmn: "±", frac12: "½", frac14: "¼", frac34: "¾", dagger: "†", Dagger: "‡",
  eacute: "é", egrave: "è", aacute: "á", agrave: "à", oacute: "ó", uacute: "ú",
  iacute: "í", ntilde: "ñ", uuml: "ü", ouml: "ö", auml: "ä", ccedil: "ç",
  shy: "", zwnj: "", zwj: "",
};

/** Many filings are written in Word and use Windows code points 128 to 159 as numbers (&#146; is ’). */
const WINDOWS_1252: Record<number, string> = {
  128: "€", 130: "‚", 131: "ƒ", 132: "„", 133: "…", 134: "†", 135: "‡", 136: "ˆ",
  137: "‰", 138: "Š", 139: "‹", 140: "Œ", 142: "Ž", 145: "‘", 146: "’", 147: "“",
  148: "”", 149: "•", 150: "–", 151: "—", 152: "˜", 153: "™", 154: "š", 155: "›",
  156: "œ", 158: "ž", 159: "Ÿ",
};

function codePoint(n: number): string {
  if (!Number.isFinite(n) || n <= 0 || n > 0x10ffff || (n >= 0xd800 && n <= 0xdfff)) return " ";
  if (n >= 128 && n <= 159) return WINDOWS_1252[n] ?? " ";
  if (n < 32 && n !== 9 && n !== 10 && n !== 13) return " ";
  return String.fromCodePoint(n);
}

/** "&amp;", "&#8217;", "&#x2019;", "&rsquo;" -> the character. Unknown names are left as written. */
export function decodeEntities(s: string): string {
  return s
    .replace(/&#(\d{1,12});/g, (_, n) => codePoint(Number(n)))
    .replace(/&#x([0-9a-f]{1,10});/gi, (_, n) => codePoint(parseInt(n, 16)))
    .replace(/&([a-z][a-z0-9]{1,10});/gi, (m, n: string) => NAMED[n] ?? NAMED[n.toLowerCase()] ?? m);
}

/** The readable text of an HTML document: one line per paragraph, table row or list item. */
export function htmlToText(html: string): string {
  const stripped = String(html ?? "")
    .replace(/<ix:header[\s\S]*?<\/ix:header>/gi, " ") // the hidden data block of an inline-XBRL document
    .replace(/<!--[\s\S]*?-->/g, " ")
    .replace(/<(script|style|head)\b[\s\S]*?<\/\1\s*>/gi, " ")
    .replace(/<\/(p|div|tr|li|h\d|table|title|center|blockquote)\s*>|<br\s*\/?>|<hr\b[^>]*>/gi, "\n")
    .replace(/<[^>]+>/g, " ");
  return decodeEntities(stripped)
    .replace(/[​-‍﻿­]/g, "")
    .replace(/[‐‑]/g, "-") // typographic and non-breaking hyphens: plain ones search and wrap better
    .replace(/[ \t\f\v  -  　]+/g, " ")
    .replace(/\s*\n\s*/g, "\n")
    .trim();
}

const MONTH = "(?:jan|feb|mar|apr|may|jun|jul|aug|sep|sept|oct|nov|dec)[a-z]*\\.?";
/** "November 4, 2026", "Nov. 4, 2026", "4 November 2026", "11/04/2026" */
const DATE = `(?:${MONTH}\\s+\\d{1,2},?\\s+(?:19|20)\\d\\d|\\d{1,2}\\s+${MONTH},?\\s+(?:19|20)\\d\\d|\\d{1,2}/\\d{1,2}/(?:19|20)?\\d\\d)`;
const DATE_ONLY = new RegExp(`^(?:[a-z]+day,?\\s+)?${DATE}\\.?$`, "i");
/** "CUPERTINO, Calif., Nov. 4, 2026" and the same followed by the wire's mark and the first sentence. */
const DATELINE = new RegExp(`^[A-Z][A-Za-z .'’-]{1,40}(?:,\\s*[A-Za-z .]{2,25}){0,2},?\\s*[-–—/(]*\\s*(?:[a-z]+day,?\\s+)?${DATE}`, "i");
const WIRE_MARK = /\((?:BUSINESS WIRE|GLOBE NEWSWIRE|ACCESS ?WIRE|NEWSFILE[^)]*)\)|\/\s?(?:PRNewswire|ACCESS Newswire|CNW)[^/]*\/|\s--\s|--\(/i;
const BOILERPLATE =
  /^(?:exhibit\b|ex-?\s?99|for (?:immediate|further) |for release\b|news release\b|press release\b|media release\b|immediate release\b|source:|contacts?\b|company contacts?\b|investor (?:relations|contacts?)|investors?(?: and media)?:|media(?: contacts?| relations| inquiries)?:|press contacts?|analyst contacts?|public relations|tel(?:ephone)?[.:]|phone[.:]|fax[.:]|e-?mail[.:]|website[.:]|page \d|table of contents|\(?(?:nasdaq|nyse|otc|amex|tsx)[^a-z])/i;
const CONTACT_DETAIL = /@[a-z0-9-]+\.[a-z]{2,}|https?:\/\/|\bwww\.|(?:\(\d{3}\)|\b\d{3})[ .-]\d{3}[ .-]\d{4}\b/i;

const squash = (s: string) => s.toLowerCase().replace(/[^a-z0-9]+/g, "");

/**
 * The headline of a press release, from its plain text: the first line that reads like a headline.
 * Letterhead, "Exhibit 99.1", "FOR IMMEDIATE RELEASE", contact lines and the dateline are passed
 * over. Null when nothing before the body of the release qualifies.
 */
export function releaseTitle(text: string, companyName: string): string | null {
  const company = squash(companyName ?? "");
  const lines = String(text ?? "").split("\n").map((l) => l.replace(/\s+/g, " ").trim()).filter(Boolean);
  for (const line of lines.slice(0, 60)) {
    // The body has started: a headline never comes after it.
    if (line.length > 200) {
      if (DATELINE.test(line) || WIRE_MARK.test(line)) return null;
      continue;
    }
    if (line.length < 15) continue;
    if (BOILERPLATE.test(line) || CONTACT_DETAIL.test(line) || DATE_ONLY.test(line)) continue;
    if (DATELINE.test(line)) {
      // A short dateline by itself ("CUPERTINO, Calif., Nov. 4, 2026") sits above or below the headline;
      // one that runs on into a sentence is the body.
      if (WIRE_MARK.test(line) || line.length > 80) return null;
      continue;
    }
    if (company && squash(line) === company) continue; // the company's name as letterhead
    if (!/[a-z]/i.test(line) || line.replace(/[^a-z]/gi, "").length < 10) continue; // rules, numbers, symbols
    return line;
  }
  return null;
}
