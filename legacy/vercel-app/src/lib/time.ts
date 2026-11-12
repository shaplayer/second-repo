const TZ = "America/New_York";

const partsFmt = new Intl.DateTimeFormat("en-US", {
  timeZone: TZ,
  year: "numeric",
  month: "2-digit",
  day: "2-digit",
  hour: "2-digit",
  minute: "2-digit",
  hourCycle: "h23",
});

/** Wall-clock parts of an instant in New York time. */
export function etParts(d: Date) {
  const p = Object.fromEntries(partsFmt.formatToParts(d).map((x) => [x.type, x.value]));
  return { date: `${p.year}-${p.month}-${p.day}`, hour: Number(p.hour), minute: Number(p.minute) };
}

/** True during the regular 9:30 AM – 4:00 PM ET session. */
export function inRegularSession(d: Date) {
  const { hour, minute } = etParts(d);
  const m = hour * 60 + minute;
  return m >= 9 * 60 + 30 && m < 16 * 60;
}

export function fmtEt(d: Date, opts: Intl.DateTimeFormatOptions) {
  return new Intl.DateTimeFormat("en-US", { timeZone: TZ, ...opts }).format(d);
}

/** "Oct 9, 4:30 PM ET", or "Today 6:00 AM ET" when it happened today. */
export function fmtWhen(d: Date, dateOnly = false) {
  const today = etParts(new Date()).date === etParts(d).date;
  const day = fmtEt(d, { month: "short", day: "numeric", year: d.getFullYear() === new Date().getFullYear() ? undefined : "numeric" });
  if (dateOnly) return today ? "Today" : day;
  const time = fmtEt(d, { hour: "numeric", minute: "2-digit" });
  return today ? `Today ${time} ET` : `${day}, ${time} ET`;
}
