import type { Metadata, Viewport } from "next";
import "@fontsource-variable/inter";
import "./globals.css";

const siteUrl = process.env.NEXT_PUBLIC_SITE_URL || "https://bigstocks.com";

export const metadata: Metadata = {
  metadataBase: new URL(siteUrl),
  title: "BigStocks: Free pre-market stock alerts, news & SEC filings",
  description:
    "In-house scanners find the stocks moving before the bell. Free pre-market alerts, a live press release and SEC filings feed, and a public track record.",
  openGraph: {
    title: "BigStocks: See the whole market. Catch the big moves first.",
    description: "Free pre-market stock alerts sent to 125,000 subscribers. Live news & SEC filings feed.",
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
      <body className="min-h-dvh overflow-x-hidden">{children}</body>
    </html>
  );
}
