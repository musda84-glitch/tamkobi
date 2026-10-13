export const ONBOARDING_STEPS = [
  { key: "company", label: "Firma bilgileri", hint: "Unvan, VKN, vergi dairesi ve adres" },
  { key: "logo", label: "Logo", hint: "Fatura ve evraklarda görünecek logo" },
  { key: "einvoice", label: "e-Fatura bağlantısı", hint: "Entegratör kullanıcı bilgileri" },
  { key: "contact", label: "İlk cari", hint: "Müşteri veya tedarikçi kartı" },
  { key: "product", label: "İlk ürün", hint: "Stok veya hizmet kartı" },
  { key: "invoice", label: "İlk fatura", hint: "Satış faturası (taslak olabilir)" },
];

export function firstRemainingIndex(status) {
  const remaining = status?.remaining || [];
  if (!remaining.length) return 0;
  const i = ONBOARDING_STEPS.findIndex((s) => remaining.includes(s.key));
  return i < 0 ? 0 : i;
}

export function progressLabel(percent) {
  const n = Math.max(0, Math.min(100, Number(percent) || 0));
  return `%${n} tamamlandı`;
}

export function shouldShowWizard(status, { authenticated, pathname } = {}) {
  if (!authenticated || !status?.show_wizard) return false;
  const p = pathname || "/";
  if (p === "/login" || p.startsWith("/login")) return false;
  if (p === "/kurulum" || p.startsWith("/sistem") || p.startsWith("/b2b") || p.startsWith("/portal")) return false;
  if (p.startsWith("/web") || p.startsWith("/kayit") || p.startsWith("/yasal")) return false;
  return true;
}

export function invoiceLineTotals({ quantity, unit_price, vat_rate }) {
  const qty = Number(quantity) || 0;
  const price = Number(unit_price) || 0;
  const vat = Number(vat_rate) || 0;
  const total = Math.round(qty * price * 100) / 100;
  const vat_amount = Math.round(total * (vat / 100) * 100) / 100;
  return { total, vat_amount, total_incl: Math.round((total + vat_amount) * 100) / 100 };
}
