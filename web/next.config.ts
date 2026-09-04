import type { NextConfig } from "next";
import path from "node:path";

const nextConfig: NextConfig = {
  // Turbopack does not resolve files outside the project root
  // (next/dist/docs/.../next-config-js/turbopack.md: "Files outside of the
  // project root are not resolved"). @/shared/* and @/engine/* live in
  // ../src, so the root must be the repo root - the common parent of
  // web/ and src/ - not web/ itself.
  turbopack: {
    root: path.resolve(__dirname, ".."),
  },
};

export default nextConfig;
