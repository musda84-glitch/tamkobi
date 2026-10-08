/** Yazdırma SAYIN bloğu için alıcı adres satırı. */

function _clean(v) {
  const s = String(v ?? "").trim();
  if (!s || s === "-") return "";
  return s;
}

/**
 * Fatura/sipariş + cari kaydından adres metni.
 * Öncelik: belgedeki teslimat/fatura adresi → cari address → ilçe/şehir.
 */
export function resolvePrintPartyAddress(doc = {}, contact = null) {
  const fromDoc = _clean(
    doc.shipping_address
    || doc.billing_address
    || doc.address
    || doc.contact_address
    || doc.customer_address,
  );
  if (fromDoc) return fromDoc;
  if (!contact) return "";
  const street = _clean(contact.address || contact.billing_address);
  const district = _clean(contact.district || contact.ilce);
  const city = _clean(contact.city);
  if (street) return street;
  return [district, city].filter(Boolean).join(" / ");
}

export function resolvePrintPartyCity(doc = {}, contact = null, addressText = "") {
  const city = _clean(doc.city || contact?.city);
  if (!city) return "";
  const addr = String(addressText || "").toLocaleLowerCase("tr-TR");
  if (addr.includes(city.toLocaleLowerCase("tr-TR"))) return "";
  return city;
}

export function resolvePrintPartyPhone(doc = {}, contact = null) {
  return _clean(
    doc.customer_phone
    || doc.contact_phone
    || contact?.phone
    || contact?.mobile
    || "",
  );
}
