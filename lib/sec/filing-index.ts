/**
 * The list of documents inside one SEC filing: the "<accession>-index.htm" page, and the plainer
 * "index.json" folder listing used when that page cannot be read. Pure parsing: no network.
 */
import { baseForm } from "../plain";
import { decodeEntities } from "./text";

export type FilingDocument = {
  sequence: number | null;
  description: string;
  /** Path inside the filing's folder, e.g. "aapl-20241031.htm" or "xslF345X05/wk-form4_1.xml". */
  name: string;
  /** As the SEC lists it: "8-K", "EX-99.1", "GRAPHIC", "4"... Empty for the complete text file. */
  type: string;
  /** https://www.sec.gov/Archives/... */
  url: string;
};

const ARCHIVES = "https://www.sec.gov/Archives/";

/** https://www.sec.gov/Archives/edgar/data/<cik>/<accession without dashes>/ */
export const filingFolderUrl = (cik: number, accession: string): string =>
  `${ARCHIVES}edgar/data/${cik}/${accession.replace(/-/g, "")}/`;

/** The page that lists a filing's documents. */
export const filingIndexUrl = (cik: number, accession: string): string => `${filingFolderUrl(cik, accession)}${accession}-index.htm`;

const cellText = (html: string) => decodeEntities(html.replace(/<[^>]+>/g, " ")).replace(/[\s ]+/g, " ").trim();

/** A link from the index page as a full archive address, or null when it points anywhere else. */
function archiveUrl(href: string): string | null {
  let h = decodeEntities(href).trim();
  // Inline-XBRL documents are linked through the SEC's viewer: "/ix?doc=/Archives/...".
  const viewer = /^(?:https?:\/\/www\.sec\.gov)?\/ix(?:\.xhtml)?\?doc=(.+)$/i.exec(h);
  if (viewer) h = viewer[1];
  if (h.startsWith("/Archives/")) h = "https://www.sec.gov" + h;
  else if (h.startsWith("http://www.sec.gov/Archives/")) h = "https" + h.slice(4);
  if (!h.startsWith(ARCHIVES) || /[\s"'<>]/.test(h)) return null;
  return h.replace(/#.*$/, "");
}

/** "…/edgar/data/320193/000032019324000123/xslF345X05/doc.xml" -> "xslF345X05/doc.xml" */
function nameInFolder(url: string): string {
  const m = /\/edgar\/data\/\d+\/\d{18}\/(.+)$/.exec(url);
  return m ? m[1] : url.slice(url.lastIndexOf("/") + 1);
}

/**
 * The documents listed on a filing's index page. Rows are found by shape (at least four cells with a
 * link in the third), so a change of class names or spacing does not break it. The second table,
 * "Data Files" (XBRL), is left out.
 */
export function parseFilingIndexHtml(html: string): FilingDocument[] {
  const page = String(html ?? "");
  const tables = [...page.matchAll(/<table\b([^>]*)>([\s\S]*?)<\/table\s*>/gi)];
  const blocks = tables.length ? tables.filter((t) => !/summary\s*=\s*["']?\s*Data Files/i.test(t[1])).map((t) => t[2]) : [page];
  const out: FilingDocument[] = [];
  const seen = new Set<string>();
  for (const block of blocks) {
    for (const row of block.matchAll(/<tr\b[^>]*>([\s\S]*?)<\/tr\s*>/gi)) {
      const cells = [...row[1].matchAll(/<td\b[^>]*>([\s\S]*?)<\/td\s*>/gi)].map((c) => c[1]);
      if (cells.length < 4) continue;
      const href = /<a\b[^>]*\bhref\s*=\s*["']([^"']+)["']/i.exec(cells[2])?.[1];
      if (!href) continue;
      const url = archiveUrl(href);
      if (!url || seen.has(url)) continue;
      seen.add(url);
      const seq = Number(cellText(cells[0]));
      out.push({
        sequence: Number.isInteger(seq) && seq > 0 ? seq : null,
        description: cellText(cells[1]),
        name: nameInFolder(url),
        type: cellText(cells[3]).toUpperCase(),
        url,
      });
    }
  }
  return out;
}

/** The files in a filing's folder, from "<folder>/index.json". Sub-folders are left out. */
export function parseFolderJson(json: unknown, folderUrl: string): { name: string; url: string }[] {
  const items = (json as { directory?: { item?: unknown } } | null)?.directory?.item;
  if (!Array.isArray(items)) return [];
  const base = folderUrl.endsWith("/") ? folderUrl : folderUrl + "/";
  const out: { name: string; url: string }[] = [];
  for (const it of items) {
    const name = String((it as { name?: unknown } | null)?.name ?? "").trim();
    if (!name || !/^[\w.+~-]+\.[A-Za-z0-9]+$/.test(name)) continue;
    out.push({ name, url: base + name });
  }
  return out;
}

/**
 * Insider-trade filings list a page drawn from the XML ("xslF345X05/doc.xml"). The XML itself is the
 * same file name directly in the folder.
 */
export const rawXmlUrl = (doc: Pick<FilingDocument, "url">): string => doc.url.replace(/\/xsl[^/]*\/(?=[^/]+$)/i, "/");

const READABLE = /\.(?:html?|txt)$/i;
const isCompleteTextFile = (d: FilingDocument) => /^\d{10}-\d{2}-\d{6}\.txt$/.test(d.name);

/** The filing's main document: the one whose type is the form itself. */
export function pickPrimary(docs: FilingDocument[], form: string): FilingDocument | null {
  const real = docs.filter((d) => !isCompleteTextFile(d));
  const wanted = form.trim().toUpperCase();
  const base = baseForm(form).base;
  return (
    real.find((d) => d.type === wanted) ??
    real.find((d) => baseForm(d.type).base === base) ??
    real.find((d) => d.sequence === 1) ??
    real.find((d) => /\.(?:html?|xml)$/i.test(d.name) && !/^EX-|^GRAPHIC$|^XML$/.test(d.type)) ??
    null
  );
}

/** How early a press-release exhibit's type comes in the search: EX-99.1, EX-99, EX-99.01, EX-99.2 ... */
function pressRank(type: string): number | null {
  const m = /^EX-99(?:\.(\d{1,2}))?$/.exec(type.trim().toUpperCase());
  if (!m) return null;
  if (m[1] === undefined) return 1;
  if (m[1] === "1") return 0;
  if (m[1] === "01") return 2;
  return 2 + Number(m[1]);
}

/** The attached press release, when there is one that can be read as text. */
export function pickPressRelease(docs: FilingDocument[]): FilingDocument | null {
  let best: { doc: FilingDocument; rank: number } | null = null;
  for (const doc of docs) {
    const rank = pressRank(doc.type);
    if (rank === null || !READABLE.test(doc.name)) continue;
    if (!best || rank < best.rank) best = { doc, rank };
  }
  return best?.doc ?? null;
}

/**
 * When the index page cannot be read: guess from file names alone (the old app's rule).
 * Returns documents shaped like the index page's, with the type guessed where the name gives it away.
 */
export function documentsFromFolder(files: { name: string; url: string }[], form: string): FilingDocument[] {
  const base = baseForm(form).base;
  const out: FilingDocument[] = [];
  let primaryFound = false;
  for (const f of files) {
    if (/-index(?:-headers)?\.html?$/i.test(f.name) || /^\d{10}-\d{2}-\d{6}\.txt$/.test(f.name)) continue;
    let type = "";
    const ex99 = /(?:ex|exhibit)[-_]?99[-_.]?(0?[1-9])?/i.exec(f.name);
    if (ex99 && READABLE.test(f.name)) type = ex99[1] ? `EX-99.${Number(ex99[1])}` : "EX-99";
    else if (/\.(?:jpe?g|gif|png)$/i.test(f.name)) type = "GRAPHIC";
    else if (/^ex[-_]?\d|[-_]ex[-_]?\d/i.test(f.name)) type = "EX";
    else if (!primaryFound && (base === "4" ? /\.xml$/i.test(f.name) : /\.html?$/i.test(f.name)) && !/^(?:R\d+|Financial_Report|FilingSummary)\./i.test(f.name)) {
      type = form.trim().toUpperCase();
      primaryFound = true;
    }
    out.push({ sequence: null, description: "", name: f.name, type, url: f.url });
  }
  return out;
}
