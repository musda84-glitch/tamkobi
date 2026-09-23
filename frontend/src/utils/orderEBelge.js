/** Sipariş e-belge türü: cari GİB e-fatura mükellefi değilse (bilgi yoksa) e-arşiv. */

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
 * Mükellef bilgisi yoksa veya false ise → e_archive (kural).
 */
export function orderEBelgeType(ord, contacts = []) {
  const c = resolveOrderContact(ord, contacts);
  if (contactIsEInvoiceUser(c)) return "e_invoice";
  return "e_archive";
}

export function orderCanIssueEFatura(ord, contacts = []) {
  return orderEBelgeType(ord, contacts) === "e_invoice";
}

export function eBelgeMenuItems(ord, contacts = []) {
  const type = orderEBelgeType(ord, contacts);
  if (type === "e_invoice") {
    return [
      { eType: "e_invoice", label: "E-Fatura kes (GİB)", testIdSuffix: "efatura" },
      { eType: "e_archive", label: "E-Arşiv kes (GİB)", testIdSuffix: "earsiv" },
    ];
  }
  return [{ eType: "e_archive", label: "E-Arşiv kes (GİB)", testIdSuffix: "earsiv" }];
}
