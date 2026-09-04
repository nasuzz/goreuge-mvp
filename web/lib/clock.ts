// Single source for today(DateString) / now(DateTimeString).
// Vercel serverless runs on TZ=UTC regardless of region, and TZ is a reserved
// env var so it cannot be changed in project settings. Using
// toISOString().slice(0,10) directly makes requests before 09:00 KST land on
// the previous date.
const KST_OFFSET_MS = 9 * 60 * 60 * 1000;

export function nowIso(): string {
  return new Date().toISOString();
}

export function todayKst(): string {
  // Fixed date for demo reproducibility (shared-spec D11: today = 2026-09-01)
  const demo = process.env.DEMO_TODAY;
  if (demo) return demo;
  return new Date(Date.now() + KST_OFFSET_MS).toISOString().slice(0, 10);
}

export function clock() {
  return { today: todayKst(), now: nowIso() };
}