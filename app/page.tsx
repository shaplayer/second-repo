import { getFeed } from "@/lib/feeds";
import type { FeedResponse } from "@/lib/feeds/types";
import { recentAlerts } from "@/lib/alerts";
import { Nav } from "@/components/Nav";
import { FeedSection } from "@/components/FeedSection";
import { TickerTape } from "@/components/sections/TickerTape";
import { Hero, type HeroVisual } from "@/components/sections/Hero";
import { LongTermPicks } from "@/components/sections/LongTermPicks";
import { WhatYouGet } from "@/components/sections/WhatYouGet";
import { Pricing } from "@/components/sections/Pricing";
import { TrackRecordSection } from "@/components/sections/TrackRecordSection";
import { Faq } from "@/components/sections/Faq";
import { FinalCta } from "@/components/sections/FinalCta";
import { Footer } from "@/components/sections/Footer";

// Rendered per request; the feed itself is cached in-process (lib/feeds/http.ts).
export const dynamic = "force-dynamic";

const VISUALS: HeroVisual[] = ["chart", "flow", "phone"];

/**
 * Hero visual: three options while the team picks one. Preview with /?visual=chart | flow | phone
 * (or the old names c | b | a). Set NEXT_PUBLIC_HERO_VISUAL to change the default.
 */
function pickVisual(q?: string): HeroVisual {
  const alias: Record<string, HeroVisual> = { a: "phone", b: "flow", c: "chart" };
  const v = (q && (alias[q.toLowerCase()] ?? q.toLowerCase())) || process.env.NEXT_PUBLIC_HERO_VISUAL || "chart";
  return VISUALS.includes(v as HeroVisual) ? (v as HeroVisual) : "chart";
}

export default async function Home({ searchParams }: { searchParams: Promise<{ visual?: string }> }) {
  const empty = (): FeedResponse => ({ items: [], mode: "live", nextBefore: null });
  const [tape, feed, alerts, { visual }] = await Promise.all([
    getFeed({ limit: 30 }).catch(empty),
    getFeed({ limit: 8 }).catch(empty),
    recentAlerts(5),
    searchParams,
  ]);

  return (
    <>
      <Nav />
      <TickerTape items={tape.items} />
      <main>
        {/* 1. What it is + sign up */}
        <Hero items={tape.items} visual={pickVisual(visual)} />
        {/* 2. Proof */}
        <LongTermPicks />
        {/* 3. What you get, and how it reaches you */}
        <WhatYouGet />
        {/* 4. The product, live */}
        <FeedSection initial={feed} />
        {/* 5. Free vs Premium */}
        <Pricing />
        {/* 6. Every alert, on the record */}
        <TrackRecordSection alerts={alerts} />
        <Faq />
        <FinalCta />
      </main>
      <Footer />
    </>
  );
}
