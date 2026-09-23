
import React from "react";

export const LEGAL_DOCS = [
  { slug: "mesafeli-satis", key: "mss", accept: "accept_mss", label: "Mesafeli Satış Sözleşmesi" },
  { slug: "on-bilgilendirme", key: "obf", accept: "accept_obf", label: "Ön Bilgilendirme Formu" },
  { slug: "kvkk", key: "kvkk", accept: "accept_kvkk", label: "KVKK Aydınlatma Metni" },
];

export const emptyLegalConsent = () => ({ mss: false, obf: false, kvkk: false });

export const B2B_LOGIN_LEGAL_KEY = "tamkobi_b2b_login_legal";

/** Onay zorunluluğu kaldırıldı — her zaman true (geriye dönük uyumluluk). */
export const allLegalAccepted = (_v) => true;

export const allLegalChecked = (v) => !!(v?.mss && v?.obf && v?.kvkk);

export function parseStoredLegalConsent(raw) {
  try {
    const parsed = typeof raw === "string" ? JSON.parse(raw || "{}") : raw || {};
    if (!parsed || typeof parsed !== "object") return emptyLegalConsent();
    return {
      mss: parsed.mss === true || parsed["mesafeli-satis"] === true,
      obf: parsed.obf === true || parsed["on-bilgilendirme"] === true,
      kvkk: parsed.kvkk === true,
    };
  } catch {
    return emptyLegalConsent();
  }
}

export function loadStoredLegalConsent(key = B2B_LOGIN_LEGAL_KEY) {
  try {
    return parseStoredLegalConsent(localStorage.getItem(key));
  } catch {
    return emptyLegalConsent();
  }
}

export function saveStoredLegalConsent(value, key = B2B_LOGIN_LEGAL_KEY) {
  try {
    localStorage.setItem(key, JSON.stringify({
      mss: !!value?.mss,
      obf: !!value?.obf,
      kvkk: !!value?.kvkk,
    }));
  } catch {
    /* ignore */
  }
}

export const legalPayload = (v) => ({ accept_mss: !!v?.mss, accept_obf: !!v?.obf, accept_kvkk: !!v?.kvkk });

export function legalHref(slug, extra = "") {
  return `/yasal/${slug}${extra || ""}`;
}

export function LegalConsent({ value, onChange, hrefExtra = "", prefix = "", className = "", required = false }) {
  const v = value || emptyLegalConsent();
  return (
    <div className={`space-y-2 ${className}`} data-testid={`${prefix}legal-consent`}>
      {LEGAL_DOCS.map((d) => (
        <label key={d.key} className="flex items-start gap-2 text-[11px] text-slate-700 cursor-pointer">
          <input
            type="checkbox"
            checked={!!v[d.key]}
            onChange={(e) => onChange({ ...v, [d.key]: e.target.checked })}
            className="mt-0.5 rounded border-slate-300"
            data-testid={`${prefix}legal-${d.key}`}
          />
          <span>
            <a href={legalHref(d.slug, hrefExtra)} target="_blank" rel="noreferrer" className="font-semibold underline decoration-dotted text-emerald-800 hover:text-emerald-600" data-testid={`${prefix}legal-link-${d.key}`}>{d.label}</a>
            {" "}metnini okudum ve kabul ediyorum{required ? "." : " (isteğe bağlı)."}
          </span>
        </label>
      ))}
    </div>
  );
}

export function LegalFooterLinks({ hrefExtra = "", className = "", prefix = "legal-footer" }) {
  return (
    <nav className={`flex flex-wrap items-center justify-center gap-x-3 gap-y-1 text-[11px] ${className}`} data-testid={prefix}>
      {LEGAL_DOCS.map((d) => (
        <a key={d.slug} href={legalHref(d.slug, hrefExtra)} target="_blank" rel="noreferrer" className="underline decoration-dotted hover:text-emerald-600" data-testid={`${prefix}-${d.key}`}>{d.label}</a>
      ))}
    </nav>
  );
}
