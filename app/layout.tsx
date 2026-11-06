import type { Metadata, Viewport } from "next";
import "@fontsource-variable/inter";
import "./globals.css";
import { AlertsDialog } from "@/components/AlertsDialog";

const siteUrl = process.env.NEXT_PUBLIC_SITE_URL || "https://bigstocks.com";

export const metadata: Metadata = {
  metadataBase: new URL(siteUrl),
  title: "BigStocks: Stock alerts, breaking news & SEC filings by text and email",
  description:
    "Big stock alerts and breaking news, on your phone in seconds. Our picks plus real-time press releases and SEC filings, by text and email.",
  openGraph: {
    title: "BigStocks: Big stock alerts and breaking news, on your phone in seconds.",
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
