/** Bağlı e-belge entegratörü — İşNet / n11 / portal etiketleri. */

export const EINVOICE_PROVIDER_LABELS = {
  isnet: "İşNet SOAP",
  isnet_portal: "İşNet Portal",
  n11faturam: "n11 Faturam",
  foriba: "Foriba",
  simulated: "Simülasyon",
};

export function einvoiceProviderLabel(provider) {
  const key = String(provider || "").trim().toLowerCase();
  return EINVOICE_PROVIDER_LABELS[key] || (key ? key : "Entegratör yok");
}

export function isEinvoiceConfigured(settings) {
  if (!settings || typeof settings !== "object") return false;
  const provider = String(settings.provider || "").trim().toLowerCase();
  if (!provider || provider === "simulated") return false;
  return String(settings.status || "").toLowerCase() === "configured";
}

export function supportsGibInbox(settings) {
  if (!isEinvoiceConfigured(settings)) return false;
  const p = String(settings.provider || "").toLowerCase();
  return p === "isnet" || p === "isnet_portal" || p === "n11faturam";
}

export function supportsEDispatch(settings) {
  if (!isEinvoiceConfigured(settings)) return false;
  const p = String(settings.provider || "").toLowerCase();
  // e-İrsaliye: İşNet SOAP WSDL SendDespatchAdvice*; portal/n11 sonraki adım
  return p === "isnet" || p === "isnet_portal";
}
