import { getFeed } from "@/lib/feeds";
import type { FeedResponse } from "@/lib/feeds/types";
import { recentAlerts } from "@/lib/alerts";
import { Nav } from "@/components/Nav";
import { FeedSection } from "@/components/FeedSection";
import { TickerTape } from "@/components/sections/TickerTape";
import { Hero } from "@/components/sections/Hero";
import { NextPick } from "@/components/sections/NextPick";
import { WhatYouGet } from "@/components/sections/WhatYouGet";
import { Pricing } from "@/components/sections/Pricing";
import { TrackRecordSection } from "@/components/sections/TrackRecordSection";
import { Faq } from "@/components/sections/Faq";
import { FinalCta } from "@/components/sections/FinalCta";
import { Footer } from "@/components/sections/Footer";

// Rendered per request; the feed itself is cached in-process (lib/feeds/http.ts).
export const dynamic = "force-dynamic";

export default async function Home() {
  const empty = (): FeedResponse => ({ items: [], mode: "live", nextBefore: null });
  const [tape, feed, alerts] = await Promise.all([
    getFeed({ limit: 30 }).catch(empty),
    getFeed({ limit: 8 }).catch(empty),
    recentAlerts(5),
  ]);

  return (
    <>
      <Nav />
      <TickerTape items={tape.items} />
      <main>
        {/* 1. What it is + sign up */}
        <Hero items={tape.items} />
        {/* 2. When the next pick lands */}
        <NextPick />
        {/* 3. What you get, and how it reaches you */}
        <WhatYouGet items={tape.items} />
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
