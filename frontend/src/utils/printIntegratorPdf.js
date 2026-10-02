/** GİB e-Fatura / e-Arşiv (giden veya gelen) → yazdırma/PDF entegratörden. */

export function shouldUseIntegratorPdf(docType, doc) {
  if (docType !== "invoice" || !doc) return false;
  const et = doc.e_type || "";
  if (!["e_invoice", "e_archive", "e_export"].includes(et)) return false;
  if (doc.status === "draft" || doc.status === "cancelled") return false;
  const gs = String(doc.gib_status || "");
  // Hata: ... iletildi — şablon/yerel PDF, entegratör belgesi yok
  if (doc.einvoice_state === "error" || /^\s*hata\s*:/i.test(gs)) return false;
  if (doc.einvoice_state === "sent" || doc.einvoice_state === "queued") return true;
  if (doc.gib_uuid || doc.gib_tracking_id) return true;
  // Gelen alış: GİB'den geldi — resmi PDF entegratörden (Incoming)
  if (
    doc.direction === "incoming"
    || doc.source === "edoc_inbox"
    || doc.edoc_id
    || /gelen|received/i.test(gs)
  ) {
    return true;
  }
  return /ileti|GİB'e|Gib'e|SOAP API|Web Portal|n11 Faturam/i.test(gs);
}

export function integratorPdfKindLabel(doc) {
  if (!doc) return "e-Belge";
  if (doc.e_type === "e_invoice") return "e-Fatura";
  if (doc.e_type === "e_export") return "e-İhracat";
  return "e-Arşiv";
}
