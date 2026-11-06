import { alertTiming, plans } from "@/lib/site";

const QA: [string, string][] = [
  ["What does BigStocks send me?",
    "Our stock picks, plus press releases and SEC filings for the stocks you choose or the ones that hit our radar. By text, email, or both."],
  ["When do picks go out?",
    `${alertTiming.long} There's no one fixed time, so turn on text alerts to get them the second they go out.`],
  ["What's the difference between Free and Premium?",
    `Free gets picks several times a week plus all the news and filings. Premium ($${plans.premium.price}/month) adds our highest-conviction picks, about one to four a month. Level 2 streaming is in beta and not live yet; Premium members get first access.`],
  ["Can I get news on just one stock I own?",
    "Yes. Tap the bell on any ticker to get that company's press releases and SEC filings by text or email."],
  ["Is this investment advice?",
    "No. BigStocks is for information and education. Some alerts are sponsored, and those are always labeled. Do your own research."],
];

export function Faq() {
  return (
    <section className="container-wide py-20 md:py-24" aria-labelledby="faq-title">
      <div className="grid gap-10 lg:grid-cols-[minmax(0,380px)_1fr] lg:gap-16">
        <div>
          <p className="eyebrow">FAQ</p>
          <h2 id="faq-title" className="mt-4 text-[32px] font-semibold leading-[1.1] tracking-tight md:text-[40px]">Questions, answered.</h2>
        </div>
        <div className="divide-y divide-line border-y border-line">
          {QA.map(([q, a]) => (
            <details key={q} className="group py-5">
              <summary className="flex cursor-pointer list-none items-center justify-between gap-6 text-[16.5px] font-medium [&::-webkit-details-marker]:hidden">
                {q}
                <span className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full border border-line-strong text-muted transition-transform group-open:rotate-45" aria-hidden="true">+</span>
              </summary>
              <p className="mt-3 max-w-2xl text-[15px] leading-relaxed text-muted">{a}</p>
            </details>
          ))}
        </div>
      </div>
    </section>
  );
}
