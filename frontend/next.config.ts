import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // Emit a self-contained server bundle so the Docker image can ship just
  // the build output instead of the whole node_modules tree.
  output: "standalone",
};

export default nextConfig;
