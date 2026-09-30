/** GİB'e iletilmiş e-Fatura / e-Arşiv → yazdırma/PDF entegratörden. */

export function shouldUseIntegratorPdf(docType, doc) {
  if (docType !== "invoice" || !doc) return false;
  const et = doc.e_type || "";
  if (!["e_invoice", "e_archive", "e_export"].includes(et)) return false;
  if (doc.einvoice_state === "sent" || doc.einvoice_state === "queued") return true;
  if (doc.gib_uuid || doc.gib_tracking_id) return true;
  const gs = String(doc.gib_status || "");
  return /ileti|GİB'e|Gib'e|SOAP API|Web Portal|n11 Faturam/i.test(gs);
}
