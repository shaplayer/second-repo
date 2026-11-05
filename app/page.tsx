import { getFeed } from "@/lib/feeds";
import type { FeedResponse } from "@/lib/feeds/types";
import { recentAlerts } from "@/lib/alerts";
import { Nav } from "@/components/Nav";
import { FeedSection } from "@/components/FeedSection";
import { TickerTape } from "@/components/sections/TickerTape";
import { Hero } from "@/components/sections/Hero";
import { AlertBand } from "@/components/sections/AlertBand";
import { HowItWorks } from "@/components/sections/HowItWorks";
import { Level2AndTrack } from "@/components/sections/Level2AndTrack";
import { AdvertiseTeaser } from "@/components/sections/AdvertiseTeaser";
import { FinalCta } from "@/components/sections/FinalCta";
import { Footer } from "@/components/sections/Footer";

// Rendered per request; the feed itself is cached in-process (lib/feeds/http.ts).
export const dynamic = "force-dynamic";

export default async function Home() {
  const [tape, feed, alerts] = await Promise.all([
    getFeed({ limit: 30 }).catch((): FeedResponse => ({ items: [], mode: "live", nextBefore: null })),
    getFeed({ limit: 8 }).catch((): FeedResponse => ({ items: [], mode: "live", nextBefore: null })),
    recentAlerts(5),
  ]);

  return (
    <>
      <Nav />
      <TickerTape items={tape.items} />
      <main>
        <Hero latest={feed.items[0]} />
        <AlertBand />
        <FeedSection initial={feed} />
        <HowItWorks />
        <Level2AndTrack alerts={alerts} />
        <AdvertiseTeaser />
        <FinalCta />
      </main>
      <Footer />
    </>
  );
}
