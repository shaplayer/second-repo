import type { Metadata } from "next";
import Link from "next/link";
import { Shell } from "@/components/site/Shell";
import { maskEmail, peekLoginToken } from "@/lib/auth/accounts";
import { db } from "@/lib/db";

export const dynamic = "force-dynamic";
export const metadata: Metadata = { title: "Sign in", robots: { index: false } };

/**
 * Where a sign-in link lands. Opening it signs nobody in: the button below does (a POST), so a mail
 * scanner that opens every link in a message cannot use the link up.
 */
export default async function AuthCallback({ searchParams }: { searchParams: Promise<{ token?: string }> }) {
  const token = (await searchParams).token ?? "";
  const who = await peekLoginToken(db(), token).catch(() => null);
  return (
    <Shell>
      <section className="mx-auto flex w-full max-w-[520px] flex-col items-center gap-4 px-4 py-16 text-center">
        {who ? (
          <>
            <h1 className="m-0 text-[32px] font-extrabold tracking-[-0.03em]">Sign in as {maskEmail(who.email)}?</h1>
            <p className="m-0 text-base text-ink-2">One more tap and you&apos;re in.</p>
            <form method="post" action="/api/auth/verify">
              <input type="hidden" name="token" value={token} />
              <button type="submit" autoFocus className="btn btn-brand btn-lg h-14 px-8 text-[17px]">Sign in</button>
            </form>
          </>
        ) : (
          <>
            <h1 className="m-0 text-[32px] font-extrabold tracking-[-0.03em]">That link has expired</h1>
            <p className="m-0 text-base text-ink-2">Sign-in links work once and for 15 minutes. Ask for a new one.</p>
            <Link href="/sign-in" className="btn btn-dark btn-lg">Get a new link</Link>
          </>
        )}
      </section>
    </Shell>
  );
}
