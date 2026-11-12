import { redirect } from "next/navigation";
import SignIn from "@/components/SignIn";
import { getAccount } from "@/lib/account";

export const dynamic = "force-dynamic";
export const metadata = { title: "Sign in · BigStocks" };

export default async function SignInPage({ searchParams }: { searchParams: Promise<{ next?: string; error?: string }> }) {
  const { next, error } = await searchParams;
  if (await getAccount()) redirect(next && next.startsWith("/") ? next : "/account");
  return (
    <section className="panel" style={{ maxWidth: 420, margin: "48px auto" }}>
      <SignIn next={next} error={error} />
    </section>
  );
}
