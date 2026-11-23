export const dynamic = "force-dynamic";
/** Lightweight liveness check (used by the keep-warm schedule). */
export function GET() {
  return Response.json({ ok: true, at: new Date().toISOString() }, { headers: { "Cache-Control": "no-store" } });
}
