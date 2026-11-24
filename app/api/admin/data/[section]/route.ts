import { adminLoaders } from "@/lib/data/admin";
import { db } from "@/lib/db";
import { currentUser, json } from "@/lib/web/request";

export const dynamic = "force-dynamic";

export async function GET(_req: Request, context: { params: Promise<{ section: string }> }) {
  const user = await currentUser();
  if (!user) return json({ error: "Sign in to use the staff panel." }, 401);
  if (!user.isAdmin) return json({ error: "Only staff can view this data." }, 403);
  const { section } = await context.params;
  if (section === "session") return json({ id: user.id });
  if (!Object.hasOwn(adminLoaders, section)) return json({ error: "Unknown staff data section." }, 404);
  try {
    const loader = adminLoaders[section as keyof typeof adminLoaders];
    return json(await loader(db()));
  } catch (error) {
    console.error(`[admin] could not load ${section}:`, error);
    return json({ error: "Could not load staff data. Please try again." }, 500);
  }
}
