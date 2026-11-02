/**
 * The time the app's date rules compare against: a deadline, "RSVPs close on the 1st". It is the
 * real time, except in Pramaan's own checks: their throwaway server sets PRAMAAN_TEST_CLOCK=1, and
 * a journey that fixes the time sends it in the x-pramaan-now header, so the rule is tested on
 * that moment instead of by waiting. A draft and the live app start with PRAMAAN_TEST_CLOCK=0,
 * which a committed .env cannot change, so a visitor's header is never read there.
 *
 *   const now = appNow(await headers()); // a page ("next/headers")
 *   const now = appNow(request.headers); // a route handler
 *
 * Compare with this, never Date.now() or the database's now(), for a rule a person can see.
 */
export function appNow(headers?: { get(name: string): string | null } | null): Date {
  if (process.env.PRAMAAN_TEST_CLOCK === "1") {
    const fixed = Date.parse(headers?.get("x-pramaan-now") ?? "");
    if (Number.isFinite(fixed)) return new Date(fixed);
  }
  return new Date();
}
