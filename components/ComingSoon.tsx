import Link from "next/link";
import { Nav } from "./Nav";
import { Footer } from "./sections/Footer";

export function ComingSoon({ eyebrow, title, body }: { eyebrow: string; title: string; body: string }) {
  return (
    <>
      <Nav />
      <main className="relative overflow-hidden">
        <div className="grid-bg pointer-events-none absolute inset-0" aria-hidden="true" />
        <div className="container-wide relative flex min-h-[64vh] flex-col items-center justify-center py-24 text-center">
          <p className="eyebrow">{eyebrow}</p>
          <h1 className="mt-4 max-w-2xl text-[36px] font-semibold leading-tight tracking-tight md:text-[48px]">{title}</h1>
          <p className="mt-4 max-w-lg text-[16px] text-muted">{body}</p>
          <Link href="/" className="btn-ghost mt-10">← Back to home</Link>
        </div>
      </main>
      <Footer />
    </>
  );
}
