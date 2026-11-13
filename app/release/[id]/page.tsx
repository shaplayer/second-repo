import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { ItemPage } from "@/components/item/ItemPage";
import { getFeedItem } from "@/lib/data/feed";
import { db } from "@/lib/db";

export const dynamic = "force-dynamic";
type Props = { params: Promise<{ id: string }> };

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const item = await getFeedItem(db(), `n:${(await params).id}`).catch(() => null);
  if (!item) return { title: "Press release not found" };
  return { title: `${item.ticker ? `$${item.ticker}: ` : ""}${item.headline}`, description: `Press release from ${item.company}, via ${item.sourceName}.` };
}

export default async function ReleasePage({ params }: Props) {
  const item = await getFeedItem(db(), `n:${(await params).id}`);
  if (!item) notFound();
  return <ItemPage item={item} />;
}
