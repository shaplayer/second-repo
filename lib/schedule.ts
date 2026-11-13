/** The pick window, US Eastern: 8:00 AM to the 9:30 AM opening bell, trading days only. */
export const alertWindow = { startHourET: 8, startMinuteET: 0, endHourET: 9, endMinuteET: 30 };

/**
 * Pick-window schedule, all in US Eastern time.
 * Picks go out between alertWindow.start (8:00 AM) and the opening bell (9:30 AM) on trading days,
 * and sometimes during market hours if a setup pops up.
 */

/** NYSE full-day closures. Add the next year's list each December (nyse.com/markets/hours-calendars). */
const HOLIDAYS = new Set([
  // 2026
  "2026-01-01", "2026-01-19", "2026-02-16", "2026-04-03", "2026-05-25", "2026-06-19", "2026-07-03",
  "2026-09-07", "2026-11-26", "2026-12-25",
  // 2027
  "2027-01-01", "2027-01-18", "2027-02-15", "2027-03-26", "2027-05-31", "2027-06-18", "2027-07-05",
  "2027-09-06", "2027-11-25", "2027-12-24",
]);

const DAY = 86_400_000;
const MARKET_CLOSE_MIN = 16 * 60;

/** Wall-clock time in America/New_York, as a fake-UTC timestamp for easy math. */
function etWallMs(d: Date): number {
  const p = Object.fromEntries(
    new Intl.DateTimeFormat("en-US", {
      timeZone: "America/New_York", hourCycle: "h23",
      year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", second: "2-digit",
    }).formatToParts(d).map((x) => [x.type, x.value]),
  );
  return Date.UTC(+p.year, +p.month - 1, +p.day, +p.hour, +p.minute, +p.second);
}

const ymd = (wall: number) => new Date(wall).toISOString().slice(0, 10);
const midnight = (wall: number) => Math.floor(wall / DAY) * DAY;

export function isTradingDay(wallMidnight: number): boolean {
  const dow = new Date(wallMidnight).getUTCDay();
  return dow !== 0 && dow !== 6 && !HOLIDAYS.has(ymd(wallMidnight));
}

export type Phase = "countdown" | "window" | "market";
export type PickSchedule = {
  phase: Phase;
  /** ms until the next thing: window opens (countdown/market) or the opening bell (window). */
  msLeft: number;
  /** Day of the next window, e.g. "Tomorrow", "Today", "Monday". */
  nextDay: string;
  /** 0–1 progress through today's 8:00–9:30 window (window phase only). */
  windowProgress: number;
};

/** Where we are relative to the pick window. */
export function pickSchedule(now = new Date()): PickSchedule {
  const wall = etWallMs(now);
  const today = midnight(wall);
  const startMin = alertWindow.startHourET * 60 + alertWindow.startMinuteET;
  const endMin = alertWindow.endHourET * 60 + alertWindow.endMinuteET;
  const min = (wall - today) / 60_000;

  if (isTradingDay(today) && min >= startMin && min < endMin) {
    return { phase: "window", msLeft: today + endMin * 60_000 - wall, nextDay: "Today", windowProgress: (min - startMin) / (endMin - startMin) };
  }

  // Next window start: today if it's still ahead, else the next trading day.
  let day = today;
  if (!(isTradingDay(today) && min < startMin)) {
    day += DAY;
    for (let i = 0; i < 10 && !isTradingDay(day); i++) day += DAY;
  }
  const start = day + startMin * 60_000;
  const phase: Phase = isTradingDay(today) && min >= endMin && min < MARKET_CLOSE_MIN ? "market" : "countdown";
  const diffDays = Math.round((day - today) / DAY);
  const nextDay = diffDays === 0 ? "Today" : diffDays === 1 ? "Tomorrow"
    : new Date(day).toLocaleDateString("en-US", { weekday: "long", timeZone: "UTC" });
  return { phase, msLeft: start - wall, nextDay, windowProgress: 0 };
}

/** "8:00 AM" style label for a time of day in ET. */
export const etLabel = (h: number, m: number) => `${h % 12 || 12}:${String(m).padStart(2, "0")} ${h < 12 ? "AM" : "PM"}`;
