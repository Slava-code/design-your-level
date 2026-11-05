import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // Live, polling-driven app: no component caching or partial prefetch wanted.
  cacheComponents: false,
  // Lets several dev servers run side by side (each with its own NEXT_DIST_DIR) during development/testing.
  distDir: process.env.NEXT_DIST_DIR || ".next",
  images: {
    remotePatterns: [{ protocol: "https", hostname: "*.public.blob.vercel-storage.com" }],
  },
};

export default nextConfig;
