import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { ItemPage } from "@/components/item/ItemPage";
import { getFeedItem } from "@/lib/data/feed";
import { db } from "@/lib/db";

export const dynamic = "force-dynamic";
type Props = { params: Promise<{ accession: string }> };

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const item = await getFeedItem(db(), `f:${(await params).accession}`).catch(() => null);
  if (!item) return { title: "Filing not found" };
  return { title: `${item.ticker ? `$${item.ticker}: ` : ""}${item.headline}`, description: item.summary?.oneSentence ?? `${item.typeLabel} from ${item.company}.` };
}

export default async function FilingPage({ params }: Props) {
  const item = await getFeedItem(db(), `f:${(await params).accession}`);
  if (!item) notFound();
  return <ItemPage item={item} />;
}
