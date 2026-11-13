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
/** In text made with `layout`, a line break inside a paragraph (a <br>), as opposed to the end of the paragraph. */
export const SOFT_BREAK = "\uE000";

/**
 * With `layout`, the text keeps what a headline finder needs to see: an empty paragraph stays as one blank
 * line, and a line break inside a paragraph is marked with SOFT_BREAK instead of starting a new line.
 */
export function htmlToText(html: string, opts: { layout?: boolean } = {}): string {
  let source = String(html ?? "")
    // EDGAR wraps each document of a filing in a small header (type, sequence, file name, description): not part of its text.
    .replace(/^\s*<DOCUMENT>[\s\S]{0,4000}?<TEXT>/i, " ")
    .replace(/<\/TEXT>\s*<\/DOCUMENT>\s*$/i, " ");
  // In a web page, a line break in the source is only a space: paragraphs end where the tags say. (Most filing
  // software wraps long lines, which would otherwise cut headlines and sentences in two.) Plain text keeps its lines.
  if (/<(?:html|body|p|div|table|br|font|span)\b/i.test(source)) {
    source = source.replace(/<pre\b[\s\S]*?<\/pre\s*>/gi, (m) => m.replace(/\r?\n/g, "<br>")).replace(/[\r\n]+/g, " ");
  }
  const stripped = source
    .replace(/<ix:header[\s\S]*?<\/ix:header>/gi, " ") // the hidden data block of an inline-XBRL document
    .replace(/<!--[\s\S]*?-->/g, " ")
    .replace(/<(script|style|head)\b[\s\S]*?<\/\1\s*>/gi, " ")
    .replace(/<br\s*\/?>/gi, opts.layout ? SOFT_BREAK : "\n")
    .replace(/<\/(p|div|tr|li|h\d|table|title|center|blockquote)\s*>|<hr\b[^>]*>/gi, "\n")
    .replace(/<[^>]+>/g, " ");
  return decodeEntities(stripped)
    .replace(/[​-‍﻿­]/g, "")
    .replace(/[‐‑]/g, "-") // typographic and non-breaking hyphens: plain ones search and wrap better
    .replace(/[ \t\f\v  -  　]+/g, " ")
    // An empty paragraph is the gap a release leaves around its headline: kept, as one blank line, only on request.
    .replace(opts.layout ? /[ \t]*\n[ \t]*/g : /\s*\n\s*/g, "\n")
    .replace(/\n{3,}/g, "\n\n")
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

// What real exhibits put above, beside and instead of a headline (checked against a day of live filings).
const CORP_SUFFIX = /\b(?:incorporated|inc|corporation|corp|company|co|limited|ltd|llc|plc|lp|sa|nv|se|ag)\b\.?/gi;
/** A company's name without "Inc.", "Corp" and the like, for telling letterhead from a headline. */
const nameKey = (s: string) => squash(s.replace(/&/g, " and ").replace(/\/[A-Z]{2,3}\/?\s*$/, " ").replace(CORP_SUFFIX, " "));
const HEADLINE_VERB =
  /\b(?:announc|report|appoint|names\b|named\b|elect|promot|declar|joins?\b|retir|resign|hires?\b|complet|provid|releas|receiv|launch|signs?\b|enters?\b|clos(?:es|ed)\b|pric(?:es|ed)\b|fil(?:es|ed)\b|updat|presents?\b|to present\b|hosts?\b|acquir|agree|secur|achiev|expand|grew\b|grows?\b|increas)/i;
const ROLE =
  /\b(?:chief [a-z ]{3,30} officer|ceo|cfo|coo|cto|president|treasurer|investor relations|media relations|corporate communications|general counsel|corporate secretary|vice president|chairman|managing director)\b/i;
const NAME_THEN_ROLE = new RegExp(`^(?:[A-Z][\\w.'’-]*\\s+){0,4}[A-Z][\\w.'’-]*,\\s.*${ROLE.source}`, "i");
const ROLE_ALONE = new RegExp(`^(?:(?:senior|executive|interim|group)\\s+)*${ROLE.source}(?:\\s*(?:&|and|,)\\s*${ROLE.source})*$`, "i");
const CREDENTIAL_END = /,\s*(?:CFA|CPA|Esq|Ph\.?D|MBA|M\.?D)\.?$/;
const ADDRESS =
  /^\d+\s+\S+.*\b(?:street|st|avenue|ave|road|rd|suite|floor|blvd|boulevard|drive|way|plaza|parkway|pkwy|lane)\b\.?|\b(?:suite|floor|p\.?o\.? box)\s+\d+/i;
const NOT_A_HEADLINE =
  /^(?:trading symbols?\b|ticker\b|symbols?:|document as released\b|note for readers\b|english translation\b|index to\b|certain defined terms\b|cautionary (?:note|statement)\b|forward-looking statements\b|safe harbor\b|\(.*\)$)|\band its subsidiaries\.?$/i;
const STARTS_WITH_VERB = /^(?:announces?|reports?|declares?|appoints?|names|completes?|provides?|releases?|receives?|launches|signs|enters|closes|prices|files|to)\b/i;
const COMPANY_ONLY = /^[\w&.,'’ -]{2,70}\b(?:inc|incorporated|corp|corporation|ltd|limited|llc|plc|s\.a|n\.v|company|co)\.?$/i;
const words = (s: string) => s.split(" ").length;

/** The words of a name that tell it apart ("Commvault Systems Inc" -> commvault, systems). */
const nameWords = (s: string) => s.toLowerCase().replace(/&/g, " and ").replace(CORP_SUFFIX, " ").split(/[^a-z0-9]+/).filter((w) => w && w !== "and" && w !== "the");

/** The company's own name, in full or in part, standing alone as letterhead ("CONTANGO SILVER & GOLD", "Commvault"). */
function isLetterhead(line: string, companyName: string): boolean {
  const company = new Set(nameWords(companyName));
  const mine = nameWords(line);
  return company.size > 0 && mine.length > 0 && mine.every((w) => company.has(w));
}

/** A line that sits near a headline but is not one: letterhead, a contact's name and title, an address, a note. */
function notHeadline(line: string, companyKey: string): boolean {
  if (BOILERPLATE.test(line) || CONTACT_DETAIL.test(line) || DATE_ONLY.test(line) || NOT_A_HEADLINE.test(line)) return true;
  if (ADDRESS.test(line) || CREDENTIAL_END.test(line)) return true;
  const hasVerb = HEADLINE_VERB.test(line);
  // "Lara E. Ramsey, President & CEO", "Chief Financial Officer": a contact, not "Letter to Shareholders from CEO Jo Doe".
  if (!hasVerb && words(line) <= 9 && (NAME_THEN_ROLE.test(line) || ROLE_ALONE.test(line))) return true;
  if (!hasVerb && COMPANY_ONLY.test(line) && words(line) <= 7) return true; // "LIVEPERSON, INC."
  // Addresses: "12 ter Quai Perrache", "Austin, Texas 78701, United States", a line that stops at a comma.
  if (!hasVerb && words(line) <= 8 && (/^\d/.test(line) || /\b\d{5}(?:-\d{4})?\b/.test(line) || /,$/.test(line))) return true;
  if (companyKey && nameKey(line) === companyKey) return true; // the company's own name as letterhead
  // Letterhead that lists a group's companies: "The Acme Insurance Company - The Acme Indemnity Company - ...".
  if (!hasVerb && (line.match(/\b(?:incorporated|inc|corporation|corp|company|limited|ltd|llc|plc)\b/gi)?.length ?? 0) >= 2) return true;
  // A line of a table of contents or a section label ("Part I. Company Information 4", "... Statements Page", "Terms include:").
  // A whole sentence ("A term sometimes used to refer to ...") or a numbered point is text, not a headline.
  if (/^\d+\.\s/.test(line) || (/\.$/.test(line) && !/\b(?:inc|corp|ltd|co|llc|plc|s\.a|n\.v|u\.s|jr|sr)\.$/i.test(line))) return true;
  if (/^(?:part|section|item|note) [ivx\d]+\b/i.test(line) || /:$/.test(line) || /(?:\spage|\sF-\d+)$/i.test(line) || (!hasVerb && /\s\d{1,3}$/.test(line))) return true;
  return !/[a-z]/i.test(line) || line.replace(/[^a-z]/gi, "").length < 10; // rules, numbers, symbols
}

const isUpper = (s: string) => s === s.toUpperCase();
const CONNECTOR = "and|of|the|for|to|in|with|a|an|on|at|by|from|as|its";
const HANGING_END = new RegExp(`(?:[,;&–-]|\\b(?:${CONNECTOR}))$`, "i");
const STARTS_WITH_CONNECTOR = new RegExp(`^(?:${CONNECTOR})\\b`, "i");
/** Starts in lower case, or with a joining word ("IN QUARTERLY CASH DIVIDENDS"). */
const isFragment = (s: string) => /^[a-z]/.test(s) || STARTS_WITH_CONNECTOR.test(s);
const FIRST_DATE = new RegExp(DATE, "i");

/**
 * A release filed as one long run of text (converted from a PDF): "1 News Release Acme Names Jo Doe President
 * OKLAHOMA CITY – November 13, 2026 – Acme, Inc. ...". The headline is what stands before the city in capitals.
 */
function headlineBeforeDateline(line: string, companyKey: string): string | null {
  const date = FIRST_DATE.exec(line.slice(0, 500));
  if (!date) return null;
  const before = line.slice(0, date.index).replace(/[\s\-–—(/]+$/, "");
  const city = /\s+(?:[A-Z][A-Z.]+,?\s*){1,4}(?:,\s*[A-Z][a-z]+\.?)?$/.exec(before); // capitals only: no "i" flag
  if (!city) return null;
  const head = before.slice(0, city.index).replace(/^\d{1,2}\s+/, "").replace(/^(?:(?:news|press|media) release|for immediate release|exhibit 99\.\d+)\s+/gi, "").trim();
  return head.length >= 20 && head.length <= 200 && !notHeadline(head, companyKey) ? head : null;
}

/**
 * The headline of a press release, from its plain text: the first line that reads like a headline.
 * Letterhead, "Exhibit 99.1", "FOR IMMEDIATE RELEASE", contact lines, addresses and the dateline are
 * passed over. A headline set on two or three lines is put back together when the text was made with
 * `layout` (the blank line after it shows where it ends). Null when nothing before the body
 * of the release qualifies.
 */
export function releaseTitle(text: string, companyName: string): string | null {
  const companyKey = nameKey(companyName ?? "");
  const raw = String(text ?? "");
  const gaps = raw.includes("\n\n"); // blank lines were kept: they mark where a headline ends
  const clean = (l: string) => l.replace(/\s+/g, " ").trim();
  const lines: string[] = [];
  for (const paragraph of raw.split("\n")) {
    if (!paragraph.includes(SOFT_BREAK)) {
      lines.push(clean(paragraph));
      continue;
    }
    // A paragraph with line breaks inside it is either a headline set on several lines (kept whole) or a
    // block of separate things, such as contact details (taken apart).
    const pieces = paragraph.split(SOFT_BREAK).map(clean).filter(Boolean);
    const whole = pieces.join(" ");
    const apart = pieces.length > 3 || whole.length > 300 ||
      pieces.some((x) => BOILERPLATE.test(x) || CONTACT_DETAIL.test(x) || DATE_ONLY.test(x) || DATELINE.test(x) || ADDRESS.test(x) || NOT_A_HEADLINE.test(x) || isLetterhead(x, companyName ?? ""));
    if (apart) lines.push(...pieces);
    else lines.push(whole);
  }
  let seen = 0;
  let letterhead: { at: number; text: string } | null = null;
  for (let i = 0; i < lines.length && seen < 60; i++) {
    const line = lines[i];
    if (!line) continue;
    seen++;
    // The body has started: a headline never comes after it.
    if (line.length > 200) {
      if (seen <= 4) {
        const inline = headlineBeforeDateline(line, companyKey);
        if (inline) return inline;
      }
      if (DATELINE.test(line) || WIRE_MARK.test(line)) return null;
      continue;
    }
    if (/^dear\b/i.test(line)) return null; // a letter, not a release
    if (isLetterhead(line, companyName ?? "")) {
      letterhead = { at: i, text: line };
      continue;
    }
    if (line.length < 15) continue;
    if (notHeadline(line, companyKey)) continue;
    // A dateline is a place and a date. "General Meeting of November 12, 2026: Quorum Not Met" has a date after ordinary words: a headline.
    const prose = /\b(?:of|on|for|the|to|at|a|an)\s/i.test(line.slice(0, FIRST_DATE.exec(line)?.index ?? 0));
    const dateline = prose ? null : DATELINE.exec(line);
    if (dateline && (WIRE_MARK.test(line) || line.length > 80)) return null; // a dateline that runs on into a sentence is the body
    // A short dateline by itself ("CUPERTINO, Calif., Nov. 4, 2026") sits above or below the headline. A line that
    // only mentions a date and then goes on ("General Meeting of November 12, 2026: Quorum Not Met") is a headline.
    if (dateline && line.length - dateline[0].length <= 25) continue;

    let headline = line;
    if (gaps) {
      for (let j = i + 1, added = 0; j < lines.length && added < 2; j++, added++) {
        const next = lines[j];
        if (!next || next.length > 100 || headline.length + next.length > 300) break;
        if (/[.:]$/.test(next) || (/[a-z]/i.test(next) && isUpper(headline) !== isUpper(next))) break; // a sentence or a sub-heading, not the rest of the headline
        // Only what reads as the rest of the same headline: it was left hanging, or what follows is a fragment.
        if (!(HANGING_END.test(headline) || isFragment(next) || words(next) <= 3)) break;
        if (/^(?:page|\d+|F-\d+)$/i.test(next)) break; // the column heading or page number of a table of contents
        if (DATELINE.test(next) || WIRE_MARK.test(next)) break;
        if (BOILERPLATE.test(next) || CONTACT_DETAIL.test(next) || DATE_ONLY.test(next) || ADDRESS.test(next) || NOT_A_HEADLINE.test(next)) break;
        if (/[^\u0000-ɏ‐-™]/.test(next)) break; // the same headline again in another script
        headline += " " + next;
      }
    }
    // "C&F Financial Corporation" on one line and "Announces Increase in Quarterly Dividend" on the next.
    if (letterhead && letterhead.at === i - 1 && STARTS_WITH_VERB.test(headline)) headline = `${letterhead.text} ${headline}`;
    return headline;
  }
  return null;
}
