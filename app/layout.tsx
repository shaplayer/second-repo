import type { Metadata, Viewport } from "next";
import "@fontsource-variable/manrope";
import "./globals.css";
import { siteUrl } from "@/lib/config";

export const metadata: Metadata = {
  metadataBase: new URL(siteUrl()),
  title: { default: "BigStocks: every press release and SEC filing, in one sentence", template: "%s | BigStocks" },
  description:
    "What's the latest on your stock? Every press release and SEC filing, explained in one plain sentence the moment it posts. Free email alerts and a free daily pick.",
  openGraph: {
    title: "BigStocks: what's the latest on your stock?",
    description: "Every press release and SEC filing, explained in one sentence, the moment it posts.",
    url: siteUrl(),
    siteName: "BigStocks",
    type: "website",
  },
  twitter: { card: "summary" },
};

export const viewport: Viewport = { themeColor: "#ffffff", colorScheme: "light" };

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body>
        <a href="#main" className="sr-only focus:not-sr-only focus:absolute focus:left-4 focus:top-4 focus:z-50 focus:rounded-lg focus:bg-white focus:px-4 focus:py-2">
          Skip to the main content
        </a>
        {children}
      </body>
    </html>
  );
}
