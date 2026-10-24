/** Fatura alıcı ünvanı. backend/buyer_tax.invoice_buyer_name ile aynı sıra. */

const PLACEHOLDER_TAX_IDS = new Set([
  "11111111111",
  "1111111111",
  "00000000000",
  "0000000000",
  "99999999999",
  "9999999999",
]);

const GIB_TITLE_KEYS = ["gib_title", "einvoice_title", "e_invoice_title", "taxpayer_title"];

export function taxDigits(value) {
  return String(value || "").replace(/\D/g, "");
}

export function isPlaceholderTaxId(value) {
  const d = taxDigits(value);
  if (!d) return false;
  if (PLACEHOLDER_TAX_IDS.has(d)) return true;
  if ((d.length === 10 || d.length === 11) && new Set(d).size === 1) return true;
  return false;
}

export function usableTax(value) {
  const d = taxDigits(value);
  if (!d || isPlaceholderTaxId(d)) return "";
  return d;
}

function text(value) {
  return String(value || "").trim();
}

function cardTax(contact) {
  if (!contact) return "";
  const keys = ["tax_number_or_id", "tax_id", "tax_number", "vkn", "tckn"];
  for (const key of keys) {
    const d = taxDigits(contact[key]);
    if (d) return d;
  }
  return "";
}

export function gibBuyerTitle(contact, explicit) {
  const given = text(explicit);
  if (given) return given;
  const card = contact || {};
  for (const key of GIB_TITLE_KEYS) {
    const title = text(card[key]);
    if (title) return title;
  }
  return "";
}

export function invoiceBuyerName(contact, { gibTitle, fallback = "", taxId } = {}) {
  const card = contact || {};
  const commercial = text(card.company_title);
  if (commercial) return commercial;
  if (usableTax(cardTax(card)) || usableTax(taxId)) {
    const official = gibBuyerTitle(card, gibTitle);
    if (official) return official;
  }
  const person = text(card.name);
  if (person) return person;
  return text(fallback);
}

export function previewBuyerLabel(invoice, contacts) {
  if (!invoice) return "";
  const id = invoice.contact_id;
  const list = Array.isArray(contacts) ? contacts : [];
  const card = id
    ? list.find((c) => String(c?.id || c?._id || "") === String(id)) || null
    : null;
  return invoiceBuyerName(card, {
    gibTitle: invoice.gib_title || invoice.einvoice_title || invoice.e_invoice_title || invoice.taxpayer_title,
    fallback: invoice.contact_name || "",
    taxId: invoice.contact_tax_id || invoice.buyer_tax_id,
  });
}
