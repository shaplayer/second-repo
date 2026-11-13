import type { NextConfig } from "next";

const dev = process.env.NODE_ENV !== "production";

/**
 * What the browser may load. Our own pages and scripts, plus TradingView's widget script and frames
 * (prices and charts come only from there, straight to the visitor's browser). Nothing else.
 */
const csp = [
  "default-src 'self'",
  `script-src 'self' 'unsafe-inline' https://s3.tradingview.com${dev ? " 'unsafe-eval'" : ""}`,
  "frame-src https://s.tradingview.com https://www.tradingview-widget.com https://*.tradingview.com https://*.tradingview-widget.com",
  "style-src 'self' 'unsafe-inline'",
  "img-src 'self' data: https:",
  "font-src 'self' data:",
  `connect-src 'self'${dev ? " ws:" : ""}`,
  "base-uri 'self'",
  "form-action 'self'",
  "frame-ancestors 'none'",
].join("; ");

const nextConfig: NextConfig = {
  poweredByHeader: false,
  serverExternalPackages: ["pg"],
  async headers() {
    return [
      {
        source: "/:path*",
        headers: [
          { key: "Content-Security-Policy", value: csp },
          { key: "X-Content-Type-Options", value: "nosniff" },
          { key: "X-Frame-Options", value: "DENY" },
          { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
          { key: "Permissions-Policy", value: "camera=(), microphone=(), geolocation=()" },
        ],
      },
    ];
  },
  /**
   * Addresses of the two old sites that people have bookmarked or that sit in emails already sent.
   * The query string (the code in a confirm or unsubscribe link) is carried over automatically.
   */
  async redirects() {
    const to = (source: string, destination: string) => ({ source, destination, permanent: false });
    return [
      // Links in emails sent by the old data site and the old app.
      to("/alerts/confirm", "/confirm"),
      to("/api/follow/confirm", "/confirm"),
      to("/alerts/manage", "/unsubscribe"),
      to("/follow/unsubscribe", "/unsubscribe"),
      // Old pages.
      to("/news/:ticker", "/stock/:ticker"),
      to("/filings", "/news"),
      to("/alerts", "/#pick"),
      to("/watchlist", "/my-stocks"),
      to("/login", "/sign-in"),
      to("/signup", "/sign-in"),
      to("/account", "/settings"),
      // Removed for good (plan decisions 2, 3 and 6): the track record, Level 2 and paid plans.
      to("/track-record", "/picks"),
      to("/premium", "/"),
      to("/membership", "/"),
      to("/level-2", "/"),
    ];
  },
};

export default nextConfig;
