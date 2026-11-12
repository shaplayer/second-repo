import type { Filing } from "./sec";

// Plain-English names for SEC filings, so nobody has to know what an "8-K" is.
export type Importance = "High" | "Medium" | "Low";
export type PlainFiling = Filing & { title: string; meaning: string; importance: Importance };

const FORMS: Record<string, [string, string, Importance]> = {
  "10-K": ["Annual report", "The full yearly report: sales, profit, debt, risks and plans for the year ahead.", "High"],
  "10-K/A": ["Annual report (corrected)", "The company changed or added to its yearly report.", "Medium"],
  "10-Q": ["Quarterly report", "Official results for the last three months: sales, profit and cash.", "High"],
  "10-Q/A": ["Quarterly report (corrected)", "The company changed or added to a quarterly report.", "Medium"],
  "20-F": ["Annual report (foreign company)", "The yearly report from a company based outside the US.", "High"],
  "40-F": ["Annual report (Canadian company)", "The yearly report from a Canadian company.", "High"],
  "6-K": ["Company update (foreign company)", "News or results from a company based outside the US.", "Medium"],
  "4": ["Insider trade", "An executive, director or major shareholder bought or sold shares.", "Low"],
  "3": ["New insider", "Someone became an executive, director or major shareholder and reported their shares.", "Low"],
  "144": ["Insider plans to sell", "An insider told the SEC they intend to sell shares soon.", "Low"],
  "DEF 14A": ["Shareholder meeting notice", "Details of the annual meeting: what shareholders vote on and executive pay.", "Medium"],
  "DEFA14A": ["Extra shareholder meeting material", "More information ahead of a shareholder vote.", "Low"],
  "S-1": ["Selling new shares", "The company plans to sell new stock. More shares can lower the value of each one.", "High"],
  "S-3": ["May sell new shares", "The company registered stock it can sell later. More shares can lower the value of each one.", "Medium"],
  "S-8": ["Shares for employees", "Stock set aside for employee pay plans.", "Low"],
  "SC 13D": ["Big investor owns 5%+", "An investor now owns more than 5% and may push for changes.", "High"],
  "SC 13G": ["Big investor owns 5%+", "A large, passive investor owns more than 5% of the company.", "Medium"],
  "SCHEDULE 13D": ["Big investor owns 5%+", "An investor now owns more than 5% and may push for changes.", "High"],
  "SCHEDULE 13G": ["Big investor owns 5%+", "A large, passive investor owns more than 5% of the company.", "Medium"],
  "11-K": ["Employee stock plan report", "Yearly report on the company's employee savings plan.", "Low"],
};

const ITEMS: Record<string, [string, Importance]> = {
  "1.01": ["Signed a major agreement", "High"],
  "1.02": ["Ended a major agreement", "High"],
  "1.03": ["Bankruptcy filing", "High"],
  "2.01": ["Bought or sold a business", "High"],
  "2.02": ["Released earnings results", "High"],
  "2.03": ["Took on new debt", "Medium"],
  "2.04": ["Debt became due early", "High"],
  "2.05": ["Restructuring or layoffs", "High"],
  "2.06": ["Wrote down the value of assets", "Medium"],
  "3.01": ["Stock exchange listing warning", "High"],
  "3.02": ["Sold new shares privately", "Medium"],
  "3.03": ["Changed shareholder rights", "Medium"],
  "4.01": ["Changed auditors", "Medium"],
  "4.02": ["Past financial reports can't be relied on", "High"],
  "5.01": ["Change in who controls the company", "High"],
  "5.02": ["Executive or board change", "Medium"],
  "5.03": ["Changed bylaws or fiscal year", "Low"],
  "5.07": ["Shareholder vote results", "Low"],
  "7.01": ["Shared news with investors", "Medium"],
  "8.01": ["Other company news", "Medium"],
};

const rank: Record<Importance, number> = { High: 3, Medium: 2, Low: 1 };

export function explain(f: Filing): PlainFiling | null {
  if (f.form === "8-K" || f.form === "8-K/A") {
    const known = f.items.map((i) => ITEMS[i]).filter(Boolean);
    const title = known.length ? known.map((k) => k[0]).join(" · ") : "Important company news";
    const importance = known.reduce<Importance>((m, k) => (rank[k[1]] > rank[m] ? k[1] : m), "Low");
    return {
      ...f,
      title,
      meaning: "An official announcement of news the law says investors must hear about right away.",
      importance: known.length ? importance : "Medium",
    };
  }
  const known = FORMS[f.form];
  return known ? { ...f, title: known[0], meaning: known[1], importance: known[2] } : null;
}

/** Filings that are news: earnings, announcements, results. */
export const isAnnouncement = (f: Filing) => ["8-K", "10-Q", "10-K", "6-K", "20-F", "40-F"].includes(f.form);

/** Which alert setting a filing falls under, or null for paperwork nobody gets alerted about. */
export function categoryOf(f: Filing): "earnings" | "news" | "insider" | null {
  if (["10-Q", "10-K", "20-F", "40-F"].includes(f.form)) return "earnings";
  if (f.form === "8-K" || f.form === "6-K") return f.items.includes("2.02") ? "earnings" : "news";
  if (f.form === "4") return "insider";
  if (["S-1", "S-3", "SC 13D", "SCHEDULE 13D", "DEF 14A"].includes(f.form)) return "news";
  return null;
}
