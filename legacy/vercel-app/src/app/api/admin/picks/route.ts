import { NextResponse } from "next/server";
import { isAdmin } from "@/lib/admin";
import { dailyBars, liveQuote, toDbSymbol } from "@/lib/databento";
import { pickEmail, sendEmail } from "@/lib/email";
import { lookup } from "@/lib/sec";
import { closePick, confirmedSubscribers, getPick, insertPick } from "@/lib/store";

type Body = {
  ticker?: string;
  kind?: "pick" | "sponsored";
  title?: string;
  why?: string;
  author?: string;
  tier?: "free" | "members";
  ownsShares?: boolean;
  ownershipNote?: string;
  sponsor?: { payer?: string; amount?: string; form?: string };
  email?: boolean;
};

/** Publish a pick. Sponsored posts can't go out without the payment disclosure. */
export async function POST(req: Request) {
  if (!(await isAdmin())) return NextResponse.json({ error: "Sign in first." }, { status: 401 });
  const b = (await req.json().catch(() => ({}))) as Body;
  const ticker = (b.ticker ?? "").trim().toUpperCase();
  const co = await lookup(ticker);
  if (!co) return NextResponse.json({ error: `${ticker || "That"} isn't a Nasdaq or NYSE stock we know.` }, { status: 400 });
  if (!b.title?.trim() || !b.why?.trim()) return NextResponse.json({ error: "Add a title and the reason for the pick." }, { status: 400 });
  if (typeof b.ownsShares !== "boolean") return NextResponse.json({ error: "Say whether the writer or BigStocks owns this stock." }, { status: 400 });
  const kind = b.kind === "sponsored" ? "sponsored" : "pick";
  if (kind === "sponsored" && !(b.sponsor?.payer?.trim() && b.sponsor?.amount?.trim() && b.sponsor?.form?.trim())) {
    return NextResponse.json({ error: "Sponsored posts must say who paid, how much, and in what form (cash or shares)." }, { status: 400 });
  }
  if (kind === "pick" && !b.author?.trim()) return NextResponse.json({ error: "Add the investor's name." }, { status: 400 });

  const db = toDbSymbol(ticker);
  const daily = (await dailyBars([db]).catch(() => new Map())).get(db) ?? [];
  const quote = daily.length ? await liveQuote(db, daily).catch(() => null) : null;
  if (!quote) return NextResponse.json({ error: "Couldn't get a price for this stock right now. Try again in a minute." }, { status: 502 });

  const pick = await insertPick({
    ticker,
    companyName: co.name,
    kind,
    title: b.title.trim(),
    why: b.why.trim(),
    author: kind === "sponsored" ? "BigStocks (paid advertisement)" : b.author!.trim(),
    tier: b.tier === "members" ? "members" : "free",
    priceAtPost: quote.price,
    ownsShares: b.ownsShares,
    ownershipNote: (b.ownershipNote ?? "").trim(),
    sponsor: kind === "sponsored" ? { payer: b.sponsor!.payer!.trim(), amount: b.sponsor!.amount!.trim(), form: b.sponsor!.form!.trim() } : undefined,
  });

  // Email free picks to subscribers who opted in. Members-only picks wait for member accounts.
  let emailed = 0;
  const errors: string[] = [];
  if (b.email && pick.tier === "free") {
    const subs = await confirmedSubscribers({ picks: true });
    for (const s of subs) {
      try {
        await sendEmail(pickEmail(s, pick));
        emailed++;
      } catch (e) {
        errors.push((e as Error).message);
      }
    }
  }
  return NextResponse.json({ pick, emailed, errors });
}

/** Close a pick: its result freezes at today's price. Picks can't be deleted, so the track record stays honest. */
export async function PATCH(req: Request) {
  if (!(await isAdmin())) return NextResponse.json({ error: "Sign in first." }, { status: 401 });
  const { id } = (await req.json().catch(() => ({}))) as { id?: string };
  const pick = id ? await getPick(id) : null;
  if (!pick) return NextResponse.json({ error: "Pick not found." }, { status: 404 });
  if (pick.closedAt) return NextResponse.json({ error: "Already closed." }, { status: 400 });
  const db = toDbSymbol(pick.ticker);
  const daily = (await dailyBars([db]).catch(() => new Map())).get(db) ?? [];
  const quote = daily.length ? await liveQuote(db, daily).catch(() => null) : null;
  if (!quote) return NextResponse.json({ error: "Couldn't get a price right now. Try again in a minute." }, { status: 502 });
  await closePick(pick.id, quote.price);
  return NextResponse.json({ ok: true });
}
