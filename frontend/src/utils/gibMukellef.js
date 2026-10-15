/** Canlı GİB mükellef kararı. Cari kartındaki is_e_invoice_user kesimde kullanılmaz. */

import axios from "axios";
import { API_URL } from "../context/AuthContext";

export function digitsTax(raw) {
  return String(raw || "").replace(/\D/g, "");
}

/** contact_tax.PLACEHOLDER_TAX_IDS + aynı rakamın tekrarı (2222222222). */
export const PLACEHOLDER_TAX_IDS = new Set([
  "11111111111",
  "1111111111",
  "00000000000",
  "0000000000",
  "99999999999",
  "9999999999",
]);

export function isPlaceholderTaxId(raw) {
  const d = digitsTax(raw);
  if (!d) return false;
  if (PLACEHOLDER_TAX_IDS.has(d)) return true;
  if ((d.length === 10 || d.length === 11) && new Set(d).size === 1) return true;
  return false;
}

export function buyerNeedsLiveMukellefQuery(tax) {
  const d = digitsTax(tax);
  return (d.length === 10 || d.length === 11) && !isPlaceholderTaxId(d);
}

export function docBuyerTaxId(doc, contact) {
  const tax =
    contact?.tax_number_or_id ||
    contact?.tax_id ||
    doc?.contact_tax_id ||
    doc?.buyer_tax_id ||
    doc?.customer_tax_id ||
    doc?.tax_number_or_id ||
    doc?.tax_id ||
    "";
  return digitsTax(tax);
}

/** GİB yanıtı → kesilecek tür. Mükellef değil / bulunamadı / yer tutucu → e_archive. */
export function eTypeFromGib(data) {
  if (!data) return "e_archive";
  if (data.is_e_invoice_user === false || data.suggested_e_type === "e_archive") return "e_archive";
  const msg = String(data.message || "").toLocaleLowerCase("tr-TR");
  if (/bulunamad|kay[ıi]tl[ıi] de[gğ]il|kay[ıi]t yok/.test(msg)) return "e_archive";
  if (data.is_e_invoice_user === true || data.suggested_e_type === "e_invoice") return "e_invoice";
  return "e_archive";
}

export function contactMukellefPatch(gibMeta) {
  if (!gibMeta || typeof gibMeta.is_e_invoice_user !== "boolean") return null;
  const patch = { is_e_invoice_user: !!gibMeta.is_e_invoice_user };
  if (gibMeta.alias) patch.e_invoice_alias = String(gibMeta.alias);
  return patch;
}

/** Sipariş listesi: tür cari bayrağından değil GİB sonucundan. */
export function faturalastirMenuLabel(gibLookup) {
  if (!gibLookup || gibLookup.status === "loading" || gibLookup.status === "error") return "Faturalaştır";
  const data = gibLookup.data && !gibLookup.data.status ? gibLookup.data : gibLookup.data || gibLookup;
  if (!data || data.status === "loading" || data.status === "error") return "Faturalaştır";
  if (
    typeof data.is_e_invoice_user !== "boolean"
    && data.suggested_e_type !== "e_invoice"
    && data.suggested_e_type !== "e_archive"
  ) {
    return "Faturalaştır";
  }
  return eTypeFromGib(data) === "e_invoice" ? "Faturalaştır (E-Fatura)" : "Faturalaştır (E-Arşiv)";
}

const cache = new Map();

export function clearGibMukellefCache() {
  cache.clear();
}

export function peekGibMukellef(companyId, taxId) {
  const tax = digitsTax(taxId);
  return cache.get(`${companyId}|${tax || "empty"}`) || null;
}

export function dropGibMukellef(companyId, taxId) {
  const tax = digitsTax(taxId);
  cache.delete(`${companyId}|${tax || "empty"}`);
}

function localArchiveEntry(tax) {
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

/**
 * Aynı company+VKN için tek istek. Hata önbelleğe yazılmaz (502 sessiz e-Fatura olmasın).
 */
export function fetchGibMukellef(companyId, taxId, axiosGet = axios.get) {
  const tax = digitsTax(taxId);
  const key = `${companyId}|${tax || "empty"}`;
  if (!buyerNeedsLiveMukellefQuery(tax)) {
    const entry = localArchiveEntry(tax);
    cache.set(key, entry);
    return Promise.resolve(entry);
  }
  const hit = cache.get(key);
  if (hit?.status === "ok") return Promise.resolve(hit);
  if (hit?.status === "loading" && hit.promise) return hit.promise;
  const promise = Promise.resolve()
    .then(() => axiosGet(`${API_URL}/gib/lookup`, { params: { tax_id: tax, company_id: companyId } }))
    .then((r) => {
      const entry = { status: "ok", data: r?.data || {} };
      cache.set(key, entry);
      return entry;
    })
    .catch((err) => {
      if (cache.get(key)?.promise === promise) cache.delete(key);
      const detail = err?.response?.data?.detail || err?.message || "GİB sorgusu başarısız.";
      const fail = {
        status: "error",
        error: typeof detail === "string" ? detail : "GİB sorgusu başarısız.",
      };
      err.gibEntry = fail;
      throw err;
    });
  cache.set(key, { status: "loading", promise });
  return promise;
}
