/** Bağlı e-belge entegratörü — İşNet / n11 / portal etiketleri. */

export const EINVOICE_PROVIDER_LABELS = {
  isnet: "İşNet SOAP",
  isnet_portal: "İşNet Portal",
  n11faturam: "n11 Faturam",
  qnb_efinans: "QNB eFinans",
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

/**
 * "GİB entegratörü bağlı değil" uyarısı.
 * İstek bitmeden (loading) hiçbir şey gösterme; bitince yalnızca gerçekten bağlı değilse.
 */
export function shouldShowEinvoiceUnconfiguredWarning({ loading = false, settings } = {}) {
  if (loading) return false;
  return !isEinvoiceConfigured(settings);
}

export function supportsGibInbox(settings) {
  if (!isEinvoiceConfigured(settings)) return false;
  const p = String(settings.provider || "").toLowerCase();
  return p === "isnet" || p === "isnet_portal" || p === "n11faturam";
}

export function supportsEDispatch(settings) {
  if (!isEinvoiceConfigured(settings)) return false;
  const p = String(settings.provider || "").toLowerCase();
  // e-İrsaliye: İşNet SOAP WSDL SendDespatchAdvice* (aynı IP–VKN bağlantısı)
  if (p !== "isnet" && p !== "isnet_portal") return false;
  if ("e_dispatch_enabled" in settings) return settings.e_dispatch_enabled !== false;
  return true;
}
