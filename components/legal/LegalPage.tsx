// DRAFT TEMPLATE. The four legal pages built with this file are drafts awaiting the owner's lawyer.
// The [BRACKETS] in their text are for the owner to fill in: keep them visible exactly as written.
import Link from "next/link";
import { Children, isValidElement, type ReactElement, type ReactNode } from "react";
import { Shell } from "@/components/site/Shell";

const PAGES = [
  { href: "/disclaimer", label: "Disclaimer" },
  { href: "/privacy", label: "Privacy" },
  { href: "/terms", label: "Terms" },
  { href: "/sms-terms", label: "SMS terms" },
];

type SectionProps = { title: string; children: ReactNode };

/** One numbered section of a legal page. Use only as a direct child of <LegalPage>, which numbers it. */
export function LegalSection({ title, children, n = 0 }: SectionProps & { n?: number }) {
  return (
    <section id={`section-${n}`} aria-labelledby={`section-h${n}`}
      className="flex flex-col gap-2.5 border-t border-line-soft pt-[22px] [&_p]:m-0 [&_p]:text-base [&_p]:leading-[1.65] [&_p]:text-ink-2 [&_ul]:m-0 [&_ul]:flex [&_ul]:list-disc [&_ul]:flex-col [&_ul]:gap-1.5 [&_ul]:pl-[22px] [&_ul]:text-base [&_ul]:leading-[1.6] [&_ul]:text-ink-2">
      <h2 id={`section-h${n}`} className="m-0 text-[22px] font-extrabold tracking-[-0.01em]">{n}. {title}</h2>
      {children}
    </section>
  );
}

/** The one sentence of a section that must not be missed, on a mint card. */
export function LegalCallout({ children }: { children: ReactNode }) {
  return <div className="card-mint rounded-[18px] px-4 py-3.5 text-[15px] font-bold leading-[1.55]">{children}</div>;
}

type Props = {
  title: string;
  /** The line under the title, e.g. "Last updated [DATE] · Effective [DATE]". */
  updated: string;
  /** The opening paragraph. */
  intro: string;
  /** Shows the "Draft template" note from the design. On until the owner's lawyer has approved the text. */
  draft?: boolean;
  /** An extra notice above everything else (the SMS terms use it while text alerts are off). */
  notice?: ReactNode;
  /** <LegalSection> elements, in order. */
  children: ReactNode;
};

/** The frame shared by the disclaimer, privacy policy, terms of use and SMS terms. */
export function LegalPage({ title, updated, intro, draft = true, notice, children }: Props) {
  const sections = Children.toArray(children).filter((c): c is ReactElement<SectionProps> => isValidElement(c));
  return (
    <Shell>
      <div className="wrap-narrow flex flex-col gap-[22px] pb-14 pt-8 md:pt-10">
        {notice && (
          <div role="note" className="card rounded-2xl bg-inset px-4 py-3 text-sm leading-normal text-ink-2">{notice}</div>
        )}
        {draft && (
          <div role="note" className="rounded-2xl bg-[#fffaf0] px-4 py-3 text-sm text-[#5a3b04] shadow-[0_0_0_1px_#f2e2bf]">
            <strong>Draft template.</strong> Fill in the [BRACKETS] and have a lawyer review before launch.
          </div>
        )}
        <div className="flex flex-col gap-2.5">
          <span className="eyebrow text-[13px]">Legal</span>
          <h1 className="m-0 text-[34px] font-extrabold leading-[1.08] tracking-[-0.035em] md:text-[44px]">{title}</h1>
          <span className="text-sm text-muted">{updated}</span>
          <p className="m-0 text-[17px] leading-[1.6] text-ink-2 md:text-lg">{intro}</p>
        </div>
        <nav aria-label="On this page" className="flex flex-wrap gap-2">
          {sections.map((s, i) => (
            <a key={s.props.title} href={`#section-${i + 1}`} className="chip">{s.props.title}</a>
          ))}
        </nav>
        {sections.map((s, i) => (
          <LegalSection key={s.props.title} n={i + 1} title={s.props.title}>{s.props.children}</LegalSection>
        ))}
        <section aria-label="Questions" className="card-dark mt-2.5 flex flex-wrap items-center gap-3 rounded-3xl px-5 py-[22px] md:px-6">
          <span className="flex min-w-0 flex-[1_1_300px] flex-col gap-0.5">
            <strong className="text-[17px]">Questions?</strong>
            <span className="text-sm text-dark-muted">Email [LEGAL@EMAIL] or write to [COMPANY LEGAL NAME], [POSTAL ADDRESS].</span>
          </span>
          <span className="flex flex-wrap gap-2">
            {PAGES.map((p) => (
              <Link key={p.href} href={p.href} className="btn bg-white px-4 text-base text-ink hover:bg-inset hover:text-ink">{p.label}</Link>
            ))}
          </span>
        </section>
      </div>
    </Shell>
  );
}
