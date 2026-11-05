import { SignupForm } from "../SignupForm";

export function FinalCta() {
  return (
    <section className="relative overflow-hidden border-t border-line" aria-labelledby="final-title">
      <div className="pointer-events-none absolute left-1/2 top-0 h-[420px] w-[900px] -translate-x-1/2 rounded-full bg-brand/[0.08] blur-[130px]" aria-hidden="true" />
      <div className="container-wide relative flex flex-col items-center py-24 text-center md:py-32">
        <p className="eyebrow">Join free</p>
        <h2 id="final-title" className="mt-4 max-w-2xl text-[34px] font-semibold leading-[1.08] tracking-tight md:text-[48px]">
          Get the next alert <span className="text-gradient">before the bell.</span>
        </h2>
        <p className="mt-4 max-w-md text-[16px] text-muted">Join 125,000+ traders who start their morning with BigStocks.</p>
        <div className="mt-9 flex w-full justify-center"><SignupForm source="home-footer" /></div>
      </div>
    </section>
  );
}
