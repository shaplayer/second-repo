import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // Lets a test build run without disturbing the running dev server (NEXT_DIST_DIR=.next-build npm run build).
  distDir: process.env.NEXT_DIST_DIR || ".next",
};

export default nextConfig;
