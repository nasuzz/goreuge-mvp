import path from "node:path";
import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // Turbopack does not resolve files outside the project root
  // (next/dist/docs/.../next-config-js/turbopack.md: "Files outside of the
  // project root are not resolved"). @/shared/* and @/engine/* live in
  // ../src, so the root must be the repo root - the common parent of
  // web/ and src/ - not web/ itself.
  turbopack: {
    root: path.resolve(__dirname, ".."),
  },
  // `next dev` detects an AI coding agent and writes AGENTS.md / CLAUDE.md into
  // this directory by default (next/dist/server/lib/generate-agent-files.js).
  // We keep those files out of the repo: a checked-in file telling any agent
  // that opens the repo to go read something is a prompt-injection shape we do
  // not want in version control, even though the generator itself is genuine.
  // The version-matched docs stay readable at node_modules/next/dist/docs/.
  agentRules: false,
};

export default nextConfig;
