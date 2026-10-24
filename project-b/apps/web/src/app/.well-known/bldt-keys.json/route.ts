/**
 * Public signing keys for work records (JWKS). Served at the web origin so a record's issuer URL
 * and its keys share one domain; the API holds the keys.
 */
export const dynamic = "force-dynamic";

export async function GET() {
  const api = process.env.API_INTERNAL_URL || "http://127.0.0.1:4000";
  try {
    const res = await fetch(`${api}/keys`, { cache: "no-store" });
    if (!res.ok) return Response.json({ keys: [] }, { status: res.status === 503 ? 404 : 502 });
    return new Response(await res.text(), {
      headers: { "content-type": "application/json", "cache-control": "public, max-age=3600", "access-control-allow-origin": "*" },
    });
  } catch {
    return Response.json({ error: "unavailable" }, { status: 503 });
  }
}
