/**
 * Tests for the health check (lib/health): no network. Run with `npx tsx scripts/test-health.ts`.
 *
 * Three parts: the building blocks on small hand-made fact sets, real companies (trimmed SEC files in
 * lib/health/fixtures, scored as of 2026-11-10), and saving a snapshot to a throwaway database on a LOCAL
 * Postgres. The database part is skipped with a notice when no local Postgres is reachable.
 */
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import os from "node:os";
import { Client } from "pg";
import { migrate } from "../lib/db/migrate";
import { describeTarget } from "../lib/db/target";
import {
  areConsecutive, bestSeries, dedupeDurations, dedupeInstants, instantAt, liquidFunds, openFacts, quarterlySeries, trailingTwelveMonths,
  yearAgo, yearTolerance,
} from "../lib/health/facts";
import { CHECK_TEXT, NO_SCORE, NOT_ADVICE, NOTE_BOTTOM_LINE, NOTE_NO_SALES, RULE_SET_CHECKS, saveSnapshot, scoreCompany } from "../lib/health/index";
import type { CheckKey, CompanyProfile, Fundamentals } from "../lib/health/index";
import {
  NET_INCOME_TAGS, firstReportFiled, isBlankCheck, isFund, lostMoneyFromOperations, readMeasures, shareGrowth, ttmOf, verdictOf,
} from "../lib/health/score";
import { finish, test } from "./testing";

/* ------------------------------------------------------------ hand-made facts */

type Row = { start?: string; end: string; val: number; accn: string; form: string; filed: string };
type Period = `${number}Q${1 | 2 | 3 | 4}`;

const plusDays = (date: string, days: number) => new Date(Date.parse(date) + days * 86_400_000).toISOString().slice(0, 10);
const QUARTER_DATES = { 1: ["01-01", "03-31"], 2: ["04-01", "06-30"], 3: ["07-01", "09-30"], 4: ["10-01", "12-31"] } as const;
const quarterOf = (p: Period) => {
  const year = Number(p.slice(0, 4));
  const q = Number(p.slice(5)) as 1 | 2 | 3 | 4;
  return { year, q, start: `${year}-${QUARTER_DATES[q][0]}`, end: `${year}-${QUARTER_DATES[q][1]}` };
};

/** One fact. Filed 40 days after the period ends unless told otherwise. */
function fact(start: string | null, end: string, val: number, o: { filed?: string; form?: string; accn?: string } = {}): Row {
  const filed = o.filed ?? plusDays(end, 40);
  const row: Row = { end, val, accn: o.accn ?? `A-${filed}`, form: o.form ?? "10-Q", filed };
  return start ? { start, ...row } : row;
}

/**
 * What a company with a calendar year files for one measure: each of the first three quarters on its own and
 * year to date in a quarterly report, the full year in the annual report. With `comparatives`, every report
 * also repeats the same period of the year before, as real reports do.
 */
function flow(values: Partial<Record<Period, number>>, o: { comparatives?: boolean; average?: boolean } = {}): Row[] {
  const rows: Row[] = [];
  // Year to date: the quarters added up, or averaged for a measure such as the average share count.
  const sumOfYear = (year: number, upTo: number): number | null => {
    let sum = 0;
    for (let q = 1; q <= upTo; q++) {
      const v = values[`${year}Q${q}` as Period];
      if (v === undefined) return null;
      sum += v;
    }
    return o.average ? sum / upTo : sum;
  };
  for (const key of Object.keys(values) as Period[]) {
    const { year, q, start, end } = quarterOf(key);
    const filing = { filed: plusDays(end, 40), form: q === 4 ? "10-K" : "10-Q", accn: `A-${key}` };
    const report = (y: number) => {
      const shift = (d: string) => `${y}${d.slice(4)}`;
      const own = values[`${y}Q${q}` as Period];
      const toDate = sumOfYear(y, q);
      if (q < 4 && own !== undefined) rows.push(fact(shift(start), shift(end), own, filing));
      if (q > 1 && toDate !== null) rows.push(fact(`${y}-01-01`, shift(end), toDate, filing));
    };
    report(year);
    if (o.comparatives) report(year - 1);
  }
  return rows;
}

const balance = (end: string, val: number, o: { filed?: string; form?: string } = {}): Row => fact(null, end, val, o);

/** The companyfacts shape. `shares` are the tags reported in shares rather than dollars. */
function company(usd: Record<string, Row[]>, shares: Record<string, Row[]> = {}, other: Record<string, Record<string, Row[]>> = {}): unknown {
  const tags: Record<string, { units: Record<string, Row[]> }> = {};
  for (const [tag, rows] of Object.entries(usd)) tags[tag] = { units: { USD: rows } };
  for (const [tag, rows] of Object.entries(shares)) tags[tag] = { units: { shares: rows } };
  for (const [tag, units] of Object.entries(other)) tags[tag] = { units };
  return { cik: 1, entityName: "Hand-made Co", facts: { "us-gaap": tags } };
}

const TEN_QUARTERS: Period[] = ["2024Q1", "2024Q2", "2024Q3", "2024Q4", "2025Q1", "2025Q2", "2025Q3", "2025Q4", "2026Q1", "2026Q2"];
/**
 * Ten quarters of a measure: `before` for the six quarters up to June 2025, then `now` for the newest four
 * (one value, or one per quarter). So each of the newest four quarters is compared with `before` a year earlier.
 */
const tenQuarters = (before: number, now: number | number[]): Partial<Record<Period, number>> =>
  Object.fromEntries(TEN_QUARTERS.map((p, i) => [p, i < 6 ? before : Array.isArray(now) ? now[i - 6] : now]));
const averages = (before: number, now: number) => flow(tenQuarters(before, now), { comparatives: true, average: true });

const TODAY = "2026-08-20"; // the hand-made companies' newest quarter ended 2026-06-30
const OPERATING: CompanyProfile = { sic: "7372", isEmergingGrowth: false };
const YOUNG: CompanyProfile = { sic: "2834", isEmergingGrowth: true };
const row = (f: Fundamentals, key: CheckKey) => {
  const check = f.health.checks.find((c) => c.key === key);
  return check ? check.answers.map((a) => (a === null ? "-" : a ? "T" : "F")).join("") : "(absent)";
};
const series = (rows: Row[]) => Object.fromEntries(quarterlySeries(openFacts(company({ X: rows })).get("X")).points.map((p) => [p.end, p.value]));
const at = "2026-06-30";

/** A company the standard rules can score: sales and profit for ten quarters. */
const steady = (profit2025on: number | number[], sales2025on: number | number[] = 200) =>
  company({ Revenues: flow(tenQuarters(100, sales2025on)), NetIncomeLoss: flow(tenQuarters(20, profit2025on)) });

/** A young company that loses money: sales, losses, cash and a share count. */
function youngCompany(o: { sales?: boolean; shareTag?: string; cashPerQuarter?: number } = {}) {
  const usd: Record<string, Row[]> = {
    NetIncomeLoss: flow(tenQuarters(-50, -40)),
    OperatingIncomeLoss: flow(tenQuarters(-55, -45)),
    NetCashProvidedByUsedInOperatingActivities: flow(tenQuarters(-30, o.cashPerQuarter ?? -30)),
    CashAndCashEquivalentsAtCarryingValue: ["2025-09-30", "2025-12-31", "2026-03-31", "2026-06-30"].map((end, i) => balance(end, [500, 400, 300, 200][i])),
    // It has been filing annual reports since 2021, so its share count can be compared with a year ago.
    Assets: [balance("2020-12-31", 900, { filed: "2021-03-01", form: "10-K" })],
  };
  if (o.sales !== false) usd.Revenues = flow(tenQuarters(100, 150));
  const shares = { [o.shareTag ?? "WeightedAverageNumberOfSharesOutstandingBasic"]: averages(1000, 1100) };
  return company(usd, shares);
}

/* ------------------------------------------------------------------ fixtures */

type FixtureCompany = { file: string; cik: number; name: string; sic: string | null; isEmergingGrowth: boolean };
const FIXTURE_DIR = "lib/health/fixtures";
const FIXTURE_TODAY = "2026-11-10";
const fixtureList = (): FixtureCompany[] => JSON.parse(readFileSync(`${FIXTURE_DIR}/companies.json`, "utf8")).companies;
function fixture(slug: string): { facts: unknown; profile: CompanyProfile; cik: number } {
  const c = fixtureList().find((x) => x.file === `${slug}.json`);
  if (!c) throw new Error(`no fixture called ${slug}`);
  return { facts: JSON.parse(readFileSync(`${FIXTURE_DIR}/${c.file}`, "utf8")), profile: { sic: c.sic, isEmergingGrowth: c.isEmergingGrowth }, cik: c.cik };
}
const scoreFixture = (slug: string, growthRules: boolean) => {
  const { facts, profile } = fixture(slug);
  return scoreCompany(facts, profile, { today: FIXTURE_TODAY, growthRules });
};
const summary = (f: Fundamentals) => `${f.health.ruleSet} ${f.health.verdict ?? "no score"} ${f.health.passed}/${f.health.answered}`;

/* ---------------------------------------------------------------- the tests */

async function buildingBlocks() {
  console.log("health check: building blocks");

  await test("one figure per period: a restated figure from the latest filing replaces the original (correction 5)", () => {
    const original = fact("2024-01-01", "2024-12-31", -100, { filed: "2025-03-01", form: "10-K" });
    const restated = fact("2024-01-01", "2024-12-31", -130, { filed: "2026-03-01", form: "10-K" });
    for (const order of [[original, restated], [restated, original]]) {
      const kept = dedupeDurations(openFacts(company({ X: order })).get("X"));
      assert.equal(kept.length, 1);
      assert.equal(kept[0].val, -130);
    }
    // The fourth quarter is the year minus its first nine months, so it must move with the restated year.
    const nineMonths = fact("2024-01-01", "2024-09-30", -60, { filed: "2024-11-01" });
    assert.equal(series([original, nineMonths, restated])["2024-12-31"], -70);
  });

  await test("one figure per period: an annual or quarterly report beats a later registration filing (correction 12)", () => {
    const report = fact("2025-01-01", "2025-03-31", 10, { filed: "2025-05-10", form: "10-Q" });
    const prospectus = fact("2025-01-01", "2025-03-31", 99, { filed: "2025-09-01", form: "S-1" });
    assert.equal(dedupeDurations(openFacts(company({ X: [report, prospectus] })).get("X"))[0].val, 10);
    assert.equal(dedupeDurations(openFacts(company({ X: [prospectus, report] })).get("X"))[0].val, 10);
    const amended = fact("2025-01-01", "2025-03-31", 12, { filed: "2025-06-20", form: "10-Q/A" });
    assert.equal(dedupeDurations(openFacts(company({ X: [report, amended, prospectus] })).get("X"))[0].val, 12, "between two reports the later one wins");
    assert.equal(dedupeDurations(openFacts(company({ X: [prospectus] })).get("X"))[0].val, 99, "a registration filing is used when it is all there is");
    const balances = [balance("2025-12-31", 500, { filed: "2026-03-01", form: "10-K" }), balance("2025-12-31", 900, { filed: "2026-06-01", form: "424B4" })];
    assert.equal(dedupeInstants(openFacts(company({ Assets: balances })).get("Assets"))[0].val, 500);
    assert.equal(instantAt(openFacts(company({ Assets: balances })).get("Assets"), "2025-12-31")?.value, 500);
  });

  await test("quarterly figures: reported quarters, year-to-date differences, and the year minus three quarters", () => {
    const yearToDate = [
      fact("2025-01-01", "2025-03-31", 10),
      fact("2025-01-01", "2025-06-30", 25),
      fact("2025-01-01", "2025-09-30", 45),
      fact("2025-01-01", "2025-12-31", 70, { form: "10-K" }),
    ];
    assert.deepEqual(series(yearToDate), { "2025-03-31": 10, "2025-06-30": 15, "2025-09-30": 20, "2025-12-31": 25 });
    const points = quarterlySeries(openFacts(company({ X: yearToDate })).get("X")).points;
    assert.deepEqual(points.map((p) => p.derived), [false, true, true, true]);
    assert.equal(points[3].filed, plusDays("2025-12-31", 40));

    const threeQuarters = [
      fact("2024-01-01", "2024-03-31", 1),
      fact("2024-04-01", "2024-06-30", 2),
      fact("2024-07-01", "2024-09-30", 3),
      fact("2024-01-01", "2024-12-31", 10, { form: "10-K" }),
    ];
    assert.equal(series(threeQuarters)["2024-12-31"], 4);
    assert.equal(series(threeQuarters.slice(1))["2024-12-31"], undefined, "with only two quarters known the fourth cannot be worked out");
    assert.deepEqual(series([fact("2025-01-01", "2025-12-31", 70), fact("2025-02-01", "2025-02-28", 5)]), {}, "a year or a month alone is not a quarter");
  });

  await test("fourth quarter that does not add up to the year is left out, not guessed (correction 3)", () => {
    // Edible Garden's pattern: three reported quarters, a mis-tagged nine-month figure, the full year.
    const misTagged = [
      fact("2025-01-01", "2025-03-31", -3_324_000),
      fact("2025-04-01", "2025-06-30", -4_043_000),
      fact("2025-07-01", "2025-09-30", -4_045_000),
      fact("2025-01-01", "2025-09-30", -21_245_000),
      fact("2025-01-01", "2025-12-31", -17_332_000, { form: "10-K" }),
    ];
    const s = series(misTagged);
    assert.equal(s["2025-12-31"], undefined, "year minus nine months would give a profit of 3,913,000 in a year of losses");
    assert.deepEqual([s["2025-03-31"], s["2025-06-30"], s["2025-09-30"]], [-3_324_000, -4_043_000, -4_045_000]);

    // The same year with a correct nine-month figure adds up, so the fourth quarter is used.
    const correct = misTagged.map((f) => (f.end === "2025-09-30" && f.start === "2025-01-01" ? { ...f, val: -11_412_000 } : f));
    assert.equal(series(correct)["2025-12-31"], -5_920_000);
  });

  await test("fourth quarter check: within 1% of the year (or 1,000) is close enough", () => {
    const year = (nineMonths: number, fullYear: number, each: number) => [
      fact("2025-01-01", "2025-03-31", each),
      fact("2025-04-01", "2025-06-30", each),
      fact("2025-07-01", "2025-09-30", each),
      fact("2025-01-01", "2025-09-30", nineMonths),
      fact("2025-01-01", "2025-12-31", fullYear, { form: "10-K" }),
    ];
    assert.equal(yearTolerance(400_000), 4000);
    assert.equal(yearTolerance(-5000), 1000);
    assert.equal(series(year(304_000, 400_000, 100_000))["2025-12-31"], 96_000, "exactly 1% out: kept");
    assert.equal(series(year(304_001, 400_000, 100_000))["2025-12-31"], undefined, "just over 1% out: left out");
    assert.equal(series(year(4_000, 5_000, 1_000))["2025-12-31"], 1_000, "exactly 1,000 out on a small year: kept");
    assert.equal(series(year(4_001, 5_000, 1_000))["2025-12-31"], undefined);
  });

  await test("a stand-alone fourth-quarter fact that contradicts both subtractions is replaced by them (correction 3, T Stamp's pattern)", () => {
    const quarters = [
      fact("2025-01-01", "2025-03-31", -2_157_387),
      fact("2025-04-01", "2025-06-30", -1_711_958),
      fact("2025-07-01", "2025-09-30", -1_911_952),
      fact("2025-01-01", "2025-09-30", -5_781_297),
      fact("2025-01-01", "2025-12-31", -8_325_099, { form: "10-K" }),
    ];
    const fullYearTaggedAsQuarter = fact("2025-10-01", "2025-12-31", -8_330_000, { form: "10-K" });
    const points = quarterlySeries(openFacts(company({ X: [...quarters, fullYearTaggedAsQuarter] })).get("X")).points;
    assert.equal(points[3].value, -2_543_802);
    assert.equal(points[3].derived, true);
    // A stand-alone fact that agrees with the year is simply used.
    assert.equal(series([...quarters, fact("2025-10-01", "2025-12-31", -2_543_802, { form: "10-K" })])["2025-12-31"], -2_543_802);
    // With no nine-month figure there is nothing to settle the disagreement, so the reported fact stays.
    assert.equal(series([...quarters.filter((f) => f.end !== "2025-09-30" || f.start !== "2025-01-01"), fullYearTaggedAsQuarter])["2025-12-31"], -8_330_000);
  });

  await test("the same quarter a year ago, and quarters in a row", () => {
    const s = quarterlySeries(openFacts(company({ X: flow(tenQuarters(1, 2)) })).get("X"));
    assert.equal(yearAgo(s, "2026-06-30")?.end, "2025-06-30");
    assert.equal(yearAgo(s, "2024-06-30"), null);
    assert.equal(areConsecutive(["2025-09-30", "2025-12-31", "2026-03-31", "2026-06-30"]), true);
    assert.equal(areConsecutive(["2025-06-30", "2025-09-30", "2026-03-31", "2026-06-30"]), false);
    assert.equal(areConsecutive(["2025-09-27", "2025-12-27", "2026-03-28", "2026-06-27"]), true, "52-week calendars");
  });

  await test("last twelve months: a full year, or last year + this year so far - the same stretch last year, or four quarters", () => {
    const rows = flow({ "2025Q1": 10, "2025Q2": 15, "2025Q3": 20, "2025Q4": 25, "2026Q1": 30, "2026Q2": 10 });
    const facts = openFacts(company({ X: rows })).get("X");
    assert.equal(trailingTwelveMonths(facts, "2025-12-31")?.value, 70);
    assert.equal(trailingTwelveMonths(facts, "2026-06-30")?.value, 70 + 40 - 25);
    assert.equal(trailingTwelveMonths(facts, "2026-06-30")?.filed, plusDays("2026-06-30", 40));
    const quartersOnly = (["2025Q3", "2026Q1", "2026Q2"] as Period[]).map((p) => fact(quarterOf(p).start, quarterOf(p).end, 7));
    const q4 = fact("2025-10-01", "2025-12-31", 9);
    assert.equal(trailingTwelveMonths(openFacts(company({ X: [...quartersOnly, q4] })).get("X"), "2026-06-30")?.value, 30);
    assert.equal(trailingTwelveMonths(openFacts(company({ X: quartersOnly })).get("X"), "2026-06-30"), null, "three quarters are not twelve months");
    assert.equal(trailingTwelveMonths([], "2026-06-30"), null);
  });

  await test("one tag per measure: the twelve-month total comes from the tag chosen for the quarters (correction 11)", () => {
    const source = openFacts(company({ NetIncomeLoss: flow(tenQuarters(-1, -10)), ProfitLoss: flow(tenQuarters(-1, -25)) }));
    assert.equal(ttmOf(source, NET_INCOME_TAGS, at, "ProfitLoss")?.value, -100);
    assert.equal(ttmOf(source, NET_INCOME_TAGS, at, "NetIncomeLoss")?.value, -40);
    const onlyFirst = openFacts(company({ NetIncomeLoss: flow(tenQuarters(-1, -10)) }));
    assert.equal(ttmOf(onlyFirst, NET_INCOME_TAGS, at, "ProfitLoss")?.value, -40, "another tag is used only when the chosen one has nothing");
    assert.equal(bestSeries(source, NET_INCOME_TAGS).tag, "NetIncomeLoss", "on a tie the tag listed first is read");
  });

  await test("sales reported as collaboration revenue are read (correction 10)", () => {
    const m = readMeasures(openFacts(company({ RevenueFromCollaborativeArrangementExcludingRevenueFromContractWithCustomer: flow(tenQuarters(5, 9)) })));
    assert.equal(m.revenue.tag, "RevenueFromCollaborativeArrangementExcludingRevenueFromContractWithCustomer");
    assert.equal(m.revenue.series.at.get(at)?.value, 9);
  });

  await test("cash and investments are built from balance-sheet lines, nothing counted twice (correction 2)", () => {
    const funds = (lines: Record<string, number>) => liquidFunds(openFacts(company(Object.fromEntries(Object.entries(lines).map(([tag, v]) => [tag, [balance(at, v)]])))), at)?.value ?? null;
    const RESTRICTED = "CashCashEquivalentsRestrictedCashAndRestrictedCashEquivalents";
    const FOOTNOTE = "DebtSecuritiesAvailableForSaleExcludingAccruedInterest";

    assert.equal(funds({ CashAndCashEquivalentsAtCarryingValue: 100, [RESTRICTED]: 150 }), 100, "cash set aside does not count when free cash is reported");
    assert.equal(funds({ Cash: 80, [RESTRICTED]: 150 }), 80);
    assert.equal(funds({ [RESTRICTED]: 150 }), 150, "used only when it is the only cash figure");
    assert.equal(funds({ Assets: 900 }), null, "no cash figure: unknown");
    assert.equal(funds({ CashAndCashEquivalentsAtCarryingValue: 100, MarketableSecuritiesCurrent: 50, MarketableSecuritiesNoncurrent: 30 }), 180);
    assert.equal(funds({ CashAndCashEquivalentsAtCarryingValue: 100, [FOOTNOTE]: 70 }), 170, "a footnote total is used when there is no balance-sheet line");
    assert.equal(funds({ CashAndCashEquivalentsAtCarryingValue: 100, MarketableSecuritiesCurrent: 50, [FOOTNOTE]: 70 }), 150, "and ignored when there is one");

    // Absci, 30 June 2026: the footnote total (191,676) includes cash equivalents already in cash. The first
    // proposal added it to cash and reported 300,595 - more than everything the company owned (268,917).
    const june = { CashAndCashEquivalentsAtCarryingValue: 107_865, [RESTRICTED]: 108_919, MarketableSecuritiesCurrent: 93_277, MarketableSecuritiesNoncurrent: 0, [FOOTNOTE]: 191_676, AssetsCurrent: 208_266, Assets: 268_917 };
    assert.equal(funds(june), 201_142);
    // Absci, 30 September 2025: the "noncurrent" 32,600 is part of the 142,999 on the balance sheet (all its
    // securities together are 143,191), so the two lines may not be added.
    const september = { CashAndCashEquivalentsAtCarryingValue: 9_476, [RESTRICTED]: 26_871, MarketableSecuritiesCurrent: 142_999, MarketableSecuritiesNoncurrent: 32_600, [FOOTNOTE]: 143_191, AssetsCurrent: 174_994 };
    assert.equal(funds(september), 9_476 + 143_191);
    // A "total" smaller than one of the lines is not a total of them (BioAge tags its long-term line this way).
    assert.equal(funds({ CashAndCashEquivalentsAtCarryingValue: 74, MarketableSecuritiesCurrent: 245, MarketableSecuritiesNoncurrent: 62, MarketableSecurities: 62 }), 381);

    assert.equal(funds({ CashAndCashEquivalentsAtCarryingValue: 100, [FOOTNOTE]: 500, AssetsCurrent: 300, LongTermInvestments: 50 }), 350, "never more than current assets plus long-term investments");
    assert.equal(funds({ CashAndCashEquivalentsAtCarryingValue: 100, MarketableSecuritiesCurrent: 50, CashCashEquivalentsAndShortTermInvestments: 170 }), 170, "a combined cash-and-investments figure is a floor");
    assert.equal(funds({ CashAndCashEquivalentsAtCarryingValue: 100, MarketableSecuritiesCurrent: 50, CashCashEquivalentsAndShortTermInvestments: 120 }), 150);
    const nearDate = openFacts(company({ Cash: [balance("2026-06-27", 42)] }));
    assert.equal(liquidFunds(nearDate, at)?.value, 42, "a balance within 6 days of the quarter end is that quarter's");
    assert.equal(liquidFunds(openFacts(company({ Cash: [balance("2026-06-20", 42)] })), at), null);
  });

  await test("share count: compared with a year ago inside the same report", () => {
    const TAG = "WeightedAverageNumberOfSharesOutstandingBasic";
    const source = openFacts(company({}, { [TAG]: averages(1000, 1200) }));
    assert.ok(Math.abs((shareGrowth(source, at, "2020-05-01")?.value ?? NaN) - 0.2) < 1e-12);
    assert.equal(shareGrowth(source, at, "2025-08-01"), null, "not yet filing reports for the whole year-ago quarter: no answer");
    assert.equal(shareGrowth(source, at, null), null);
    assert.equal(shareGrowth(source, "2026-09-30", "2020-05-01"), null, "no figures for the quarter");
    // A split between two reports does not distort it: the newest report restates last year's count too.
    const split = [
      fact("2025-04-01", "2025-06-30", 1000, { accn: "OLD", filed: "2025-08-09" }),
      fact("2026-04-01", "2026-06-30", 110, { accn: "NEW", filed: "2026-08-09" }),
      fact("2025-04-01", "2025-06-30", 100, { accn: "NEW", filed: "2026-08-09" }),
    ];
    assert.ok(Math.abs((shareGrowth(openFacts(company({}, { [TAG]: split })), at, "2020-05-01")?.value ?? NaN) - 0.1) < 1e-12);
  });

  await test("share count: the diluted figure is read when it is the only one (correction 7)", () => {
    const source = openFacts(company({}, { WeightedAverageNumberOfDilutedSharesOutstanding: averages(100, 3800) }));
    assert.equal(shareGrowth(source, at, "2020-05-01")?.value, 37);
    const both = openFacts(company({}, {
      WeightedAverageNumberOfDilutedSharesOutstanding: averages(100, 3800),
      WeightedAverageNumberOfSharesOutstandingBasic: averages(100, 110),
    }));
    assert.ok(Math.abs((shareGrowth(both, at, "2020-05-01")?.value ?? NaN) - 0.1) < 1e-12, "the basic count comes first");
  });

  await test("share count: a first annual report on a foreign-issuer form counts as reporting (correction 8)", () => {
    const TAG = "WeightedAverageNumberOfSharesOutstandingBasic";
    const shares = averages(1000, 1500);
    const usReportsOnly = openFacts(company({ Assets: [balance("2025-06-30", 1, { filed: "2025-08-09", form: "10-Q" })] }, { [TAG]: shares.filter((r) => r.filed >= "2025-08-09") }));
    assert.equal(firstReportFiled(usReportsOnly), "2025-08-09");
    assert.equal(shareGrowth(usReportsOnly, at, firstReportFiled(usReportsOnly)), null);
    const filedAbroadFirst = openFacts(company(
      { Assets: [balance("2023-12-31", 1, { filed: "2024-03-14", form: "40-F" }), balance("2025-06-30", 1, { filed: "2025-08-09", form: "10-Q" })] },
      { [TAG]: shares.filter((r) => r.filed >= "2025-08-09") },
    ));
    assert.equal(firstReportFiled(filedAbroadFirst), "2024-03-14");
    assert.equal(shareGrowth(filedAbroadFirst, at, firstReportFiled(filedAbroadFirst))?.value, 0.5);
    const prospectusOnly = openFacts(company({ Assets: [balance("2023-12-31", 1, { filed: "2024-03-14", form: "S-1" })] }));
    assert.equal(firstReportFiled(prospectusOnly), null, "a registration filing is not a report");
  });

  await test("share count: the fourth quarter's average is worked out from the year and the other three quarters (correction 9)", () => {
    const TAG = "WeightedAverageNumberOfSharesOutstandingBasic";
    const tenQ = (p: Period, now: number, before: number) => {
      const { year, start, end } = quarterOf(p);
      const o = { accn: `A-${p}`, filed: plusDays(end, 40) };
      return [fact(start, end, now, o), fact(`${year - 1}${start.slice(4)}`, `${year - 1}${end.slice(4)}`, before, o)];
    };
    const annual = (now: number, before: number) => [
      fact("2025-01-01", "2025-12-31", now, { accn: "K-2025", form: "10-K", filed: "2026-03-01" }),
      fact("2024-01-01", "2024-12-31", before, { accn: "K-2025", form: "10-K", filed: "2026-03-01" }),
    ];
    const quarters = [...tenQ("2025Q1", 100, 99), ...tenQ("2025Q2", 105, 100), ...tenQ("2025Q3", 115, 100)];
    // Year averages 115 and 100: up 15%. But the fourth quarters are 4x115-320 = 140 and 4x100-299 = 101: up 39%.
    const source = openFacts(company({}, { [TAG]: [...quarters, ...annual(115, 100)] }));
    const growth = shareGrowth(source, "2025-12-31", "2020-05-01")?.value ?? NaN;
    assert.ok(Math.abs(growth - (140 / 101 - 1)) < 1e-12, `expected about 0.386, got ${growth}`);
    // After a reverse split the annual report counts shares differently from the earlier quarterly reports, the
    // subtraction goes negative, and the year-on-year averages (both from the annual report) are used instead.
    const afterSplit = openFacts(company({}, { [TAG]: [...quarters, ...annual(10, 8)] }));
    assert.equal(shareGrowth(afterSplit, "2025-12-31", "2020-05-01")?.value, 0.25);
    // With a quarter missing, the same fallback.
    const twoQuarters = openFacts(company({}, { [TAG]: [...quarters.slice(0, 4), ...annual(115, 100)] }));
    assert.ok(Math.abs((shareGrowth(twoQuarters, "2025-12-31", "2020-05-01")?.value ?? NaN) - 0.15) < 1e-12);
  });

  await test("share count: figures from an annual or quarterly report are preferred to a registration filing's (correction 12)", () => {
    const TAG = "WeightedAverageNumberOfSharesOutstandingBasic";
    const rows = [
      fact("2026-04-01", "2026-06-30", 900, { accn: "S1", form: "S-1", filed: "2026-07-15" }),
      fact("2025-04-01", "2025-06-30", 100, { accn: "S1", form: "S-1", filed: "2026-07-15" }),
      fact("2026-04-01", "2026-06-30", 120, { accn: "Q", form: "10-Q", filed: "2026-08-09" }),
      fact("2025-04-01", "2025-06-30", 100, { accn: "Q", form: "10-Q", filed: "2026-08-09" }),
    ];
    assert.ok(Math.abs((shareGrowth(openFacts(company({}, { [TAG]: rows })), at, "2020-05-01")?.value ?? NaN) - 0.2) < 1e-12);
  });

  await test("verdict cut-offs: 75% Strong, 50% Mixed, under 50% Weak, fewer than 8 answers no score", () => {
    const answers = (pass: number, fail: number, none = 0) => [...Array(pass).fill(true), ...Array(fail).fill(false), ...Array(none).fill(null)];
    assert.deepEqual(verdictOf(answers(12, 4)), { verdict: "Strong", passed: 12, answered: 16 });
    assert.equal(verdictOf(answers(6, 2)).verdict, "Strong", "exactly 75%");
    assert.equal(verdictOf(answers(11, 4)).verdict, "Mixed", "73%");
    assert.equal(verdictOf(answers(8, 8)).verdict, "Mixed", "exactly 50%");
    assert.equal(verdictOf(answers(4, 4)).verdict, "Mixed");
    assert.equal(verdictOf(answers(7, 8)).verdict, "Weak", "47%");
    assert.equal(verdictOf(answers(0, 8)).verdict, "Weak");
    assert.deepEqual(verdictOf(answers(7, 0, 9)), { verdict: null, passed: 7, answered: 7 });
    assert.equal(verdictOf(answers(10, 0)).verdict, "Strong", "8 or more answers is enough: there is no higher minimum");
    assert.equal(verdictOf([]).verdict, null);
  });

  await test("lost money from operations: a missing twelve-month figure is unknown, never 'profitable' (correction 4)", () => {
    const ask = (ttmOperatingIncome: number | null, ttmNetIncome: number | null, operating: (number | null)[], net: (number | null)[]) =>
      lostMoneyFromOperations({ ttmOperatingIncome, ttmNetIncome, operatingIncomeQuarters: operating, netIncomeQuarters: net });
    const none = [null, null, null, null];
    assert.equal(ask(-5, 9, none, none), true, "the operating result comes first");
    assert.equal(ask(5, -9, none, none), false);
    assert.equal(ask(null, -9, none, none), true, "then the net result");
    assert.equal(ask(0, null, none, none), false);
    assert.equal(ask(null, null, [null, null, -3, -4], [1, 1, 1, 1]), true, "no twelve-month figure: the quarters that are known, operating first");
    assert.equal(ask(null, null, [null, null, null, -4], [null, null, 2, 3]), false, "one quarter is not enough; two net quarters are");
    assert.equal(ask(null, null, [null, null, null, -4], [null, null, null, -3]), null, "still unknown");
    assert.equal(ask(null, null, none, none), null);
  });

  await test("funds: by industry code or a net asset value per share in the last two years; code 6199 alone is not a fund (correction 6)", () => {
    const empty = openFacts({});
    for (const sic of ["6221", "6189", "6722", "6726"]) assert.equal(isFund(empty, { sic, isEmergingGrowth: true }, TODAY), true, sic);
    assert.equal(isFund(empty, { sic: "6199", isEmergingGrowth: true }, TODAY), false);
    assert.equal(isFund(empty, { sic: null, isEmergingGrowth: null }, TODAY), false);
    const nav = (end: string) => openFacts(company({}, {}, { NetAssetValuePerShare: { "USD/shares": [balance(end, 25.1)] } }));
    assert.equal(isFund(nav("2026-06-30"), { sic: null, isEmergingGrowth: true }, TODAY), true);
    assert.equal(isFund(nav("2023-06-30"), { sic: "6199", isEmergingGrowth: true }, TODAY), false, "a net asset value from three years ago does not count");
  });

  await test("blank-check companies: by the trust account, or by the industry code when there are no sales (correction 13)", () => {
    const blank: CompanyProfile = { sic: "6770", isEmergingGrowth: true };
    const empty = openFacts({});
    assert.equal(isBlankCheck(empty, blank, at, false), true);
    assert.equal(isBlankCheck(empty, blank, at, true), false, "the code stays on a company after it merges with a real business");
    assert.equal(isBlankCheck(empty, blank, null, false), true);
    const trust = (held: number, assets: number, end = at) => openFacts(company({ AssetsHeldInTrustNoncurrent: [balance(end, held)], Assets: [balance(at, assets)] }));
    assert.equal(isBlankCheck(trust(60, 100), OPERATING, at, true), true, "more than half of assets held in trust, whatever the code says");
    assert.equal(isBlankCheck(trust(50, 100), OPERATING, at, true), false, "exactly half is not more than half");
    assert.equal(isBlankCheck(trust(60, 100, "2026-05-31"), OPERATING, at, true), true, "a balance within 40 days counts");
    assert.equal(isBlankCheck(empty, OPERATING, at, false), false);
  });
}

async function scoring() {
  console.log("health check: scoring a company");

  await test("standard rules: Strong at exactly 75%, Mixed at exactly 50%, Weak just under", () => {
    // Sales doubled and profit rose from 20 to 30 every quarter, but the margin fell from 20% to 15%: 12 of 16.
    const strong = scoreCompany(steady(30), OPERATING, { today: TODAY, growthRules: false });
    assert.equal(summary(strong), "standard Strong 12/16");
    assert.deepEqual([row(strong, "salesGrew"), row(strong, "madeProfit"), row(strong, "profitGrew"), row(strong, "marginHeld")], ["TTTT", "TTTT", "TTTT", "FFFF"]);
    assert.equal(strong.health.noScoreReason, null);
    assert.deepEqual(strong.health.quarters.map((q) => q.end), ["2025-09-30", "2025-12-31", "2026-03-31", "2026-06-30"]);
    assert.equal(strong.health.quarters[3].filed, plusDays("2026-06-30", 40));
    assert.deepEqual(strong.health.checks.map((c) => [c.key, c.label, c.hint, c.counted]), RULE_SET_CHECKS.standard.map((k) => [k, CHECK_TEXT[k].label, CHECK_TEXT[k].hint, true]));

    // One quarter (the newest) where profit did not grow: 11 of 16 = 69%.
    assert.equal(summary(scoreCompany(steady([30, 30, 30, 20]), OPERATING, { today: TODAY, growthRules: false })), "standard Mixed 11/16");
    // Profit positive but lower than a year ago in every quarter: 8 of 16.
    const mixed = scoreCompany(steady(15), OPERATING, { today: TODAY, growthRules: false });
    assert.equal(summary(mixed), "standard Mixed 8/16");
    // ... and a loss in the newest quarter: 7 of 16.
    const weak = scoreCompany(steady([15, 15, 15, -1]), OPERATING, { today: TODAY, growthRules: false });
    assert.equal(summary(weak), "standard Weak 7/16");
    assert.equal(row(weak, "madeProfit"), "TTTF");

    // "Profit" is profit from operations (owner, Nov 13, 2026). A company whose bottom line is positive only
    // because of accounting gains, while its business loses money, has not made a profit.
    const paperGains = company({
      Revenues: flow(tenQuarters(100, 200)),
      NetIncomeLoss: flow(tenQuarters(20, 30)),
      OperatingIncomeLoss: flow(tenQuarters(-10, -40)),
    });
    const fooled = scoreCompany(paperGains, OPERATING, { today: TODAY, growthRules: false });
    assert.deepEqual([row(fooled, "salesGrew"), row(fooled, "madeProfit"), row(fooled, "profitGrew"), row(fooled, "marginHeld")], ["TTTT", "FFFF", "FFFF", "FFFF"]);
    assert.equal(summary(fooled), "standard Weak 4/16");
    assert.deepEqual(fooled.health.notes, []);
    // ... and the other way round: a one-off charge below the line does not hide a business that earns money.
    const oneOffCharge = company({
      Revenues: flow(tenQuarters(100, 200)),
      NetIncomeLoss: flow(tenQuarters(20, -5)),
      OperatingIncomeLoss: flow(tenQuarters(20, 45)),
    });
    assert.equal(row(scoreCompany(oneOffCharge, OPERATING, { today: TODAY, growthRules: false }), "madeProfit"), "TTTT");
    // A company that reports no profit-from-operations line (a bank): the bottom line is used, and the page says so.
    assert.deepEqual(strong.health.notes, [NOTE_BOTTOM_LINE]);
  });

  await test("the other numbers on the page: quarters, twelve-month totals, cash, newest filing used", () => {
    const f = scoreCompany(youngCompany({ cashPerQuarter: -30 }), OPERATING, { today: TODAY, growthRules: false });
    assert.equal(f.asOf, TODAY);
    assert.equal(f.quarters.length, 8);
    assert.deepEqual(f.quarters[0], { end: "2024-09-30", revenue: 100, netIncome: -50, operatingIncome: -55 });
    assert.deepEqual(f.quarters[7], { end: "2026-06-30", revenue: 150, netIncome: -40, operatingIncome: -45 });
    assert.deepEqual(f.ttm, { revenue: 600, netIncome: -160, operatingIncome: -180, operatingCashFlow: -120 });
    assert.deepEqual(f.cash, { liquid: 200, asOf: "2026-06-30", quarterlySpend: 30, months: 20 });
    assert.equal(f.sourceFiled, plusDays("2026-06-30", 40));
    const earning = scoreCompany(youngCompany({ cashPerQuarter: 5 }), OPERATING, { today: TODAY, growthRules: false });
    assert.deepEqual(earning.cash, { liquid: 200, asOf: "2026-06-30", quarterlySpend: null, months: "cash-flow positive" });
  });

  await test("no score: fewer than 8 answers", () => {
    // Four quarters and nothing to compare them with: only "made a profit" can be answered.
    const short = company({ NetIncomeLoss: (["2025Q3", "2026Q1", "2026Q2"] as Period[]).map((p) => fact(quarterOf(p).start, quarterOf(p).end, 5)).concat(fact("2025-10-01", "2025-12-31", 5)) });
    const f = scoreCompany(short, OPERATING, { today: TODAY, growthRules: false });
    assert.equal(f.health.verdict, null);
    assert.equal(f.health.noScoreReason, NO_SCORE.notEnoughReports);
    assert.equal(f.health.noScoreReason, "Not enough quarterly reports yet (needs 4). Shows up after the company's next quarterly report.");
    assert.equal(f.health.answered, 4);
    assert.equal(f.health.quarters.length, 4);
    assert.equal(row(f, "madeProfit"), "TTTT");
  });

  await test("no score: the four quarters must be in a row (correction 1)", () => {
    const withGap = (rows: Row[]) => rows.filter((r) => r.end !== "2025-12-31");
    const facts = company({ Revenues: withGap(flow(tenQuarters(100, 200))), NetIncomeLoss: withGap(flow(tenQuarters(20, 30))) });
    const f = scoreCompany(facts, OPERATING, { today: TODAY, growthRules: false });
    assert.equal(f.health.verdict, null, "the newest four are Jun 2025, Sep 2025, Mar 2026, Jun 2026: one is missing in between");
    assert.equal(f.health.noScoreReason, NO_SCORE.notEnoughReports);
    assert.deepEqual(f.health.checks, []);
    assert.equal(f.quarters.length, 8, "the numbers that exist are still shown");
    const three = company({ NetIncomeLoss: flow({ "2025Q4": 1, "2026Q1": 1, "2026Q2": 1 }) });
    assert.equal(scoreCompany(three, OPERATING, { today: TODAY, growthRules: false }).health.noScoreReason, NO_SCORE.notEnoughReports);
  });

  await test("no score: newest quarter more than 230 days old", () => {
    const facts = steady(30);
    assert.equal(scoreCompany(facts, OPERATING, { today: plusDays("2026-06-30", 230), growthRules: false }).health.verdict, "Strong");
    const stale = scoreCompany(facts, OPERATING, { today: plusDays("2026-06-30", 231), growthRules: false });
    assert.equal(stale.health.verdict, null);
    assert.equal(stale.health.noScoreReason, "The company's latest quarterly report is too old to score.");
  });

  await test("no score: blank-check companies and funds, whatever the flag", () => {
    for (const growthRules of [true, false]) {
      const spac = scoreCompany(youngCompany({ sales: false }), { sic: "6770", isEmergingGrowth: true }, { today: TODAY, growthRules });
      assert.equal(spac.health.verdict, null);
      assert.equal(spac.health.noScoreReason, "Blank-check companies (SPACs) get no health check.");
      assert.equal(spac.health.ruleSet, "standard");
      const fund = scoreCompany(steady(30), { sic: "6726", isEmergingGrowth: true }, { today: TODAY, growthRules });
      assert.equal(fund.health.noScoreReason, "Funds get no health check.");
      // Code 6770 but with sales (it merged with a business) and code 6199 are scored like any company.
      assert.equal(scoreCompany(steady(30), { sic: "6770", isEmergingGrowth: false }, { today: TODAY, growthRules }).health.verdict, "Strong");
      assert.equal(scoreCompany(steady(30), { sic: "6199", isEmergingGrowth: false }, { today: TODAY, growthRules }).health.verdict, "Strong");
    }
  });

  await test("odd or missing data never throws: no score, with a reason", () => {
    const ifrsOnly = { facts: { "ifrs-full": { ProfitLoss: { units: { USD: flow(tenQuarters(1, 2)) } } }, dei: {} } };
    const emptyArrays = { facts: { "us-gaap": { NetIncomeLoss: { units: { USD: [] } }, Revenues: { units: { USD: [] } }, Assets: { units: {} } } } };
    const rubbish = { facts: { "us-gaap": { NetIncomeLoss: { units: { USD: [null, 7, "x", {}, { end: "not a date", val: 1, filed: "2026-01-01" }, { start: "2026-04-01", end: "2026-06-30", val: "12", filed: "2026-08-01" }, { start: "2026-07-01", end: "2026-06-30", val: 1, filed: "2026-08-01" }] } }, Revenues: 5, Assets: { units: [1, 2] } } } };
    const cases: [string, unknown][] = [
      ["{}", {}], ["null", null], ["undefined", undefined], ["a string", "facts"], ["a number", 42], ["an array", []],
      ["facts: null", { facts: null }], ["only international-rules figures", ifrsOnly], ["every list empty", emptyArrays], ["rubbish inside", rubbish],
      ["figures in another currency", { facts: { "us-gaap": { NetIncomeLoss: { units: { CAD: flow(tenQuarters(1, 2)) } } } } }],
    ];
    for (const [name, facts] of cases) {
      for (const growthRules of [true, false]) {
        const f = scoreCompany(facts, YOUNG, { today: TODAY, growthRules });
        assert.equal(f.health.verdict, null, name);
        assert.equal(f.health.noScoreReason, "This company's SEC filings don't include the numbers the health check needs.", name);
        assert.deepEqual([f.health.passed, f.health.answered, f.health.quarters, f.health.checks, f.quarters, f.sourceFiled], [0, 0, [], [], [], null], name);
        assert.deepEqual(f.ttm, { revenue: null, netIncome: null, operatingIncome: null, operatingCashFlow: null }, name);
      }
    }
    // A missing profile is treated as "nothing known", and a bad date for today is a programming error.
    assert.equal(scoreCompany(steady(30), { sic: null, isEmergingGrowth: null }, { today: TODAY, growthRules: true }).health.verdict, "Strong");
    assert.equal(scoreCompany(steady(30), undefined as unknown as CompanyProfile, { today: TODAY, growthRules: true }).health.verdict, "Strong");
    assert.throws(() => scoreCompany({}, OPERATING, { today: "yesterday", growthRules: false }), /ISO date/);
  });

  await test("growth rules: only with the flag on, for an emerging growth company that lost money from operations", () => {
    const facts = youngCompany();
    const on = { today: TODAY, growthRules: true };
    const growth = scoreCompany(facts, YOUNG, on);
    assert.equal(growth.health.ruleSet, "growth");
    assert.deepEqual(growth.health.checks.map((c) => c.key), ["salesGrew", "closerToProfit", "yearCash", "twoYearsCash", "fewNewShares"]);
    // Sales 100 -> 150, operating loss 55 -> 45 of sales, cash 500/400/300/200 against 120 a year, shares up 10%.
    assert.deepEqual(["salesGrew", "closerToProfit", "yearCash", "twoYearsCash", "fewNewShares"].map((k) => row(growth, k as CheckKey)), ["TTTT", "TTTT", "TTTT", "TTTF", "TTTT"]);
    assert.equal(summary(growth), "growth Strong 19/20");
    assert.deepEqual(growth.health.notes, []);

    assert.equal(scoreCompany(facts, { ...YOUNG, isEmergingGrowth: false }, on).health.ruleSet, "standard");
    assert.equal(scoreCompany(facts, { ...YOUNG, isEmergingGrowth: null }, on).health.ruleSet, "standard", "not known to be an emerging growth company");
    assert.equal(scoreCompany(steady(30), YOUNG, on).health.ruleSet, "standard", "a profitable emerging growth company keeps the standard rules");
    // The same company on the standard rules: sales up, losses smaller, margin better, but never a profit.
    const off = scoreCompany(facts, YOUNG, { today: TODAY, growthRules: false });
    assert.equal(summary(off), "standard Strong 12/16");
    assert.equal(row(off, "madeProfit"), "FFFF");
    assert.equal(scoreCompany(facts, YOUNG, { today: TODAY, growthRules: "yes" as unknown as boolean }).health.ruleSet, "standard", "anything but true keeps the flag off");
  });

  await test("growth rules: with no sales yet the two sales checks do not count", () => {
    const f = scoreCompany(youngCompany({ sales: false }), YOUNG, { today: TODAY, growthRules: true });
    assert.equal(f.health.ruleSet, "growth");
    assert.deepEqual(f.health.notes, ["No sales yet, so the two sales checks don't count."]);
    assert.deepEqual(f.health.notes, [NOTE_NO_SALES]);
    assert.deepEqual(f.health.checks.map((c) => [c.key, c.counted]), [["salesGrew", false], ["closerToProfit", false], ["yearCash", true], ["twoYearsCash", true], ["fewNewShares", true]]);
    assert.deepEqual([row(f, "salesGrew"), row(f, "closerToProfit")], ["----", "----"]);
    assert.equal(summary(f), "growth Strong 11/12");
    // Sales under a tenth of costs count as no sales: 15 a quarter against costs of 60.
    const tiny = company({ Revenues: flow(tenQuarters(10, 15)), NetIncomeLoss: flow(tenQuarters(-150, -140)), OperatingIncomeLoss: flow(tenQuarters(-150, -145)) });
    assert.deepEqual(scoreCompany(tiny, YOUNG, { today: TODAY, growthRules: true }).health.notes, [NOTE_NO_SALES]);
  });

  await test("growth rules switched off: the growth checks are never even looked up", () => {
    const facts = youngCompany() as { facts: Record<string, Record<string, unknown>> };
    const run = (growthRules: boolean) => {
      const read = new Set<string>();
      const watched = { ...facts, facts: { "us-gaap": new Proxy(facts.facts["us-gaap"], { get: (target, key) => (typeof key === "string" && read.add(key), Reflect.get(target, key)) }) } };
      const f = scoreCompany(watched, YOUNG, { today: TODAY, growthRules });
      return { f, shareTagsRead: [...read].filter((tag) => tag.startsWith("WeightedAverageNumberOf")) };
    };
    const off = run(false);
    assert.equal(off.f.health.ruleSet, "standard");
    assert.deepEqual(off.shareTagsRead, [], "the share count is only used by the growth rules");
    assert.ok(run(true).shareTagsRead.length > 0, "the same company with the flag on does read it");
  });

  await test("plain English: no form codes and no trading words in anything a visitor can see", () => {
    const facts = youngCompany({ sales: false });
    const shown: string[] = [NOT_ADVICE, NOTE_NO_SALES, ...Object.values(NO_SCORE), ...Object.values(CHECK_TEXT).flatMap((t) => [t.label, t.hint])];
    for (const growthRules of [true, false]) {
      const h = scoreCompany(facts, YOUNG, { today: TODAY, growthRules }).health;
      shown.push(...h.notes, ...h.checks.flatMap((c) => [c.label, c.hint]));
    }
    for (const text of shown) {
      assert.doesNotMatch(text, /\b(buy|sell|buying|selling)\b/i, text);
      assert.doesNotMatch(text, /\b(10-?[QK]|8-?K|20-?F|40-?F|S-?1|EGC|TTM|XBRL)\b/, text);
    }
    assert.match(NOT_ADVICE, /not investment advice/i);
    assert.equal(CHECK_TEXT.fewNewShares.hint, "Share count up 20% or less on a year ago");
    assert.equal(CHECK_TEXT.closerToProfit.label, "Got closer to profit");
  });
}

async function realCompanies() {
  console.log(`health check: real companies (as of ${FIXTURE_TODAY})`);
  const rows = (f: Fundamentals) => Object.fromEntries(f.health.checks.map((c) => [c.key, row(f, c.key)]));

  await test("fixtures: at most 10 companies, each file well under 200 KB, each with its profile", () => {
    const list = fixtureList();
    assert.ok(list.length >= 9 && list.length <= 10);
    for (const c of list) {
      assert.ok(readFileSync(`${FIXTURE_DIR}/${c.file}`).length < 100_000, c.file);
      assert.ok(c.name && typeof c.isEmergingGrowth === "boolean" && c.cik > 0, c.file);
    }
  });

  await test("Beta Bionics: growth rules, Strong", () => {
    const f = scoreFixture("beta-bionics", true);
    assert.equal(summary(f), "growth Strong 17/18");
    assert.deepEqual(rows(f), { salesGrew: "TTTT", closerToProfit: "TTTF", yearCash: "TTTT", twoYearsCash: "TTTT", fewNewShares: "--TT" });
    assert.deepEqual(f.health.quarters, [
      { end: "2025-12-31", filed: "2026-02-24" }, { end: "2026-03-31", filed: "2026-04-21" }, { end: "2026-06-30", filed: "2026-07-29" }, { end: "2026-09-30", filed: "2026-10-27" },
    ]);
    assert.deepEqual(f.ttm, { revenue: 127_265_000, netIncome: -83_117_000, operatingIncome: -92_582_000, operatingCashFlow: -59_368_000 });
    assert.equal(f.cash.liquid, 240_204_000);
    assert.equal(f.cash.quarterlySpend, 14_842_000);
    assert.equal(Math.round(Number(f.cash.months) * 10) / 10, 48.6);
    assert.equal(f.sourceFiled, "2026-10-27");
    assert.equal(summary(scoreFixture("beta-bionics", false)), "standard Weak 7/16");
  });

  await test("i-80 Gold: growth rules, Mixed; its first reports were on a foreign-issuer form (correction 8)", () => {
    const f = scoreFixture("i-80-gold", true);
    assert.equal(summary(f), "growth Mixed 10/20");
    assert.deepEqual(rows(f), { salesGrew: "FTFT", closerToProfit: "FTFF", yearCash: "FTTT", twoYearsCash: "FTTT", fewNewShares: "FFFT" });
    assert.equal(firstReportFiled(openFacts(fixture("i-80-gold").facts)), "2023-03-14");
    assert.equal(summary(scoreFixture("i-80-gold", false)), "standard Weak 3/16");
  });

  await test("T Stamp: growth rules, Weak; the mis-tagged fourth quarter is corrected (correction 3)", () => {
    const f = scoreFixture("t-stamp", true);
    assert.equal(summary(f), "growth Weak 6/20");
    assert.deepEqual(rows(f), { salesGrew: "TFTT", closerToProfit: "TFTF", yearCash: "FTFF", twoYearsCash: "FFFF", fewNewShares: "FFFF" });
    assert.equal(f.quarters.find((q) => q.end === "2025-12-31")?.netIncome, -2_543_802, "not the full-year loss of 8,330,000 the annual report tags as the quarter");
    const standard = scoreFixture("t-stamp", false);
    assert.equal(summary(standard), "standard Weak 6/16");
    assert.deepEqual(rows(standard), { salesGrew: "TFTT", madeProfit: "FFFF", profitGrew: "TFFF", marginHeld: "TFTF" });
  });

  await test("Absci: growth rules, Weak, no sales yet; cash is not counted twice (correction 2)", () => {
    const f = scoreFixture("absci", true);
    assert.equal(summary(f), "growth Weak 4/12");
    assert.deepEqual(f.health.notes, [NOTE_NO_SALES]);
    assert.deepEqual(rows(f), { salesGrew: "----", closerToProfit: "----", yearCash: "TTTT", twoYearsCash: "FFFF", fewNewShares: "FFFF" });
    assert.deepEqual(f.health.checks.filter((c) => !c.counted).map((c) => c.key), ["salesGrew", "closerToProfit"]);
    assert.equal(f.cash.liquid, 201_142_000, "the first proposal counted 300,595,000, more than the company's total assets of 268,917,000");
    assert.equal(Math.round(Number(f.cash.months) * 10) / 10, 22.3);
    const source = openFacts(fixture("absci").facts);
    assert.deepEqual(["2025-09-30", "2025-12-31", "2026-03-31", "2026-06-30"].map((end) => liquidFunds(source, end)?.value), [152_667_000, 156_092_000, 130_505_000, 201_142_000]);
    assert.equal(summary(scoreFixture("absci", false)), "standard Weak 0/16");
  });

  await test("Edible Garden: no score, because its fourth quarter of 2025 does not add up (corrections 1 and 3)", () => {
    for (const growthRules of [true, false]) {
      const f = scoreFixture("edible-garden", growthRules);
      assert.equal(f.health.verdict, null);
      assert.equal(f.health.noScoreReason, NO_SCORE.notEnoughReports);
      assert.deepEqual(f.quarters.slice(-4).map((q) => q.end), ["2025-06-30", "2025-09-30", "2026-03-31", "2026-06-30"]);
    }
    const source = openFacts(fixture("edible-garden").facts);
    assert.equal(source.series("NetIncomeLoss").at.get("2025-12-31"), undefined, "year minus the mis-tagged nine months would be a profit of 3,913,000");
    assert.equal(source.series("NetIncomeLoss").at.get("2025-09-30")?.value, -4_045_000);
    // Only the diluted share count is tagged; without it a roughly 38-fold increase went unnoticed (correction 7).
    const growth = shareGrowth(source, "2026-06-30", firstReportFiled(source))?.value ?? NaN;
    assert.ok(growth > 37 && growth < 38, `share count growth ${growth}`);
    assert.equal(liquidFunds(source, "2026-06-30")?.value, 658_000, "cash it is free to use, not the 10,658,000 that includes money set aside");
  });

  await test("ImageneBio: the restated 2024 loss is used (correction 5); growth rules Mixed, standard rules Weak", () => {
    const { facts } = fixture("imagenebio");
    const yearFacts = openFacts(facts).get("NetIncomeLoss").filter((f) => f.start === "2024-01-01" && f.end === "2024-12-31");
    assert.deepEqual([...new Set(yearFacts.map((f) => f.val))].sort((a, b) => a - b), [-49_234_000, -36_568_000], "filed twice with different figures");
    assert.equal(dedupeDurations(yearFacts)[0].val, -36_568_000);
    assert.equal(openFacts(facts).series("NetIncomeLoss").at.get("2024-12-31")?.value, -4_812_000, "the old site kept the first figure and got -17,478,000");
    const f = scoreFixture("imagenebio", true);
    assert.equal(summary(f), "growth Mixed 8/12");
    assert.deepEqual(rows(f), { salesGrew: "----", closerToProfit: "----", yearCash: "TTTT", twoYearsCash: "TTTT", fewNewShares: "FFFF" });
    const standard = scoreFixture("imagenebio", false);
    assert.equal(summary(standard), "standard Weak 1/8");
    assert.deepEqual(rows(standard), { salesGrew: "F---", madeProfit: "FFFF", profitGrew: "-FFT", marginHeld: "----" });
  });

  await test("Werewolf: its collaboration revenue counts as sales (correction 10)", () => {
    const f = scoreFixture("werewolf", true);
    assert.equal(summary(f), "growth Weak 7/16");
    assert.deepEqual(f.health.notes, []);
    assert.deepEqual(rows(f), { salesGrew: "FF-T", closerToProfit: "---T", yearCash: "TFFF", twoYearsCash: "FFFF", fewNewShares: "TTTT" });
    assert.equal(f.ttm.revenue, 21_000_000);
    const standard = scoreFixture("werewolf", false);
    assert.equal(summary(standard), "standard Mixed 6/11");
    assert.equal(rows(standard).salesGrew, "FF-T");
  });

  await test("Omada Health: a profitable emerging growth company stays on the standard rules", () => {
    for (const growthRules of [true, false]) {
      const f = scoreFixture("omada-health", growthRules);
      assert.equal(summary(f), "standard Strong 15/16");
      assert.deepEqual(rows(f), { salesGrew: "TTTT", madeProfit: "TFTT", profitGrew: "TTTT", marginHeld: "TTTT" });
      assert.equal(f.cash.months, "cash-flow positive");
      assert.equal(f.ttm.operatingIncome, 6_869_000);
    }
  });

  await test("Melar Acquisition: a blank-check company gets no score (found by its trust account, not its industry code)", () => {
    assert.equal(fixture("melar-acquisition").profile.sic, "7389");
    for (const growthRules of [true, false]) {
      const f = scoreFixture("melar-acquisition", growthRules);
      assert.equal(f.health.verdict, null);
      assert.equal(f.health.noScoreReason, NO_SCORE.blankCheck);
      assert.deepEqual(f.health.checks, []);
    }
  });

  await test("BlossomHill: a new listing with fewer than four quarterly reports gets no score yet", () => {
    for (const growthRules of [true, false]) {
      const f = scoreFixture("blossomhill", growthRules);
      assert.equal(f.health.verdict, null);
      assert.equal(f.health.noScoreReason, NO_SCORE.notEnoughReports);
      assert.equal(f.quarters.length, 2);
      assert.equal(f.ttm.netIncome, null);
      assert.equal(f.cash.liquid, 95_376_000);
    }
  });

  await test("growth rules switched off: every company gets the standard rules or no score, and no growth check appears", () => {
    const growthOnly: CheckKey[] = ["closerToProfit", "yearCash", "twoYearsCash", "fewNewShares"];
    let scored = 0;
    for (const c of fixtureList()) {
      const f = scoreFixture(c.file.replace(/\.json$/, ""), false);
      assert.equal(f.health.ruleSet, "standard", c.name);
      assert.deepEqual(f.health.notes, [], c.name);
      assert.deepEqual(f.health.checks.filter((k) => growthOnly.includes(k.key)), [], c.name);
      assert.ok((f.health.verdict === null) !== (f.health.noScoreReason === null), `${c.name}: a verdict or a reason, never both`);
      if (f.health.verdict) {
        scored++;
        assert.deepEqual(f.health.checks.map((k) => k.key), ["salesGrew", "madeProfit", "profitGrew", "marginHeld"], c.name);
      }
    }
    assert.equal(scored, 7);
  });
}

/* ----------------------------------------------------------------- database */

const ADMIN_URL =
  process.env.TEST_PG_URL ??
  `postgresql://${encodeURIComponent(process.env.PGUSER ?? os.userInfo().username)}@localhost/postgres?host=/var/run/postgresql`;

async function database() {
  // On a server (scripts/deploy.sh) the checks must never touch whatever Postgres happens to run there.
  if (process.argv.includes("--no-db")) {
    console.log("health check: saving a snapshot SKIPPED (--no-db).");
    return;
  }
  const admin = describeTarget(ADMIN_URL);
  if (!admin.isLocal) throw new Error(`The snapshot test only runs against a local Postgres. TEST_PG_URL points at ${admin.host}.`);
  const root = new Client({ connectionString: ADMIN_URL });
  try {
    await root.connect();
  } catch (e) {
    console.log(`health check: saving a snapshot SKIPPED: no local Postgres at ${admin.label} (${(e as Error).message}).`);
    return;
  }
  const name = `bs_health_${process.pid}`;
  await root.query(`create database ${name}`);
  const url = new URL(ADMIN_URL);
  url.pathname = "/" + name;
  const db = new Client({ connectionString: url.toString() });
  console.log(`health check: saving a snapshot (local Postgres, throwaway database ${name})`);
  try {
    await db.connect();
    await db.query("set client_min_messages = warning");
    await db.query(readFileSync("db/local/supabase-shim.sql", "utf8"));
    await migrate(db);

    type Saved = {
      as_of: string; quarters: unknown; ttm: unknown; score: unknown; verdict: string | null; rule_set: string; no_score_reason: string | null; source_filed: string | null;
    };
    const read = async (cik: number) =>
      (
        await db.query<Saved>(
          `select to_char(as_of, 'YYYY-MM-DD') as as_of, quarters, ttm, score, verdict, rule_set, no_score_reason,
                  to_char(source_filed, 'YYYY-MM-DD') as source_filed
             from public.fundamentals_snapshots where cik = $1 order by as_of`,
          [cik],
        )
      ).rows;

    await test("saveSnapshot writes one row per company per day, and saving again replaces it", async () => {
      const { facts, profile, cik } = fixture("beta-bionics");
      await db.query(`insert into public.companies (cik, name) values ($1, 'Beta Bionics, Inc.'), (1809750, 'Edible Garden AG Inc')`, [cik]);
      const growth = scoreCompany(facts, profile, { today: FIXTURE_TODAY, growthRules: true });
      await saveSnapshot(db, cik, growth);
      let saved = await read(cik);
      assert.equal(saved.length, 1);
      assert.deepEqual(
        { ...saved[0] },
        {
          as_of: FIXTURE_TODAY, quarters: growth.quarters, ttm: { ...growth.ttm, cash: growth.cash }, score: growth.health,
          verdict: "Strong", rule_set: "growth", no_score_reason: null, source_filed: "2026-10-27",
        },
      );

      const standard = scoreCompany(facts, profile, { today: FIXTURE_TODAY, growthRules: false });
      await saveSnapshot(db, cik, standard);
      saved = await read(cik);
      assert.equal(saved.length, 1, "same company, same day: the row is replaced");
      assert.deepEqual([saved[0].verdict, saved[0].rule_set, saved[0].score], ["Weak", "standard", standard.health]);

      await saveSnapshot(db, cik, scoreCompany(facts, profile, { today: "2026-11-11", growthRules: false }));
      assert.deepEqual((await read(cik)).map((r) => r.as_of), [FIXTURE_TODAY, "2026-11-11"]);
    });

    await test("saveSnapshot stores a company with no score, with its reason", async () => {
      const { facts, profile, cik } = fixture("edible-garden");
      const f = scoreCompany(facts, profile, { today: FIXTURE_TODAY, growthRules: false });
      await saveSnapshot(db, cik, f);
      const [saved] = await read(cik);
      assert.deepEqual([saved.verdict, saved.rule_set, saved.no_score_reason, saved.source_filed], [null, "standard", NO_SCORE.notEnoughReports, "2026-08-14"]);
      assert.deepEqual(saved.score, f.health);
      const nothing = scoreCompany({}, { sic: null, isEmergingGrowth: null }, { today: FIXTURE_TODAY, growthRules: false });
      await saveSnapshot(db, cik, { ...nothing, asOf: "2026-11-12" });
      const rows = await read(cik);
      assert.deepEqual([rows[1].quarters, rows[1].verdict, rows[1].no_score_reason, rows[1].source_filed], [[], null, NO_SCORE.noNumbers, null]);
      await assert.rejects(saveSnapshot(db, 0, f), /CIK/);
      await assert.rejects(saveSnapshot(db, 999_999, f), /foreign key/, "a company that is not in the companies table is refused");
    });
  } finally {
    await db.end().catch(() => {});
    await root.query(`drop database if exists ${name}`).catch((e) => console.log(`could not drop ${name}: ${(e as Error).message}`));
    await root.end();
  }
}

async function main() {
  await buildingBlocks();
  await scoring();
  await realCompanies();
  await database();
  if (!finish("health check tests")) process.exit(1);
}

main().catch((e) => {
  console.error("health check tests could not run:", (e as Error).message);
  process.exit(1);
});
