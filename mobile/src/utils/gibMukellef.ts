/** Canlı GİB mükellef kararı. Cari kartındaki is_e_invoice_user kesimde kullanılmaz. */

import { get, type ApiClient } from "../api/client";
import { digitsTax } from "./efaturaOnay";

export type GibMukellef = {
  tax_id?: string;
  is_e_invoice_user?: boolean;
  suggested_e_type?: string;
  alias?: string | null;
  message?: string;
  source?: string;
};

export type GibEntry =
  | { status: "ok"; data: GibMukellef }
  | { status: "error"; error: string };

const PLACEHOLDER_TAX_IDS = new Set([
  "11111111111",
  "1111111111",
  "00000000000",
  "0000000000",
  "99999999999",
  "9999999999",
]);

export function isPlaceholderTaxId(raw?: string | null): boolean {
  const d = digitsTax(raw);
  if (!d) return false;
  if (PLACEHOLDER_TAX_IDS.has(d)) return true;
  if ((d.length === 10 || d.length === 11) && new Set(d).size === 1) return true;
  return false;
}

export function buyerNeedsLiveMukellefQuery(tax?: string | null): boolean {
  const d = digitsTax(tax);
  return (d.length === 10 || d.length === 11) && !isPlaceholderTaxId(d);
}

export function eTypeFromGib(data?: GibMukellef | null): "e_invoice" | "e_archive" {
  if (!data) return "e_archive";
  if (data.is_e_invoice_user === false || data.suggested_e_type === "e_archive") return "e_archive";
  const msg = String(data.message || "").toLocaleLowerCase("tr-TR");
  if (/bulunamad|kay[ıi]tl[ıi] de[gğ]il|kay[ıi]t yok/.test(msg)) return "e_archive";
  if (data.is_e_invoice_user === true || data.suggested_e_type === "e_invoice") return "e_invoice";
  return "e_archive";
}

export function contactMukellefPatch(gibMeta?: GibMukellef | null): { is_e_invoice_user: boolean; e_invoice_alias?: string } | null {
  if (!gibMeta || typeof gibMeta.is_e_invoice_user !== "boolean") return null;
  const patch: { is_e_invoice_user: boolean; e_invoice_alias?: string } = {
    is_e_invoice_user: !!gibMeta.is_e_invoice_user,
  };
  if (gibMeta.alias) patch.e_invoice_alias = String(gibMeta.alias);
  return patch;
}

export function faturalastirMenuLabel(gibLookup?: GibEntry | GibMukellef | null): string {
  if (!gibLookup) return "Faturalaştır";
  if ("status" in gibLookup && (gibLookup.status === "error" || !("data" in gibLookup))) {
    if (gibLookup.status === "error") return "Faturalaştır";
  }
  const data = gibLookup && "data" in gibLookup ? gibLookup.data : gibLookup;
  if (!data || typeof data !== "object") return "Faturalaştır";
  if (
    typeof data.is_e_invoice_user !== "boolean"
    && data.suggested_e_type !== "e_invoice"
    && data.suggested_e_type !== "e_archive"
  ) {
    return "Faturalaştır";
  }
  return eTypeFromGib(data) === "e_invoice" ? "Faturalaştır (E-Fatura)" : "Faturalaştır (E-Arşiv)";
}

const cache = new Map<string, GibEntry | Promise<GibEntry>>();

export function clearGibMukellefCache(): void {
  cache.clear();
}

function localArchive(tax: string): GibEntry {
  const placeholder = isPlaceholderTaxId(tax);
  return {
    status: "ok",
    data: {
      tax_id: tax,
      is_e_invoice_user: false,
      suggested_e_type: "e_archive",
      alias: null,
      source: placeholder ? "placeholder" : "none",
      message: placeholder
        ? "Yer tutucu VKN/TCKN — e-Arşiv kesilmeli."
        : "VKN/TCKN yok veya geçersiz — e-Arşiv kesilir.",
    },
  };
}

export function dropGibMukellef(companyId: string, taxId?: string | null): void {
  cache.delete(`${companyId}|${digitsTax(taxId) || "empty"}`);
}

/** Aynı company+VKN için tek istek. Hata önbelleğe yazılmaz. */
export function fetchGibMukellef(client: ApiClient, companyId: string, taxId?: string | null): Promise<GibEntry> {
  const tax = digitsTax(taxId);
  const key = `${companyId}|${tax || "empty"}`;
  if (!buyerNeedsLiveMukellefQuery(tax)) {
    const entry = localArchive(tax);
    cache.set(key, entry);
    return Promise.resolve(entry);
  }
  const hit = cache.get(key);
  if (hit && !(hit instanceof Promise) && hit.status === "ok") return Promise.resolve(hit);
  if (hit instanceof Promise) return hit;
  const promise = get<GibMukellef>(client, "/gib/lookup", { tax_id: tax, company_id: companyId })
    .then((data) => {
      const entry: GibEntry = { status: "ok", data: data || {} };
      cache.set(key, entry);
      return entry;
    })
    .catch((err: { message?: string; gibEntry?: GibEntry }) => {
      if (cache.get(key) === promise) cache.delete(key);
      const fail: GibEntry = { status: "error", error: err?.message || "GİB sorgusu başarısız." };
      err.gibEntry = fail;
      throw err;
    });
  cache.set(key, promise);
  return promise;
}
