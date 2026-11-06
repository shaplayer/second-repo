import { Bolt, Inbox, Radar } from "../Icons";
import { Reveal } from "../Reveal";

const STEPS = [
  { n: "01", icon: Radar, title: "Our scanners watch the market", body: "In-house scanners and screeners, months in the making, sweep the market for volume, momentum and news catalysts." },
  { n: "02", icon: Bolt, title: "A stock catches our radar", body: "When a setup meets our criteria, it becomes an alert, timestamped and logged to our public track record." },
  { n: "03", icon: Inbox, title: "You get it first", body: "The alert hits your inbox before the opening bell. By email or text message, free." },
];

export function HowItWorks() {
  return (
    <section className="container-wide pb-24 pt-8 md:pb-32 md:pt-12" aria-labelledby="how-title">
      <div className="max-w-2xl">
        <p className="eyebrow">How it works</p>
        <h2 id="how-title" className="mt-4 text-[34px] font-semibold leading-[1.1] tracking-tight md:text-[42px]">
          From scanner to your inbox. <span className="text-muted">Before the open.</span>
        </h2>
      </div>
      <ol className="mt-14 grid gap-5 md:grid-cols-3">
        {STEPS.map((s, i) => (
          <li key={s.n}>
            <Reveal delay={i * 120} className="card h-full p-7">
              <div className="flex items-center justify-between">
                <span className="relative flex h-12 w-12 items-center justify-center rounded-2xl border border-brand/25 bg-brand/10 text-brand">
                  <s.icon className="h-5 w-5" />
                </span>
                <span className="num font-mono text-[13px] text-faint">{s.n}</span>
              </div>
              <h3 className="mt-6 text-[18px] font-semibold tracking-tight">{s.title}</h3>
              <p className="mt-2 text-[15px] leading-relaxed text-muted">{s.body}</p>
            </Reveal>
          </li>
        ))}
      </ol>
    </section>
  );
}
