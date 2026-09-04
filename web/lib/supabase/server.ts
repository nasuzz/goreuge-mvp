// Server boundary enforced in code: importing this from a Client Component
// fails at build time. Next.js handles this import internally, so the npm
// package does not need to be installed.
import "server-only";
import { createClient } from "@supabase/supabase-js";

// Server-only access (shared-spec D5-a). Never use the NEXT_PUBLIC_ prefix.
// The publishable key is designed to be exposed on clients, so server-only
// access uses the secret key instead.
export function createServerClient() {
  const url = process.env.SUPABASE_URL;
  const key = process.env.SUPABASE_SECRET_KEY;
  if (!url || !key) throw new Error("SUPABASE_URL / SUPABASE_SECRET_KEY not set");
  return createClient(url, key, { auth: { persistSession: false } });
}