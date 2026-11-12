// Fetch the readable text of an SEC filing, plus any attached press release.
const UA = process.env.SEC_USER_AGENT || "BigStocks.com admin@bigstocks.com";

async function secGet(url: string) {
  const res = await fetch(url, { headers: { "User-Agent": UA }, cache: "no-store" });
  if (!res.ok) throw new Error(`SEC request failed (${res.status}): ${url}`);
  return res.text();
}

const ENTITIES: Record<string, string> = { amp: "&", lt: "<", gt: ">", quot: '"', apos: "'", nbsp: " " };

export function htmlToText(html: string) {
  return html
    .replace(/<ix:header[\s\S]*?<\/ix:header>/gi, " ") // hidden XBRL data block
    .replace(/<(script|style|head)[\s\S]*?<\/\1>/gi, " ")
    .replace(/<\/(p|div|tr|li|h\d|table|br)\s*>|<br\s*\/?>/gi, "\n")
    .replace(/<[^>]+>/g, " ")
    .replace(/&#(\d+);/g, (_, n) => String.fromCharCode(+n))
    .replace(/&#x([0-9a-f]+);/gi, (_, n) => String.fromCharCode(parseInt(n, 16)))
    .replace(/&([a-z]+);/gi, (m, n) => ENTITIES[n.toLowerCase()] ?? m)
    .replace(/[ \t ]+/g, " ")
    .replace(/\s*\n\s*/g, "\n")
    .trim();
}

const folder = (cik: number, accession: string) =>
  `https://www.sec.gov/Archives/edgar/data/${cik}/${accession.replace(/-/g, "")}`;

/** Main document text, followed by any press-release exhibits (EX-99). */
export async function filingText(cik: number, accession: string, primaryDocument: string) {
  const base = folder(cik, accession);
  const main = htmlToText(await secGet(`${base}/${primaryDocument}`));
  let exhibits = "";
  try {
    const index = JSON.parse(await secGet(`${base}/index.json`)) as { directory: { item: { name: string }[] } };
    const ex99 = index.directory.item
      .map((i) => i.name)
      .filter((n) => /ex-?99/i.test(n) && /\.html?$/i.test(n))
      .slice(0, 3);
    for (const name of ex99) exhibits += `\n\n=== Attached exhibit: ${name} ===\n` + htmlToText(await secGet(`${base}/${name}`));
  } catch {
    // No index or exhibits: the main document is enough.
  }
  return main + exhibits;
}

export type InsiderTrade = {
  owner: string;
  role: string;
  action: "bought" | "sold" | "received" | "gave up";
  shares: number;
  price: number | null;
};

const CODES: Record<string, InsiderTrade["action"]> = { P: "bought", S: "sold" };

// Officer titles in filings are full of abbreviations; spell out the common ones.
const TITLE_WORDS: [RegExp, string][] = [
  [/\bCEO\b/g, "Chief Executive Officer"],
  [/\bCFO\b/g, "Chief Financial Officer"],
  [/\bCOO\b/g, "Chief Operating Officer"],
  [/\bCTO\b/g, "Chief Technology Officer"],
  [/\bEVP\b/g, "Executive Vice President"],
  [/\bSVP\b/g, "Senior Vice President"],
  [/\bVP\b/g, "Vice President"],
  [/\bGC\b/g, "General Counsel"],
  [/\bCAO\b/g, "Chief Accounting Officer"],
];
const plainTitle = (t: string) => TITLE_WORDS.reduce((s, [re, word]) => s.replace(re, word), t);
/** Filings list owners last name first: "COOK TIMOTHY D" -> "Timothy D Cook" */
const plainName = (n: string) => {
  const cased = n.toLowerCase().replace(/\b\w/g, (c) => c.toUpperCase());
  const parts = cased.split(" ");
  return parts.length > 1 ? [...parts.slice(1), parts[0]].join(" ") : cased;
};

/** Read a Form 4 (insider trade) straight from its XML; no AI needed. */
export async function insiderTrades(cik: number, accession: string, primaryDocument: string): Promise<InsiderTrade[]> {
  // The listed document is an XSL-rendered view (xslF345X06/form4.xml); the raw XML sits beside it.
  const xml = await secGet(`${folder(cik, accession)}/${primaryDocument.split("/").pop()}`);
  const tag = (s: string, t: string) => s.match(new RegExp(`<${t}>\\s*(?:<value>)?\\s*([^<]*)`, "i"))?.[1]?.trim() ?? "";
  const owner = plainName(tag(xml, "rptOwnerName"));
  const roles = [
    tag(xml, "isDirector") === "1" || tag(xml, "isDirector") === "true" ? "Director" : "",
    plainTitle(tag(xml, "officerTitle")),
    tag(xml, "isTenPercentOwner") === "1" || tag(xml, "isTenPercentOwner") === "true" ? "10% owner" : "",
  ].filter(Boolean);
  const trades: InsiderTrade[] = [];
  for (const t of xml.match(/<nonDerivativeTransaction>[\s\S]*?<\/nonDerivativeTransaction>/gi) ?? []) {
    const code = tag(t, "transactionCode");
    const ad = tag(t, "transactionAcquiredDisposedCode");
    const action = CODES[code] ?? (ad === "A" ? "received" : "gave up");
    const price = parseFloat(tag(t, "transactionPricePerShare"));
    trades.push({
      owner,
      role: roles.join(", ") || "Insider",
      action,
      shares: parseFloat(tag(t, "transactionShares")) || 0,
      price: isFinite(price) && price > 0 ? price : null,
    });
  }
  return trades;
}
