import { contactTypeTr, paymentMethodTr, riskStatusTr } from "./labels";
import { fmtMoney } from "./money";

export type InfoRow = { key: string; label: string; value: string };

const SECRET_OR_INTERNAL = new Set([
  "id",
  "_id",
  "company_id",
  "user_id",
  "name",
  "type",
  "balance",
  "b2b_token",
  "b2b_password",
  "b2b_password_hash",
  "has_b2b_password",
  "legal_accept",
  "created_at",
  "updated_at",
  "latitude",
  "longitude",
  "location_url",
  "source",
  // Kartın üstünde rozet olarak gösteriliyor.
  "is_e_invoice_user",
]);

/**
 * Web cari kartındaki alan sırası.
 * e-Belge durumu kartın üstünde rozet olarak duruyor; TRY para birimi de bilgi taşımıyor, ikisi listeye girmez.
 */
export const CONTACT_FIELD_DEFS: { key: string; label: string; kind?: "money" | "bool" | "percent" | "days" | "pay" | "risk" | "tags" | "einv" | "currency" }[] = [
  { key: "company_title", label: "Ticari ünvan" },
  { key: "category", label: "Kategori" },
  { key: "contact_person", label: "Yetkili kişi" },
  { key: "contact_person_phone", label: "Yetkili telefon" },
  { key: "phone", label: "Telefon" },
  { key: "email", label: "E-posta" },
  { key: "website", label: "Web sitesi" },
  { key: "sales_rep", label: "Satış temsilcisi" },
  { key: "tax_number_or_id", label: "VKN / TCKN" },
  { key: "tax_office", label: "Vergi dairesi" },
  { key: "currency", label: "Para birimi", kind: "currency" },
  { key: "payment_method", label: "Ödeme şekli", kind: "pay" },
  { key: "address", label: "Adres" },
  { key: "district", label: "İlçe" },
  { key: "city", label: "İl" },
  { key: "credit_limit", label: "Kredi limiti", kind: "money" },
  { key: "payment_term_days", label: "Vade", kind: "days" },
  { key: "late_fee_rate", label: "Gecikme faizi", kind: "percent" },
  { key: "default_discount", label: "Varsayılan iskonto", kind: "percent" },
  { key: "risk_status", label: "Risk", kind: "risk" },
  { key: "bank_name", label: "Banka" },
  { key: "iban", label: "IBAN" },
  { key: "cheque_bond_balance", label: "Çek / senet", kind: "money" },
  { key: "b2b_enabled", label: "B2B portal", kind: "bool" },
  { key: "b2b_discount", label: "B2B iskonto", kind: "percent" },
  { key: "b2b_login_email", label: "B2B giriş e-posta" },
  { key: "sms_opt_in", label: "SMS bildirimi", kind: "bool" },
  { key: "email_opt_in", label: "E-posta bildirimi", kind: "bool" },
  { key: "kvkk_accepted", label: "KVKK onayı", kind: "bool" },
  { key: "tags", label: "Etiketler", kind: "tags" },
  { key: "notes", label: "Notlar" },
];

/** İçe aktarma / entegrasyon artıkları: import_batch_id, bizimhesap_id, opening_balance_source… */
const TECHNICAL_KEY = /(^|_)(id|uuid|guid|token|hash|batch|checksum)$|^(import|sync|external|integration|migration|legacy)_|_(source|version|revision)$/i;
const TECHNICAL_VALUE = /^[0-9a-f]{8}-?[0-9a-f]{4}-?[0-9a-f]{4}-?[0-9a-f]{4}-?[0-9a-f]{12}$|^[0-9a-f]{24,}$/i;

export function isTechnicalField(key: string, value: unknown): boolean {
  if (TECHNICAL_KEY.test(key)) return true;
  return typeof value === "string" && TECHNICAL_VALUE.test(value.trim());
}

function isEmpty(value: unknown): boolean {
  if (value == null) return true;
  if (typeof value === "string" && value.trim() === "") return true;
  if (Array.isArray(value) && value.length === 0) return true;
  return false;
}

export function formatContactField(kind: string | undefined, value: unknown): string | null {
  if (kind === "bool") return value ? "Evet" : "Hayır";
  if (kind === "einv") return value ? "e-Fatura mükellefi" : "e-Arşiv / kağıt";
  if (kind === "money") {
    const n = Number(value);
    if (!Number.isFinite(n) || n === 0) return null;
    return fmtMoney(n);
  }
  if (kind === "percent") {
    const n = Number(value);
    if (!Number.isFinite(n) || n === 0) return null;
    return `%${n}`;
  }
  if (kind === "days") {
    const n = Number(value);
    if (!Number.isFinite(n) || n === 0) return null;
    return `${n} gün`;
  }
  if (kind === "currency") {
    const code = String(value || "").trim().toUpperCase();
    return !code || code === "TRY" ? null : code;
  }
  if (kind === "pay") return value ? paymentMethodTr(String(value)) : null;
  if (kind === "risk") {
    if (!value || value === "normal") return null;
    return riskStatusTr(String(value));
  }
  if (kind === "tags") {
    const tags = Array.isArray(value) ? value : String(value).split(",").map((t) => t.trim()).filter(Boolean);
    return tags.length ? tags.join(", ") : null;
  }
  if (typeof value === "number") {
    if (!Number.isFinite(value) || value === 0) return null;
    return String(value);
  }
  if (typeof value === "boolean") return value ? "Evet" : "Hayır";
  const text = String(value).trim();
  return text || null;
}

export function contactInfoRows(contact: Record<string, unknown> | null | undefined): InfoRow[] {
  if (!contact) return [];
  const rows: InfoRow[] = [];
  const seen = new Set<string>();
  for (const def of CONTACT_FIELD_DEFS) {
    seen.add(def.key);
    const raw = contact[def.key];
    if (def.kind === "bool" || def.kind === "einv") {
      if (raw === undefined || raw === null) continue;
      if (def.kind === "bool" && !raw && def.key !== "sms_opt_in" && def.key !== "email_opt_in") continue;
    } else if (isEmpty(raw)) {
      continue;
    }
    const value = formatContactField(def.kind, raw);
    if (!value) continue;
    rows.push({ key: def.key, label: def.label, value });
  }
  for (const [key, raw] of Object.entries(contact)) {
    if (seen.has(key) || SECRET_OR_INTERNAL.has(key)) continue;
    if (typeof raw === "object" && raw !== null && !Array.isArray(raw)) continue;
    if (isEmpty(raw)) continue;
    if (isTechnicalField(key, raw)) continue;
    const value = formatContactField(undefined, raw);
    if (!value) continue;
    rows.push({ key, label: key, value });
  }
  return rows;
}

export function contactTypeLabel(type?: string | null): string {
  return contactTypeTr(type || "customer");
}

export function balanceHint(balance: unknown): { label: string; tone: "green" | "red" | "slate" } {
  const n = Number(balance) || 0;
  if (n > 0) return { label: "Alacaklı — müşteri size borçlu", tone: "green" };
  if (n < 0) return { label: "Borçlu — siz bu cariye borçlusunuz", tone: "red" };
  return { label: "Hesap denk", tone: "slate" };
}

/** Cari listesi / kart yan etiketi. */
export function contactBalanceLabel(balance: unknown): { label: string; tone: "green" | "red" | "slate" } {
  const n = Number(balance) || 0;
  if (n > 0) return { label: "Alacak", tone: "green" };
  if (n < 0) return { label: "Borç", tone: "red" };
  return { label: "Cari bakiye", tone: "slate" };
}

export type ContactBalanceFlag = {
  overdue_amount?: unknown;
  installment_due_amount?: unknown;
};

export type InvoiceBalanceRow = {
  contact_id?: string;
  invoice_type?: string;
  status?: string;
  grand_total?: unknown;
  paid_amount?: unknown;
};

/** İlk sonlu, sıfır olmayan tutarı alır; hepsi 0/boşsa 0. */
export function firstFiniteNonZero(...values: unknown[]): number {
  let fallback = 0;
  let hasFallback = false;
  for (const value of values) {
    if (value == null || value === "") continue;
    const n = Number(value);
    if (!Number.isFinite(n)) continue;
    if (n !== 0) return n;
    if (!hasFallback) {
      fallback = n;
      hasFallback = true;
    }
  }
  return hasFallback ? fallback : 0;
}

/** Satış faturalarının cari bazında kalan alacağı (taslak/iptal hariç). */
export function invoiceOpenByContact(invoices: InvoiceBalanceRow[] | null | undefined): Record<string, number> {
  const out: Record<string, number> = {};
  for (const inv of invoices || []) {
    const id = String(inv.contact_id || "");
    if (!id) continue;
    if (inv.status === "draft" || inv.status === "cancelled") continue;
    if ((inv.invoice_type || "sales") !== "sales") continue;
    const remaining = (Number(inv.grand_total) || 0) - (Number(inv.paid_amount) || 0);
    if (!Number.isFinite(remaining) || remaining === 0) continue;
    out[id] = (out[id] || 0) + remaining;
  }
  return out;
}

/** Liste / kart bakiyesi. Stored 0 ise fatura kalanı veya gecikmiş tutarı kullan. */
export function contactDisplayBalance(
  contact?: { balance?: unknown; open_amount?: unknown } | null,
  summary?: { open_amount?: unknown } | null,
  flags?: ContactBalanceFlag | null,
): number {
  return firstFiniteNonZero(
    contact?.balance,
    summary?.open_amount,
    contact?.open_amount,
    flags?.overdue_amount,
    flags?.installment_due_amount,
  );
}

export function contactTabSelectGroups(
  tabs: { key: string; label: string }[],
  counts: Record<string, number> = {},
) {
  return [{
    label: "Kayıtlar",
    options: (tabs || []).map((t) => ({
      value: t.key,
      label: counts[t.key] ? `${t.label} (${counts[t.key]})` : t.label,
    })),
  }];
}

/** Düzenle stays in Diğerleri; that tile takes the first slot on the card. */
export function contactCardVisibleActions<T extends { key: string }>(tiles: T[], moreOpen: boolean): { showMore: boolean; shown: T[] } {
  const extra = tiles.filter((t) => t.key === "edit");
  const front = tiles.filter((t) => t.key !== "edit");
  const showMore = extra.length > 0 || front.length > 4;
  if (!showMore) return { showMore: false, shown: front };
  return { showMore: true, shown: moreOpen ? [...front, ...extra] : front.slice(0, 3) };
}

export function contactSummaryRows(summary: Record<string, unknown> | null | undefined): InfoRow[] {
  if (!summary) return [];
  const n = (k: string) => Number(summary[k]) || 0;
  const rows: InfoRow[] = [
    { key: "invoice_count", label: "Fatura", value: String(n("invoice_count")) },
    { key: "draft_count", label: "Taslak", value: String(n("draft_count")) },
    { key: "order_count", label: "Sipariş", value: String(n("order_count")) },
    { key: "overdue_count", label: "Gecikmiş fatura", value: String(n("overdue_count")) },
    { key: "total_invoiced", label: "Satış faturaları", value: fmtMoney(n("total_invoiced")) },
    { key: "total_paid", label: "Tahsil edilen", value: fmtMoney(n("total_paid")) },
    { key: "open_amount", label: "Kalan alacak", value: fmtMoney(n("open_amount")) },
  ];
  return rows.filter((r) => r.value !== "0" && r.value !== fmtMoney(0));
}
