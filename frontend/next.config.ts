import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // The app is one client-side page, so it builds to plain static files
  // (in out/) and needs no Node server at run time. Dockerfile.frontend
  // serves them with Caddy.
  output: "export",
};

export default nextConfig;
