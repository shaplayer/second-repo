import AdminLogin from "@/components/AdminLogin";
import PickAdmin from "@/components/PickAdmin";
import { isAdmin } from "@/lib/admin";
import { picksWithResults } from "@/lib/picks";

export const dynamic = "force-dynamic";
export const metadata = { title: "Admin · BigStocks", robots: { index: false } };

export default async function Admin() {
  if (!(await isAdmin())) return <AdminLogin />;
  const picks = await picksWithResults();
  return (
    <PickAdmin
      picks={picks.map((p) => ({
        id: p.id,
        ticker: p.ticker,
        title: p.title,
        kind: p.kind,
        tier: p.tier,
        author: p.author,
        postedAt: p.postedAt,
        closed: Boolean(p.closedAt),
        returnPct: p.returnPct,
      }))}
    />
  );
}
