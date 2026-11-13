import type { Metadata } from "next";
import Link from "next/link";
import { redirect } from "next/navigation";
import { SignInForm } from "@/components/account/AccountForms";
import { Shell } from "@/components/site/Shell";
import { safeNextPath } from "@/lib/auth/accounts";
import { currentUser } from "@/lib/web/request";

export const dynamic = "force-dynamic";
export const metadata: Metadata = { title: "Sign in", description: "No password. We email you a sign-in link." };

const WHY = [
  ["My stocks", "Your stocks and their news, in one place."],
  ["Alerts your way", "Email alerts per stock and per type of news."],
  ["Always free", "No card, no paid plan."],
];

export default async function SignInPage({ searchParams }: { searchParams: Promise<{ next?: string; problem?: string }> }) {
  const q = await searchParams;
  const next = safeNextPath(q.next) ?? undefined;
  if (await currentUser()) redirect(next ?? "/my-stocks");
  return (
    <Shell>
      <div className="mx-auto flex w-full max-w-[900px] flex-wrap items-start gap-6 px-4 pb-14 pt-10 md:px-8">
        <section className="card-raised flex min-w-0 flex-[1_1_380px] flex-col gap-3.5 p-6 md:p-8">
          <h1 className="m-0 text-[34px] font-extrabold tracking-[-0.03em]">Sign in</h1>
          <p className="m-0 text-base text-ink-2">No password. We email you a sign-in link.</p>
          {q.problem && (
            <p role="alert" className="m-0 rounded-xl bg-amber-bg px-4 py-3 text-sm text-amber">
              That sign-in link has expired or was already used. Enter your email and we&apos;ll send a new one.
            </p>
          )}
          <SignInForm next={next} />
          <p className="fine m-0">
            New here? Signing in creates your free account. <Link href="/terms">Terms</Link> · <Link href="/privacy">Privacy</Link>
          </p>
        </section>
        <section aria-labelledby="why-h" className="flex min-w-0 flex-[1_1_300px] flex-col gap-3 pt-2">
          <h2 id="why-h" className="m-0 text-xl font-extrabold">Why sign in?</h2>
          {WHY.map(([t, d], i) => (
            <div key={t} className="flex items-start gap-3">
              <span className="flex h-8 w-8 flex-none items-center justify-center rounded-full bg-good-bg text-sm font-extrabold text-good">{i + 1}</span>
              <span className="flex flex-col"><strong className="text-base">{t}</strong><span className="text-sm text-ink-2">{d}</span></span>
            </div>
          ))}
        </section>
      </div>
    </Shell>
  );
}
