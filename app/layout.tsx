import type { Metadata, Viewport } from "next";
import "@fontsource-variable/inter";
import "./globals.css";
import { AlertsDialog } from "@/components/AlertsDialog";

const siteUrl = process.env.NEXT_PUBLIC_SITE_URL || "https://bigstocks.com";

export const metadata: Metadata = {
  metadataBase: new URL(siteUrl),
  title: "BigStocks: Winning stock alerts, real-time news & SEC filings",
  description:
    "Winning stock alerts plus real-time press releases and SEC filings, sent straight to your email and phone. Never miss the news that moves your stocks.",
  openGraph: {
    title: "BigStocks: Never miss the news that moves your stocks.",
    description: "Winning stock alerts, press releases and SEC filings by email and text. Join 125,000+ investors.",
    url: siteUrl,
    siteName: "BigStocks",
    type: "website",
  },
  twitter: { card: "summary_large_image" },
};

export const viewport: Viewport = { themeColor: "#07090a", colorScheme: "dark" };

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body className="min-h-dvh overflow-x-hidden">
        {children}
        <AlertsDialog />
      </body>
    </html>
  );
}
