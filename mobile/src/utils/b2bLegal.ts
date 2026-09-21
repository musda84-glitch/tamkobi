export const LEGAL_ACCEPT_KEYS = {
  "mesafeli-satis": "accept_mss",
  "on-bilgilendirme": "accept_obf",
  kvkk: "accept_kvkk",
} as const;

export type LegalAcceptMap = Record<string, boolean>;

/** Cart legal boxes start checked so the customer can uncheck if they want. */
export function isLegalAccepted(accepted: LegalAcceptMap | null | undefined, slug: string): boolean {
  return accepted?.[slug] !== false;
}

export function seedLegalAccept(
  current: LegalAcceptMap | null | undefined,
  docs: Array<{ slug?: string } | null | undefined> | null | undefined
): LegalAcceptMap {
  const next: LegalAcceptMap = { ...(current || {}) };
  let changed = false;
  for (const doc of docs || []) {
    const slug = String(doc?.slug || "").trim();
    if (!slug || slug in next) continue;
    next[slug] = true;
    changed = true;
  }
  return changed ? next : current || next;
}

export function toggleLegalAccept(current: LegalAcceptMap | null | undefined, slug: string): LegalAcceptMap {
  const key = String(slug || "").trim();
  if (!key) return { ...(current || {}) };
  return { ...(current || {}), [key]: !isLegalAccepted(current, key) };
}

export function legalAcceptPayload(accepted: LegalAcceptMap | null | undefined): Record<string, boolean> {
  const out: Record<string, boolean> = {};
  (Object.entries(LEGAL_ACCEPT_KEYS) as [keyof typeof LEGAL_ACCEPT_KEYS, string][]).forEach(([slug, key]) => {
    out[key] = isLegalAccepted(accepted, slug);
  });
  return out;
}
