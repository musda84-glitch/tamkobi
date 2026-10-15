/** Canlı GİB mükellef kararı. Cari kartındaki is_e_invoice_user kesimde kullanılmaz. */

import { get, type ApiClient } from "../api/client";
import { digitsTax } from "./efaturaOnay";

export type GibMukellef = {
  tax_id?: string;
  is_e_invoice_user?: boolean;
  suggested_e_type?: string;
  alias?: string | null;
  aliases?: string[];
  message?: string;
  source?: string;
  name?: string;
  lookup_status?: string;
};

export type GibEntry =
  | { status: "ok"; data: GibMukellef; expiresAt: number }
  | { status: "error"; error: string };

type LoadingSlot = { status: "loading"; promise: Promise<GibEntry>; token: object };

const PLACEHOLDER_TAX_IDS = new Set([
  "11111111111",
  "1111111111",
  "00000000000",
  "0000000000",
  "99999999999",
  "9999999999",
]);

export const GIB_MUKELLEF_TTL_MS = 120_000;

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

function taxField(src: object | null | undefined, key: string): string {
  if (!src) return "";
  const val = (src as Record<string, unknown>)[key];
  return val == null ? "" : String(val);
}

export const DOC_TAX_FIELDS = ["contact_tax_id", "buyer_tax_id", "customer_tax_id", "tax_number_or_id", "tax_id"] as const;
export const CONTACT_TAX_FIELDS = ["tax_number_or_id", "tax_id", "tax_number", "vkn", "tckn"] as const;

function firstTaxDigits(src: object | null | undefined, fields: readonly string[]): string {
  for (const key of fields) {
    const d = digitsTax(taxField(src, key));
    if (d) return d;
  }
  return "";
}

function usableTax(raw?: string | null): string {
  const d = digitsTax(raw);
  if (!d || isPlaceholderTaxId(d)) return "";
  return d;
}

export function contactCardTaxId(contact?: object | null): string {
  return firstTaxDigits(contact, CONTACT_TAX_FIELDS);
}

export function contactIdOf(doc?: object | null): string {
  return String(taxField(doc, "contact_id") || taxField(doc, "contactId") || "").trim();
}

export function findListedContact(doc?: object | null, contacts?: Array<object | null> | null): object | null {
  const id = contactIdOf(doc);
  if (!id) return null;
  return (contacts || []).find((c) => String(taxField(c, "id") || taxField(c, "_id")) === id) || null;
}

export function buyerContactPending(doc?: object | null, contacts?: Array<object | null> | null): boolean {
  return !!contactIdOf(doc) && !findListedContact(doc, contacts);
}

/** Sorgu VKN'si: belgede gerçek kimlik varsa o, değilse cari. Yer tutucu cariyi ezmez. */
export function buyerTaxChoice(doc?: object | null, contact?: object | null) {
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

export function docBuyerTaxId(doc?: object | null, contact?: object | null): string {
  return buyerTaxChoice(doc, contact).tax;
}

/**
 * GİB yanıtı → kesilecek tür. Mesaj metnine bakılmaz.
 * Belirsiz / unknown → null (e-Arşiv sayılmaz).
 */
export function eTypeFromGib(data?: GibMukellef | null): "e_invoice" | "e_archive" | null {
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

export function contactMukellefPatch(gibMeta?: GibMukellef | null): { is_e_invoice_user: boolean; e_invoice_alias?: string } | null {
  if (!gibMeta || typeof gibMeta.is_e_invoice_user !== "boolean") return null;
  const patch: { is_e_invoice_user: boolean; e_invoice_alias?: string } = {
    is_e_invoice_user: !!gibMeta.is_e_invoice_user,
  };
  if (gibMeta.alias) patch.e_invoice_alias = String(gibMeta.alias);
  return patch;
}

/** Taslak onay: GİB tür eki yok — e-belge ayrı adımdır. */
export function faturalastirMenuLabel(_gibLookup?: GibEntry | GibMukellef | null): string {
  return "Taslağı Faturalaştır";
}

export const FATURALASTIR_CONFIRM_DETAIL = "Cari bakiyesi ve stok işlenecek. E-belge gönderimi ayrı adımdır.";

export type GibLookupView = {
  tax: string;
  docTax: string;
  contactTax: string;
  mismatch: boolean;
  taxSource: string;
  name: string;
  source: string;
  aliases: string[];
  eType: "e_invoice" | "e_archive" | null;
  blocked: boolean;
  error: string;
};

/** Modalın gösterdiği GİB özeti. unknown / hata gönderimi kilitler. */
export function gibLookupPresentation(
  doc?: object | null,
  contact?: object | null,
  entry?: GibEntry | null,
  opts?: { contactPending?: boolean },
): GibLookupView {
  const choice = buyerTaxChoice(doc, contact);
  const data = entry && entry.status === "ok" ? entry.data : null;
  const eType = data ? eTypeFromGib(data) : null;
  const aliases = Array.isArray(data?.aliases) && data.aliases.length
    ? data.aliases.filter(Boolean)
    : (data?.alias ? [String(data.alias)] : []);
  const error = entry && entry.status === "error"
    ? entry.error
    : (data && !eType ? (data.message || "GİB mükellefiyeti doğrulanamadı.") : "");
  const pending = !!opts?.contactPending && !buyerNeedsLiveMukellefQuery(choice.tax);
  return {
    tax: choice.tax,
    docTax: choice.docTax,
    contactTax: choice.contactTax,
    mismatch: choice.mismatch,
    taxSource: choice.source,
    name: data?.name || "",
    source: data?.source || "",
    aliases,
    eType: pending ? null : eType,
    blocked: pending || !eType,
    error,
  };
}

const cache = new Map<string, GibEntry | LoadingSlot>();

export function clearGibMukellefCache(): void {
  cache.clear();
}

function cacheKey(companyId: string, tax: string): string {
  return `${companyId}|${tax || "empty"}`;
}

export function dropGibMukellef(companyId: string, taxId?: string | null): void {
  cache.delete(cacheKey(companyId, digitsTax(taxId)));
}

function localArchiveEntry(tax: string): GibEntry {
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

function attachFail(err: { message?: string; gibEntry?: GibEntry }, fallback: string): GibEntry {
  const fail: GibEntry = { status: "error", error: err?.message || fallback };
  err.gibEntry = fail;
  return fail;
}

/**
 * Aynı company+VKN için tek istek. Hata ve unknown önbelleğe yazılmaz.
 * Başarılı sonuç 120 sn tutulur. refresh backend önbelleğini de baypas eder.
 */
export function fetchGibMukellef(
  client: ApiClient,
  companyId: string,
  taxId?: string | null,
  options?: { refresh?: boolean },
): Promise<GibEntry> {
  const tax = digitsTax(taxId);
  const key = cacheKey(companyId, tax);
  const refresh = !!(options && options.refresh);
  if (!buyerNeedsLiveMukellefQuery(tax)) {
    if (!tax || isPlaceholderTaxId(tax)) {
      const entry = localArchiveEntry(tax);
      cache.set(key, entry);
      return Promise.resolve(entry);
    }
    const err = new Error("VKN/TCKN 10 veya 11 haneli olmalı") as Error & { gibEntry?: GibEntry };
    attachFail(err, "VKN/TCKN 10 veya 11 haneli olmalı");
    return Promise.reject(err);
  }
  if (!refresh) {
    const hit = cache.get(key);
    if (hit?.status === "ok") {
      if (!hit.expiresAt || hit.expiresAt > Date.now()) return Promise.resolve(hit);
      cache.delete(key);
    } else if (hit?.status === "loading") {
      return hit.promise;
    }
  }
  const token = {};
  const query: { tax_id: string; company_id: string; refresh?: number } = {
    tax_id: tax,
    company_id: companyId,
  };
  if (refresh) query.refresh = 1;
  const promise = get<GibMukellef>(client, "/gib/lookup", query)
    .then((data) => {
      const body = data || {};
      if (body.lookup_status === "unknown" || body.lookup_status === "error" || !eTypeFromGib(body)) {
        const err = new Error(body.message || "GİB mükellefiyeti doğrulanamadı.");
        throw err;
      }
      const entry: GibEntry = { status: "ok", data: body, expiresAt: Date.now() + GIB_MUKELLEF_TTL_MS };
      const cur = cache.get(key);
      if (!cur || cur.status !== "loading" || cur.token === token) cache.set(key, entry);
      return entry;
    })
    .catch((err: { message?: string; gibEntry?: GibEntry }) => {
      const cur = cache.get(key);
      if (cur && "token" in cur && cur.token === token) cache.delete(key);
      attachFail(err, "GİB sorgusu başarısız.");
      throw err;
    });
  cache.set(key, { status: "loading", promise, token });
  return promise;
}
