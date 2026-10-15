/** Tekil iptal onay metni — web invoiceCancelConfirmText ile aynı uyarı. */
export function invoiceCancelConfirmText(inv: {
  invoice_number?: string;
  invoice_type?: string;
  e_type?: string;
} | null | undefined, gibIssued = false): string {
  const isDisp = Boolean(inv && (inv.invoice_type === "dispatch" || inv.e_type === "e_dispatch"));
  if (isDisp) {
    return `${inv?.invoice_number || "İrsaliye"} numaralı e-irsaliye iptal edilsin mi?\nKayıt iptal edilir; bağlı sipariş irsaliye bağı kopar. İptal geri alınamaz.`;
  }
  const lines = [
    "1 fatura iptal edilecek. İptal geri alınamaz.",
    "Cari bakiyesi ve stok etkileri geri alınır.",
    "Bu işlem GİB/İşNet'teki e-belgeyi İPTAL ETMEZ; GİB'e gönderilmiş belgeleri ayrıca GİB/İşNet portalından iptal etmelisiniz.",
  ];
  if (gibIssued) lines.push("1 tanesi GİB'e gönderilmiş.");
  return lines.join("\n");
}
