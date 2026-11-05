import { readFileSync } from "node:fs";
import assert from "node:assert/strict";
import { parseEdgarAtom } from "../lib/feeds/edgar";
import { parseRss, extractTicker } from "../lib/feeds/rss";

const lookup = (cik: number) =>
  ({ 9000001: { ticker: "NWBT", name: "Northwind" }, 9000002: { ticker: "HGRD", name: "Halcyon" },
     9000003: { ticker: "CPLMF", name: "Copperline" }, 9000004: { ticker: "VORB", name: "Vantage" },
     9000005: { ticker: "BWPY", name: "Brightwater" } } as Record<number, { ticker: string; name: string }>)[cik];

const f = parseEdgarAtom(readFileSync("lib/feeds/fixtures/edgar-8k.xml", "utf8"), lookup);
console.table(f.map((x) => ({ t: x.ticker, form: x.formType, title: x.title, at: x.publishedAt })));
assert.equal(f.filter((x) => x.ticker === "NWBT").length, 1, "Filer+Subject deduped");
assert.ok(!f.some((x) => x.title.includes("Private Fund")), "unlisted filers are dropped");
assert.equal(f.find((x) => x.ticker === "HGRD")?.title, "Halcyon: Results of Operations and Financial Condition");
assert.equal(f.find((x) => x.ticker === "BWPY")?.title, "Brightwater: Entry into a Material Definitive Agreement");

const p = parseRss(readFileSync("lib/feeds/fixtures/press.xml", "utf8"), "Wire");
console.table(p.map((x) => ({ t: x.ticker, company: x.company, title: x.title.slice(0, 50) })));
assert.equal(p.length, 6, "no-ticker items dropped");
assert.deepEqual(p.map((x) => x.ticker), ["NWBT", "HGRD", "CPLMF", "BWPY", "VORB", "SLVP"]);

assert.equal(extractTicker("Acme (NYSE Arca: ACMX) today"), "ACMX");
assert.equal(extractTicker("Foo Corp. (Nasdaq Capital Market: FOOX)"), "FOOX");
assert.equal(extractTicker("no ticker here: ABC"), null);
import { tidyName } from "../lib/feeds/edgar";
assert.equal(tidyName("NVIDIA CORP"), "Nvidia Corp");
assert.equal(tidyName("BANK OF AMERICA CORP /DE/"), "Bank of America Corp");
assert.equal(tidyName("Apple Inc."), "Apple Inc.");
console.log("parsers OK");
