import type { Metadata } from "next";
import Link from "next/link";
import { redirect } from "next/navigation";
import { CadenceChoice, SettingSwitch, StopEverything } from "@/components/account/AccountForms";
import { Shell } from "@/components/site/Shell";
import { listSubscriptions } from "@/lib/alerts/subscriptions";
import { db } from "@/lib/db";
import { CATEGORY_HINT, CATEGORY_LABEL, type Category } from "@/lib/plain";
import { currentUser } from "@/lib/web/request";

export const dynamic = "force-dynamic";
export const metadata: Metadata = { title: "Alert settings", robots: { index: false } };

const KINDS: Category[] = ["press", "earnings", "news", "insider", "proxy"];
const card = "flex flex-col rounded-[28px] bg-white p-6 shadow-[0_10px_30px_rgba(12,60,35,0.06),0_0_0_1px_#e3ebe6]";

export default async function SettingsPage() {
  const user = await currentUser();
  if (!user) redirect("/sign-in?next=/settings");
  const subs = await listSubscriptions(db(), user.email).catch(() => []);
  const active = subs.filter((s) => s.status === "active");
  const stocks = active.filter((s) => s.cik !== null);
  const picksOn = active.some((s) => s.cik === null);
  const pending = subs.filter((s) => s.status === "pending").length;
  const digest = stocks.length > 0 && stocks.every((s) => s.cadence === "digest");
  // A kind of news is "on" when every followed company has it on.
  const kindOn = (k: Category) => stocks.length > 0 && stocks.every((s) => (s.categories as string[]).includes(k));

  return (
    <Shell>
      <div className="mx-auto flex w-full max-w-[820px] flex-col gap-5 px-4 pb-14 pt-9 md:px-8">
        <div className="flex flex-col gap-1.5">
          <h1 className="m-0 text-[32px] font-extrabold tracking-[-0.03em] md:text-[40px]">Alert settings</h1>
          <span className="text-[15px] text-ink-2">Choose what reaches you, and where. Changes save automatically.</span>
        </div>

        <section aria-labelledby="st-where" className={`${card} gap-3.5`}>
          <h2 id="st-where" className="m-0 text-xl font-extrabold">Where</h2>
          <div className="flex flex-wrap items-center gap-3 rounded-[18px] bg-inset px-4 py-3.5">
            <span className="flex flex-[1_1_240px] flex-col">
              <strong>Email</strong>
              <span className="text-sm text-ink-2">{user.email} · <span className="font-bold text-good">Confirmed</span></span>
            </span>
            <form method="post" action="/api/auth/sign-out"><button type="submit" className="btn btn-soft">Sign out</button></form>
          </div>
          {pending > 0 && (
            <p className="m-0 rounded-[14px] bg-amber-bg px-4 py-3 text-sm text-amber">
              {pending} {pending === 1 ? "sign-up is" : "sign-ups are"} still waiting for the confirmation email to be clicked. Check your inbox, or switch the alert on here.
            </p>
          )}
        </section>

        <section aria-labelledby="st-what" className={`${card} gap-1.5`}>
          <h2 id="st-what" className="m-0 mb-2 text-xl font-extrabold">What</h2>
          <div className="flex items-center gap-3 border-t border-line-soft py-3">
            <span className="flex min-w-0 flex-1 flex-col gap-0.5">
              <strong className="text-[15px]">Free daily pick</strong>
              <span className="text-[13px] text-muted">One pick each trading morning. Sponsored picks always say who paid.</span>
            </span>
            <SettingSwitch label="Free daily pick by email" on={picksOn} setting="picks" />
          </div>
          {KINDS.map((k) => (
            <div key={k} className="flex items-center gap-3 border-t border-line-soft py-3">
              <span className="flex min-w-0 flex-1 flex-col gap-0.5">
                <strong className="text-[15px]">{CATEGORY_LABEL[k]}</strong>
                <span className="text-[13px] text-muted">{CATEGORY_HINT[k]}</span>
              </span>
              {stocks.length > 0 ? (
                <SettingSwitch label={`${CATEGORY_LABEL[k]} by email`} on={kindOn(k)} setting={k} />
              ) : (
                <span className="text-[13px] text-muted">Follow a stock first</span>
              )}
            </div>
          ))}
          <p className="fine m-0 pt-1">These switches apply to every stock you follow ({stocks.length}).</p>
          <Link href="/my-stocks" className="pt-2 text-sm font-bold no-underline">Choose per stock in My stocks →</Link>
        </section>

        <section aria-labelledby="st-when" className={`${card} gap-3.5`}>
          <h2 id="st-when" className="m-0 text-xl font-extrabold">When</h2>
          <div className="flex flex-wrap items-center gap-2.5">
            <span className="flex flex-[1_1_220px] flex-col text-[15px]">
              <strong>Email timing</strong>
              <span className="text-[13px] text-muted">The daily summary goes out at 6:00 PM ET. The free pick always comes when it is sent.</span>
            </span>
            <CadenceChoice value={digest ? "digest" : "instant"} />
          </div>
        </section>

        <section className="flex flex-wrap items-center gap-3 rounded-[28px] bg-[#fff6f6] px-6 py-[22px] shadow-[0_0_0_1px_#f3d6d6]">
          <span className="flex flex-[1_1_300px] flex-col gap-0.5">
            <strong>Stop everything</strong>
            <span className="text-sm text-ink-2">Unsubscribe from all BigStocks emails.</span>
          </span>
          <StopEverything />
        </section>
      </div>
    </Shell>
  );
}
