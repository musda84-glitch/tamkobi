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

export const B2B_LOGIN_LEGAL_KEY = "tamkobi.b2b_login.legal";

export const LOGIN_LEGAL_DOCS = [
  { slug: "mesafeli-satis", label: "Mesafeli Satış Sözleşmesi" },
  { slug: "on-bilgilendirme", label: "Ön Bilgilendirme Formu" },
  { slug: "kvkk", label: "KVKK Aydınlatma Metni" },
] as const;

const LOGIN_LEGAL_ALIASES: Record<string, string> = {
  mss: "mesafeli-satis",
  obf: "on-bilgilendirme",
  "mesafeli-satis": "mesafeli-satis",
  "on-bilgilendirme": "on-bilgilendirme",
  kvkk: "kvkk",
};

/** Login boxes start unchecked; only an explicit true stays checked. */
export function isLoginLegalAccepted(accepted: LegalAcceptMap | null | undefined, slug: string): boolean {
  return accepted?.[slug] === true;
}

export function allLoginLegalAccepted(
  accepted: LegalAcceptMap | null | undefined,
  docs: ReadonlyArray<{ slug?: string }> = LOGIN_LEGAL_DOCS
): boolean {
  return docs.every((d) => isLoginLegalAccepted(accepted, String(d.slug || "")));
}

export function toggleLoginLegalAccept(current: LegalAcceptMap | null | undefined, slug: string): LegalAcceptMap {
  const key = String(slug || "").trim();
  if (!key) return { ...(current || {}) };
  return { ...(current || {}), [key]: !isLoginLegalAccepted(current, key) };
}

export function parseLoginLegalAccept(raw: string | null | undefined): LegalAcceptMap {
  if (!raw || !String(raw).trim()) return {};
  try {
    const parsed = JSON.parse(String(raw)) as Record<string, unknown>;
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) return {};
    const out: LegalAcceptMap = {};
    for (const [key, value] of Object.entries(parsed)) {
      const slug = LOGIN_LEGAL_ALIASES[key];
      if (!slug) continue;
      if (value === true) out[slug] = true;
      else if (value === false) out[slug] = false;
    }
    return out;
  } catch {
    return {};
  }
}

export function serializeLoginLegalAccept(accepted: LegalAcceptMap | null | undefined): string {
  const out: LegalAcceptMap = {};
  for (const doc of LOGIN_LEGAL_DOCS) {
    out[doc.slug] = isLoginLegalAccepted(accepted, doc.slug);
  }
  return JSON.stringify(out);
}
