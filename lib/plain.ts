/**
 * Plain-English names for everything the SEC publishes, so nobody has to know what an "8-K" is.
 * This is the one place those names live. A form code may be shown only in brackets after the
 * plain name (formWithCode), never by itself.
 */

/** The kinds of news a person can filter by and choose alerts for. */
export type Category = "press" | "earnings" | "news" | "insider" | "ipo" | "proxy";
export const CATEGORIES: readonly Category[] = ["press", "earnings", "news", "insider", "ipo", "proxy"];

/** Filter and settings labels (plural). */
export const CATEGORY_LABEL: Record<Category, string> = {
  press: "Press releases",
  earnings: "Earnings",
  news: "Company news",
  insider: "Insider trades",
  ipo: "IPOs",
  proxy: "Shareholder votes",
};

/** One line under each label on the settings page. */
export const CATEGORY_HINT: Record<Category, string> = {
  press: "Announcements the company puts out on the newswires.",
  earnings: "Quarterly and annual results.",
  news: "Official announcements filed with the SEC: deals, leadership changes, new debt and more.",
  insider: "Executives, directors and big shareholders buying or selling shares.",
  ipo: "Companies filing to go public or to sell new shares.",
  proxy: "Annual meetings and what shareholders are asked to vote on.",
};

type FormInfo = { label: string; meaning: string; category: Category; headline: string };

const FORMS: Record<string, FormInfo> = {
  "10-Q": {
    label: "Quarterly report",
    meaning: "Official results for the last three months: sales, profit and cash.",
    category: "earnings",
    headline: "Quarterly report filed",
  },
  "10-K": {
    label: "Annual report",
    meaning: "The full yearly report: sales, profit, debt, risks and plans for the year ahead.",
    category: "earnings",
    headline: "Annual report filed",
  },
  "20-F": {
    label: "Annual report",
    meaning: "The yearly report from a company based outside the US.",
    category: "earnings",
    headline: "Annual report filed",
  },
  "40-F": {
    label: "Annual report",
    meaning: "The yearly report from a Canadian company.",
    category: "earnings",
    headline: "Annual report filed",
  },
  "8-K": {
    label: "Company news",
    meaning: "An official announcement of news the law says investors must hear about right away.",
    category: "news",
    headline: "Company news announced",
  },
  "6-K": {
    label: "Company news",
    meaning: "News or results from a company based outside the US.",
    category: "news",
    headline: "Company news announced",
  },
  "4": {
    label: "Insider trade",
    meaning: "An executive, director or major shareholder bought or sold shares.",
    category: "insider",
    headline: "An insider reported a change in their shares",
  },
  "DEF 14A": {
    label: "Shareholder vote",
    meaning: "Details of the annual meeting: what shareholders vote on, and executive pay.",
    category: "proxy",
    headline: "Annual meeting set: what shareholders will vote on",
  },
  "S-1": {
    label: "IPO filing",
    meaning: "The company filed to sell shares to the public.",
    category: "ipo",
    headline: "Filed to go public",
  },
  "F-1": {
    label: "IPO filing",
    meaning: "A company based outside the US filed to sell shares to the public here.",
    category: "ipo",
    headline: "Filed to go public",
  },
  "424B4": {
    label: "Share sale priced",
    meaning: "The final terms of a sale of new shares: how many, and at what price.",
    category: "ipo",
    headline: "Set the price for its share sale",
  },
  "SC 13D": {
    label: "Big investor",
    meaning: "An investor now owns more than 5% of the company and may push for changes.",
    category: "news",
    headline: "An investor reported owning more than 5%",
  },
  "SCHEDULE 13D": {
    label: "Big investor",
    meaning: "An investor now owns more than 5% of the company and may push for changes.",
    category: "news",
    headline: "An investor reported owning more than 5%",
  },
};

/** What an already-listed company's share registration is called (it is not an IPO). */
const SHARE_SALE: FormInfo = {
  label: "New shares",
  meaning: "The company plans to sell new shares. More shares can lower the value of each one.",
  category: "news",
  headline: "Plans to sell new shares",
};

/** Plain names for the numbered sections of a "Company news" filing (8-K items). */
const ITEMS: Record<string, string> = {
  "1.01": "Signed a major agreement",
  "1.02": "Ended a major agreement",
  "1.03": "Filed for bankruptcy",
  "1.05": "Reported a cybersecurity incident",
  "2.01": "Bought or sold a business",
  "2.02": "Released earnings results",
  "2.03": "Took on new debt",
  "2.04": "Debt became due early",
  "2.05": "Announced restructuring or layoffs",
  "2.06": "Wrote down the value of assets",
  "3.01": "Got a stock exchange listing warning",
  "3.02": "Sold new shares privately",
  "3.03": "Changed shareholder rights",
  "4.01": "Changed auditors",
  "4.02": "Said past financial reports can't be relied on",
  "5.01": "Change in who controls the company",
  "5.02": "Executive or board change",
  "5.03": "Changed its bylaws or fiscal year",
  "5.07": "Shareholder vote results",
  "7.01": "Shared news with investors",
  "8.01": "Other company news",
};
/** Sections that only say "exhibits attached": never worth a headline. */
const QUIET_ITEMS = new Set(["9.01"]);
/** When a filing has several sections, the one that matters most leads. */
const ITEM_ORDER = [
  "1.03", "4.02", "2.02", "2.01", "5.01", "1.01", "1.02", "2.05", "3.01", "2.04", "1.05", "2.03", "2.06", "3.02", "5.02", "3.03", "4.01",
  "5.07", "5.03", "7.01", "8.01",
];

/** "8-K/A" -> { base: "8-K", amended: true } */
export function baseForm(form: string): { base: string; amended: boolean } {
  const f = form.trim().toUpperCase();
  return f.endsWith("/A") ? { base: f.slice(0, -2), amended: true } : { base: f, amended: false };
}

/** The forms the site collects. Anything else is left out of the feed. */
export const isCollectedForm = (form: string) => baseForm(form).base in FORMS;
export const COLLECTED_FORMS: readonly string[] = Object.keys(FORMS);

export type FilingLike = { form: string; items?: readonly string[] | null };
export type PlainOptions = {
  /** True when the company already trades on an exchange: its share registration is not an IPO. */
  listed?: boolean;
};

function info(form: string, opts: PlainOptions): { info: FormInfo; amended: boolean } | null {
  const { base, amended } = baseForm(form);
  const found = FORMS[base];
  if (!found) return null;
  if ((base === "S-1" || base === "F-1") && opts.listed) return { info: SHARE_SALE, amended };
  return { info: found, amended };
}

/** "Quarterly report", "Company news", "Insider trade"... or null for a form the site does not collect. */
export function formLabel(form: string, opts: PlainOptions = {}): string | null {
  const f = info(form, opts);
  return f ? (f.amended ? `${f.info.label} (corrected)` : f.info.label) : null;
}

/** "Quarterly report (10-Q)": the only way a form code is ever shown. */
export function formWithCode(form: string, opts: PlainOptions = {}): string {
  const label = formLabel(form, opts);
  return label ? `${label.replace(" (corrected)", "")} (${form.trim().toUpperCase()})` : form.trim().toUpperCase();
}

/** One sentence on what this kind of filing is. */
export function formMeaning(form: string, opts: PlainOptions = {}): string | null {
  return info(form, opts)?.info.meaning ?? null;
}

/** Which filter and alert setting a filing belongs to, or null when the site does not collect it. */
export function filingCategory(f: FilingLike, opts: PlainOptions = {}): Category | null {
  const found = info(f.form, opts);
  if (!found) return null;
  const { base } = baseForm(f.form);
  if ((base === "8-K" || base === "6-K") && (f.items ?? []).includes("2.02")) return "earnings";
  return found.info.category;
}

/**
 * The headline to show before any summary exists: built only from what kind of filing it is, so it
 * is always true. "Released earnings results", "Quarterly report filed", "Executive or board change".
 */
export function plainHeadline(f: FilingLike, opts: PlainOptions = {}): string {
  const found = info(f.form, opts);
  if (!found) return "New SEC filing";
  const { base } = baseForm(f.form);
  let headline = found.info.headline;
  if (base === "8-K") {
    const items = (f.items ?? []).filter((i) => ITEMS[i] && !QUIET_ITEMS.has(i));
    items.sort((a, b) => (ITEM_ORDER.indexOf(a) + 1 || 99) - (ITEM_ORDER.indexOf(b) + 1 || 99));
    if (items.length) headline = items.slice(0, 2).map((i) => ITEMS[i]).join(" · ");
  }
  return found.amended ? `${headline} (corrected)` : headline;
}

/** Plain names of a filing's numbered sections, most important first (for the filing page). */
export function itemLabels(items: readonly string[] | null | undefined): string[] {
  const known = (items ?? []).filter((i) => ITEMS[i] && !QUIET_ITEMS.has(i));
  known.sort((a, b) => (ITEM_ORDER.indexOf(a) + 1 || 99) - (ITEM_ORDER.indexOf(b) + 1 || 99));
  return known.map((i) => ITEMS[i]);
}

/** The label for a press release from a newswire or other source. */
export const PRESS_LABEL = "Press release";
