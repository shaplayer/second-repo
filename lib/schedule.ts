import { alertSchedule } from "./site";

/** Wall-clock parts in America/New_York, as a fake-UTC timestamp for easy math. */
function etWallMs(d: Date): number {
  const p = Object.fromEntries(
    new Intl.DateTimeFormat("en-US", {
      timeZone: "America/New_York", hourCycle: "h23",
      year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", second: "2-digit",
    }).formatToParts(d).map((x) => [x.type, x.value]),
  );
  return Date.UTC(+p.year, +p.month - 1, +p.day, +p.hour, +p.minute, +p.second);
}

/** Milliseconds until the next scheduled pre-market alert (weekdays, ET). */
export function msUntilNextAlert(now = new Date()): number {
  const wall = etWallMs(now);
  const day = new Date(wall);
  let target = Date.UTC(day.getUTCFullYear(), day.getUTCMonth(), day.getUTCDate(), alertSchedule.hourET, alertSchedule.minuteET);
  for (let i = 0; i < 8; i++) {
    const dow = new Date(target).getUTCDay();
    const weekend = dow === 0 || dow === 6;
    if (target > wall && !(alertSchedule.weekdaysOnly && weekend)) break;
    target += 86_400_000;
  }
  return target - wall;
}
