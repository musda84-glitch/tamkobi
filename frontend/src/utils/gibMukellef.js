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

export const DOC_TAX_FIELDS = ["contact_tax_id", "buyer_tax_id", "customer_tax_id", "tax_number_or_id", "tax_id"];
export const CONTACT_TAX_FIELDS = ["tax_number_or_id", "tax_id", "tax_number", "vkn", "tckn"];

function firstTaxDigits(src, fields) {
  if (!src) return "";
  for (const key of fields) {
    const d = digitsTax(src[key]);
    if (d) return d;
  }
  return "";
}

function usableTax(raw) {
  const d = digitsTax(raw);
  if (!d || isPlaceholderTaxId(d)) return "";
  return d;
}

export function contactCardTaxId(contact) {
  return firstTaxDigits(contact, CONTACT_TAX_FIELDS);
}

export function contactIdOf(doc) {
  return String(doc?.contact_id || doc?.contactId || "").trim();
}

export function findListedContact(doc, contacts) {
  const id = contactIdOf(doc);
  if (!id) return null;
  return (contacts || []).find((c) => String(c?.id || c?._id || "") === id) || null;
}

/** Cari listede yoksa GET /contacts/{id} gerekir; gelene kadar e-Arşiv önerilmez. */
export function buyerContactPending(doc, contacts) {
  return !!contactIdOf(doc) && !findListedContact(doc, contacts);
}

/** Sorgu VKN'si: belgede gerçek kimlik varsa o, değilse cari. Yer tutucu cariyi ezmez. */
export function buyerTaxChoice(doc, contact) {
  const docTax = firstTaxDigits(doc, DOC_TAX_FIELDS);
  const contactTax = contactCardTaxId(contact);
  const docReal = usableTax(docTax);
  const contactReal = usableTax(contactTax);
  let tax = "";
  let source = "";
  if (docReal) {
    tax = docReal;
    source = "Belge";
  } else if (contactReal) {
    tax = contactReal;
    source = "Cari";
  }
  return {
    tax,
    docTax,
    contactTax,
    mismatch: !!(docReal && contactReal && docReal !== contactReal),
    source,
    placeholder: !docReal && !contactReal,
  };
}

export function docBuyerTaxId(doc, contact) {
  return buyerTaxChoice(doc, contact).tax;
}

/**
 * GİB yanıtı → kesilecek tür. Mesaj metnine bakılmaz.
 * Belirsiz / unknown → null (e-Arşiv sayılmaz).
 */
export function eTypeFromGib(data) {
  if (!data || typeof data !== "object") return null;
  const status = data.lookup_status;
  if (status === "unknown" || status === "error") return null;
  if (status === "mukellef") return "e_invoice";
  if (status === "not_mukellef") return "e_archive";
  const user = data.is_e_invoice_user;
  const suggested = data.suggested_e_type;
  if (user === true && suggested === "e_archive") return null;
  if (user === false && suggested === "e_invoice") return null;
  if (user === true || suggested === "e_invoice") return "e_invoice";
  if (user === false || suggested === "e_archive") return "e_archive";
  return null;
}

export function contactMukellefPatch(gibMeta) {
  if (!gibMeta || typeof gibMeta.is_e_invoice_user !== "boolean") return null;
  const patch = { is_e_invoice_user: !!gibMeta.is_e_invoice_user };
  if (gibMeta.alias) patch.e_invoice_alias = String(gibMeta.alias);
  return patch;
}

/** Taslak onay: GİB tür eki yok — e-belge ayrı adımdır. */
export function faturalastirMenuLabel(_gibLookup) {
  return "Taslağı Faturalaştır";
}

export const FATURALASTIR_CONFIRM_DETAIL = "Cari bakiyesi ve stok işlenecek. E-belge gönderimi ayrı adımdır.";

export const GIB_MUKELLEF_TTL_MS = 120_000;

const cache = new Map();

export function clearGibMukellefCache() {
  cache.clear();
}

function cacheKey(companyId, tax) {
  return `${companyId}|${tax || "empty"}`;
}

function freshOk(hit) {
  if (!hit || hit.status !== "ok") return false;
  if (hit.expiresAt && hit.expiresAt <= Date.now()) return false;
  return true;
}

export function peekGibMukellef(companyId, taxId) {
  const tax = digitsTax(taxId);
  const key = cacheKey(companyId, tax);
  const hit = cache.get(key);
  if (hit?.status === "ok" && hit.expiresAt && hit.expiresAt <= Date.now()) {
    cache.delete(key);
    return null;
  }
  return hit || null;
}

export function dropGibMukellef(companyId, taxId) {
  cache.delete(cacheKey(companyId, digitsTax(taxId)));
}

function localArchiveEntry(tax) {
  return {
    status: "ok",
    expiresAt: Date.now() + GIB_MUKELLEF_TTL_MS,
    data: {
      tax_id: tax,
      is_e_invoice_user: false,
      suggested_e_type: "e_archive",
      lookup_status: "not_mukellef",
      alias: null,
      aliases: [],
      source: "placeholder",
      message: "Yer tutucu VKN/TCKN — e-Arşiv kesilmeli.",
    },
  };
}

function gibFail(err, fallback) {
  const detail = err?.response?.data?.detail || err?.message || fallback;
  const error = typeof detail === "string" ? detail : fallback;
  const fail = { status: "error", error };
  if (err && typeof err === "object") err.gibEntry = fail;
  return fail;
}

/**
 * Aynı company+VKN için tek istek. Hata ve unknown önbelleğe yazılmaz.
 * Başarılı sonuç 120 sn tutulur. refresh=1 backend önbelleğini de baypas eder.
 */
export function fetchGibMukellef(companyId, taxId, axiosGet = axios.get, options = {}) {
  const tax = digitsTax(taxId);
  const key = cacheKey(companyId, tax);
  const refresh = !!(options && options.refresh);
  if (!buyerNeedsLiveMukellefQuery(tax)) {
    if (!tax || isPlaceholderTaxId(tax)) {
      const entry = localArchiveEntry(tax);
      cache.set(key, entry);
      return Promise.resolve(entry);
    }
    const err = new Error("VKN/TCKN 10 veya 11 haneli olmalı");
    gibFail(err, "VKN/TCKN 10 veya 11 haneli olmalı");
    return Promise.reject(err);
  }
  if (!refresh) {
    const hit = cache.get(key);
    if (freshOk(hit)) return Promise.resolve(hit);
    if (hit?.status === "ok") cache.delete(key);
    if (hit?.status === "loading" && hit.promise) return hit.promise;
  }
  const token = {};
  const params = { tax_id: tax, company_id: companyId };
  if (refresh) params.refresh = 1;
  const promise = Promise.resolve()
    .then(() => axiosGet(`${API_URL}/gib/lookup`, { params }))
    .then((r) => {
      const data = r?.data || {};
      if (data.lookup_status === "unknown" || data.lookup_status === "error" || !eTypeFromGib(data)) {
        const err = new Error(data.message || data.detail || "GİB mükellefiyeti doğrulanamadı.");
        err.response = { data: { detail: err.message }, status: 422 };
        throw err;
      }
      const entry = { status: "ok", data, expiresAt: Date.now() + GIB_MUKELLEF_TTL_MS };
      const cur = cache.get(key);
      if (!cur || cur.token === token || cur.status !== "loading") cache.set(key, entry);
      return entry;
    })
    .catch((err) => {
      const cur = cache.get(key);
      if (cur?.token === token) cache.delete(key);
      gibFail(err, "GİB sorgusu başarısız.");
      throw err;
    });
  cache.set(key, { status: "loading", promise, token });
  return promise;
}
