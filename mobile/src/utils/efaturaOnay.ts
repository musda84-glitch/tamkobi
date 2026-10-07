/** Mobil Elektronik Fatura Onayı yardımcıları (web orderEBelge + exemption + iade). */

export function efaturaOnayMessage(isEInvoiceUser: boolean): string {
  return isEInvoiceUser
    ? "Bu müşteri e-fatura mükellefidir, karşı tarafa e-fatura gönderilecek. Onaylıyor musunuz?"
    : "Bu müşteri e-fatura mükellefi değildir, e-arşiv faturası oluşturulacak. Onaylıyor musunuz?";
}

export const TAX_EXEMPTION_OPTIONS = [
  { value: "351", label: "351 – İstisna olmayan diğer" },
  { value: "350", label: "350 – Diğer istisnalar" },
  { value: "301", label: "301 – 11/1-a Mal ihracatı" },
  { value: "302", label: "302 – 11/1-a Hizmet ihracatı" },
  { value: "308", label: "308 – 13/ı Külçe altın / kıymetli maden" },
  { value: "309", label: "309 – 13/e Konut teslimi" },
  { value: "318", label: "318 – 17/1 Kültür / eğitim" },
  { value: "337", label: "337 – 17/4-g Serbest bölgeler" },
] as const;

export const TAX_EXEMPTION_LABELS: Record<string, string> = Object.fromEntries(
  TAX_EXEMPTION_OPTIONS.map((o) => [o.value, o.label]),
);

export function invoiceNeedsExemptionPrompt(inv?: {
  tax_exemption_code?: string | null;
  vat_exemption_code?: string | null;
  items?: Array<{ vat_rate?: number; vat_exemption_code?: string; tax_exemption_code?: string }> | null;
} | null): boolean {
  if (!inv) return false;
  if (String(inv.tax_exemption_code || inv.vat_exemption_code || "").trim()) return false;
  const items = Array.isArray(inv.items) ? inv.items : [];
  return items.some((it) => {
    if (Number(it?.vat_rate ?? 20) !== 0) return false;
    return !String(it?.vat_exemption_code || it?.tax_exemption_code || "").trim();
  });
}

export function invoiceNeedsWithholdingPrompt(inv?: {
  trade_kind?: string | null;
  e_type?: string | null;
  withholding_rate?: number | null;
  withholding_code?: string | null;
  items?: Array<{ vat_rate?: number }> | null;
} | null): boolean {
  if (!inv) return false;
  const trade = String(inv.trade_kind || "").toLowerCase();
  const eType = String(inv.e_type || "").toLowerCase();
  if (trade === "export" || eType === "e_export") return false;
  if (Number(inv.withholding_rate || 0) > 0 || String(inv.withholding_code || "").trim()) return false;
  const items = Array.isArray(inv.items) ? inv.items : [];
  return items.some((it) => Number(it?.vat_rate ?? 20) === 0);
}

export function isReturnInvoiceDoc(doc?: { invoice_type?: string | null } | null): boolean {
  const invTypeNorm = String(doc?.invoice_type || "")
    .replace(/İ/g, "I")
    .replace(/I/g, "i")
    .replace(/ı/g, "i")
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "");
  return (
    ["return", "sales_return", "purchase_return", "iade"].includes(invTypeNorm)
    || invTypeNorm.includes("return")
    || invTypeNorm.includes("iade")
  );
}

export function prefillReturnBillingRef(doc?: {
  original_invoice_number?: string | null;
  return_of_invoice_number?: string | null;
  billing_reference_id?: string | null;
  referenced_invoice_number?: string | null;
  original_issue_date?: string | null;
  return_of_issue_date?: string | null;
  billing_reference_date?: string | null;
  notes?: string | null;
} | null): { number: string; date: string } {
  const number = String(
    doc?.original_invoice_number
      || doc?.return_of_invoice_number
      || doc?.billing_reference_id
      || doc?.referenced_invoice_number
      || "",
  ).trim();
  let date = String(
    doc?.original_issue_date || doc?.return_of_issue_date || doc?.billing_reference_date || "",
  ).trim().slice(0, 10);
  const notes = String(doc?.notes || "");
  let num = number;
  if (!num) {
    const m =
      notes.match(/([A-Z]{2,3}\d{10,16})\s*numaral[ıi]/i)
      || notes.match(/[←<]\s*([A-Z]{2,3}\d{10,16})/i)
      || notes.match(/\b([A-Z]{2,3}\d{13,16})\b/i);
    if (m) num = m[1].toUpperCase();
  }
  if (!date) {
    const m2 = notes.match(/(\d{2})[./](\d{2})[./](\d{4})\s*tarihli/);
    if (m2) date = `${m2[3]}-${m2[2]}-${m2[1]}`;
  }
  return { number: num, date };
}

export function buildIadeNote(number: string, dateYmd: string): string {
  const no = String(number || "").trim().toUpperCase();
  const ymd = String(dateYmd || "").slice(0, 10);
  let trDate = ymd;
  if (/^\d{4}-\d{2}-\d{2}$/.test(ymd)) {
    const [y, m, d] = ymd.split("-");
    trDate = `${d}.${m}.${y}`;
  }
  return `${trDate} tarihli ${no} numaralı faturaya istinaden düzenlenen iade faturasıdır.`;
}

export function parseWithholdingValue(value?: string | null): { withholding_rate: number; withholding_code: string } {
  if (!value) return { withholding_rate: 0, withholding_code: "" };
  const [r, c] = String(value).split("|");
  return { withholding_rate: Number(r || 0), withholding_code: c || "" };
}

export type EfaturaOnayPayload = {
  eType: "e_invoice" | "e_archive";
  scenario?: "TEMEL" | "TICARI";
  stampNow?: boolean;
  alias?: string;
  withholding?: { withholding_rate: number; withholding_code: string };
  exemption?: { tax_exemption_code: string; tax_exemption_reason: string };
  returnRef?: {
    original_invoice_number: string;
    original_issue_date: string;
    notes: string;
  };
};

export function digitsTax(raw?: string | null): string {
  return String(raw || "").replace(/\D/g, "");
}
