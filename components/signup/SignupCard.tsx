import Link from "next/link";
import { SignupForm } from "./SignupForm";

/** The dark sign-up card in the side column of most pages. */
export function SignupCard({
  title, text, button, source, cik, ticker, signedInEmail, id,
}: {
  title: string; text?: string; button: string; source: string; cik?: number; ticker?: string | null; signedInEmail?: string | null; id?: string;
}) {
  return (
    <section id={id} aria-label={title} className="card-dark flex flex-col gap-2.5 p-6">
      <h2 className="m-0 text-[22px] font-extrabold leading-[1.15]">{title}</h2>
      {text && <p className="m-0 text-sm leading-normal text-dark-muted">{text}</p>}
      {signedInEmail ? (
        <p className="m-0 text-sm leading-normal text-dark-muted">
          You&apos;re signed in as {signedInEmail}. Use “+ My stocks” on any company, or{" "}
          <Link href="/settings" className="font-bold text-dark-accent">choose your alerts</Link>.
        </p>
      ) : (
        <SignupForm cik={cik} ticker={ticker} source={source} button={button} />
      )}
    </section>
  );
}
