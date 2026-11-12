import type { Metadata } from "next";
import { Archivo, IBM_Plex_Mono, IBM_Plex_Sans } from "next/font/google";
import Link from "next/link";
import AccountButton from "@/components/AccountButton";
import SearchBox from "@/components/SearchBox";
import "./globals.css";

const display = Archivo({ subsets: ["latin"], axes: ["wdth"], variable: "--f-display" });
const body = IBM_Plex_Sans({ subsets: ["latin"], weight: ["400", "500", "600"], variable: "--f-body" });
const mono = IBM_Plex_Mono({ subsets: ["latin"], weight: ["400", "500"], variable: "--f-mono" });

export const metadata: Metadata = {
  title: "BigStocks",
  description: "Look up any stock. News, filings in plain English, and a simple Strong / Mixed / Weak score.",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" className={`${display.variable} ${body.variable} ${mono.variable}`}>
      <body>
        <header className="bar">
          <div className="wrap">
            <Link href="/" className="logo" aria-label="BigStocks home">
              Big<b>Stocks</b>
            </Link>
            <SearchBox />
            <Link href="/" className="bar-link">
              Markets
            </Link>
            <Link href="/picks" className="bar-link">
              Picks
            </Link>
            <AccountButton />
          </div>
        </header>
        <main className="wrap">{children}</main>
        <footer className="foot">
          <div className="wrap">
            Not investment advice. Prices from Databento. Financials and filings from SEC EDGAR. Scores look only at
            the last four quarterly reports.
          </div>
        </footer>
      </body>
    </html>
  );
}
