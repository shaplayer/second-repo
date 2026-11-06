import type { Metadata } from "next";
import { isAdmin, adminConfigured } from "@/lib/admin-auth";
import { hasDb } from "@/lib/db";
import { emailProvider } from "@/lib/email";
import { smsProvider } from "@/lib/sms";
import { Wordmark } from "@/components/Wordmark";
import { AdminConsole, AdminLogin } from "@/components/admin/AdminConsole";

export const dynamic = "force-dynamic";
export const metadata: Metadata = { title: "Send an alert | BigStocks admin", robots: { index: false, follow: false } };

export default async function AdminPage() {
  const signedIn = await isAdmin();
  const mail = emailProvider();
  const sms = smsProvider();
  return (
    <main className="min-h-dvh">
      <header className="border-b border-line">
        <div className="container-wide flex h-[64px] items-center justify-between">
          <a href="/" aria-label="BigStocks home"><Wordmark /></a>
          <span className="text-[13px] text-faint">Admin · Send an alert</span>
        </div>
      </header>
      <div className="container-wide max-w-[1100px] py-10">
        {!adminConfigured() ? (
          <p className="card p-6 text-muted">Set <code className="text-ink">ADMIN_PASSWORD</code> (12+ characters) in the server&apos;s <code className="text-ink">.env</code>, then restart.</p>
        ) : !signedIn ? (
          <AdminLogin />
        ) : (
          <AdminConsole
            setup={{
              db: hasDb(),
              email: { name: mail.name, ready: mail.configured() && mail.name !== "console" },
              sms: { name: sms.name, ready: sms.configured() && sms.name !== "console" },
            }}
          />
        )}
      </div>
    </main>
  );
}
