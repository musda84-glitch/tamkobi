/** Portal linkinden veya düz tokendan B2B kimliğini çıkarır. */
export function parseB2bToken(input?: string | null): string | null {
  const s = String(input || "").trim();
  if (!s) return null;
  const portal = s.match(/\/portal\/([A-Za-z0-9_-]+)/i);
  if (portal?.[1]) return portal[1];
  const query = s.match(/[?&]b2b=([A-Za-z0-9_-]+)/i);
  if (query?.[1]) return query[1];
  if (/^[A-Za-z0-9_-]{16,64}$/.test(s)) return s;
  return null;
}
