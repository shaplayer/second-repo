import Link from "next/link";
import { getAccount } from "@/lib/account";

/** Top-bar link: "Sign in" for visitors, the account initial for signed-in users. */
export default async function AccountButton() {
  const me = await getAccount().catch(() => null);
  if (!me)
    return (
      <Link href="/signin" className="btn primary bar-btn">
        Sign in
      </Link>
    );
  return (
    <Link href="/account" className="avatar" aria-label="Your account" title={me.email}>
      {me.email.slice(0, 1).toUpperCase()}
    </Link>
  );
}
