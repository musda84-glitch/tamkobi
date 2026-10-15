/** Sipariş e-belge türü: yalnız canlı GİB sonucu. Cari is_e_invoice_user kararda kullanılmaz. */

import { orderHasEInvoiceIssued } from "./orderMoreMenu";
import { eTypeFromGib } from "./gibMukellef";

export function contactIsEInvoiceUser(contact) {
  return !!contact?.is_e_invoice_user;
}

/** Sipariş + cariler listesinden mükellef bilgisini çöz. */
export function resolveOrderContact(ord, contacts = []) {
  if (!ord) return null;
  const cid = ord.contact_id;
  if (cid) {
    const hit = (contacts || []).find((c) => (c.id || c._id) === cid);
    if (hit) return hit;
  }
  if (ord.is_e_invoice_user != null || ord.contact_is_e_invoice_user != null) {
    return {
      id: cid,
      name: ord.contact_name || ord.customer_name,
      is_e_invoice_user: !!(ord.is_e_invoice_user ?? ord.contact_is_e_invoice_user),
    };
  }
  return null;
}

/**
 * GİB e-belge türü.
 * Canlı sorgu yoksa e-Arşiv (cari bayrağı e-Fatura sayılmaz).
 */
export function orderEBelgeType(ord, _contacts = [], gibLookup = null) {
  const lookup = gibLookup || ord?.gib_lookup || ord?.gibMeta || null;
  if (lookup && (lookup.status === "error" || lookup.lookup_status === "unknown")) return null;
  const data = lookup?.data || lookup;
  if (data && (data.lookup_status === "unknown" || data.lookup_status === "error")) return null;
  if (data && (data.suggested_e_type || typeof data.is_e_invoice_user === "boolean" || data.lookup_status)) {
    return eTypeFromGib(data);
  }
  return "e_archive";
}

export function orderCanIssueEFatura(ord, contacts = [], gibLookup = null) {
  return orderEBelgeType(ord, contacts, gibLookup) === "e_invoice";
}

/** Elektronik Fatura Onayı modal metni. */
export function efaturaOnayMessage(ord, contacts = []) {
  return orderCanIssueEFatura(ord, contacts)
    ? "Bu müşteri e-fatura mükellefidir, karşı tarafa e-fatura gönderilecek. Onaylıyor musunuz?"
    : "Bu müşteri e-fatura mükellefi değildir, e-arşiv faturası oluşturulacak. Onaylıyor musunuz?";
}

/** Taslak sipariş/fatura GİB e-Fatura / e-Arşiv kesmez; önce Faturalaştır. */
export function orderCanShowEBelgeMenu(ord) {
  return !!ord?.is_invoiced && !orderHasEInvoiceIssued(ord);
}

export function eBelgeMenuItems(ord, contacts = [], gibLookup = null) {
  if (!orderCanShowEBelgeMenu(ord)) return [];
  const type = orderEBelgeType(ord, contacts, gibLookup);
  if (type == null) return [];
  if (gibLookup && type === "e_invoice") {
    return [
      { eType: "e_invoice", label: "E-Fatura kes (GİB)", testIdSuffix: "efatura" },
      { eType: "e_archive", label: "E-Arşiv kes (GİB)", testIdSuffix: "earsiv" },
    ];
  }
  return [{ eType: "e_archive", label: "E-Arşiv kes (GİB)", testIdSuffix: "earsiv" }];
}
