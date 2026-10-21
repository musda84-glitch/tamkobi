import type { Contact, Invoice } from "../types";
import type { BankAccount, BankTx, ExpenseCategory, Partner } from "./finance";
import { paymentTargetGroups } from "./finance";
import { fmtMoney, idOf } from "./money";
import {
  POS_COMMISSION_CATEGORY,
  calcCommission,
  isPosAccount,
  round2,
  validatePosSettlement,
} from "./posSettlement";

export { POS_COMMISSION_CATEGORY, isPosAccount };

export const MATCH_MODES = [
  { key: "contact", label: "Cari" },
  { key: "transfer", label: "Kasa / Hesap (Virman)" },
  { key: "category", label: "Sadece Kategori" },
  { key: "expense", label: "Masraf" },
  { key: "pos_settlement", label: "POS bloke çözümü" },
] as const;

/** Varsayılan personel masraf kategorisi (API değeri; UI etiketi "Personel"). */
export const PERSONNEL_EXPENSE_CATEGORY = "Personel Masrafı";

/** Personel seçilince ödeme türleri. Varsayılan: masraf iadesi. */
export const PERSONNEL_PAY_KINDS = [
  { key: "reimburse", label: "Masraf iadesi" },
  { key: "advance", label: "Avans" },
  { key: "salary", label: "Maaş" },
  { key: "overtime", label: "Mesai" },
  { key: "expense", label: "Şirket masrafı (personel adına)" },
] as const;

export const DEFAULT_PERSONNEL_PAY_KIND = "reimburse";

export type PersonnelPayKind = (typeof PERSONNEL_PAY_KINDS)[number]["key"];

/** Eşleşme türleri. POS bloke çözümü yalnızca giriş (inflow) hareketinde döner. */
export function matchModesForTx(tx?: { type?: string } | null) {
  if (tx?.type === "inflow") return MATCH_MODES;
  return MATCH_MODES.filter((mode) => mode.key !== "pos_settlement");
}

export type MatchMode = (typeof MATCH_MODES)[number]["key"];

export type BankMatchTx = BankTx;

export type BankConnection = {
  id?: string;
  _id?: string;
  provider?: string;
  provider_name?: string;
  linked_account_id?: string;
  linked_account_name?: string;
  status?: string;
  mode?: string;
  last_synced_at?: string;
  synced_count?: number;
  last_error?: string;
  auto_sync?: boolean;
  auto_match?: boolean;
  auto_matched_count?: number;
};

export type MatchRule = {
  id?: string;
  _id?: string;
  pattern?: string;
  contact_id?: string;
  contact_name?: string;
  category?: string;
  target_account_id?: string;
  target_account_name?: string;
  hits?: number;
};

export type MatchSuggestion = {
  pattern?: string;
  count?: number;
  contact_id?: string;
  contact_name?: string;
  category?: string;
  target_account_id?: string;
  target_account_name?: string;
  consistent?: boolean;
};

export type MatchDraft = {
  mode: MatchMode;
  contact_id: string;
  invoice_id: string;
  target_account_id: string;
  category: string;
  employee_id: string;
  personnel_pay_kind: PersonnelPayKind;
  expense_id?: string;
  learn: boolean;
  pos_gross: string;
  pos_commission: string;
};

export type SelectGroup = { label: string; options: { value: string; label: string; disabled?: boolean }[] };

/** Masraf kategorisi personel ödemesi mi? */
export function isPersonnelExpenseCategory(category?: string | null): boolean {
  const n = String(category || "").trim();
  return /^personel(\s+masraf[ıi])?$/i.test(n) || /personel/i.test(n);
}

/** Sadece Kategori + personel kategorisi: ödeme için Masraf modu gerekir. */
export function personnelCategoryOnly(d: { mode?: string | null; category?: string | null }): boolean {
  return d.mode === "category" && isPersonnelExpenseCategory(d.category);
}

/** Kategori select etiketi — Personel Masrafı → Personel. */
export function expenseCategoryOptionLabel(name?: string | null): string {
  const n = String(name || "").trim();
  if (/^personel(\s+masraf[ıi])?$/i.test(n)) return "Personel";
  return n;
}

/** Kayıtlı veya yazılan tutarı eşleşme taslağındaki metin alana çevirir. */
export function formatPosAmount(value: unknown): string {
  if (value == null || value === "") return "";
  const n = round2(value);
  return Number.isFinite(n) ? String(n) : "";
}

/** Brüt, bankaya yatan net ile başlar. Öneri oranı ve suggested_pos_gross yazılmaz. */
export function posAmountsFromNet(amount: unknown): { pos_gross: string; pos_commission: string } {
  const net = round2(amount);
  if (!Number.isFinite(net)) return { pos_gross: "", pos_commission: "" };
  return { pos_gross: String(net), pos_commission: String(calcCommission(net, net)) };
}

export function isPosInflowSuggestion(tx?: { type?: string | null; suggested_match_kind?: string | null } | null): boolean {
  return tx?.type === "inflow" && tx?.suggested_match_kind === "pos_settlement";
}

/** Önerilen POS hesabı ve kategori. Komisyon oranı burada uygulanmaz. */
export function draftForPosSettlement(tx: BankMatchTx, prev: MatchDraft): MatchDraft {
  const amounts = posAmountsFromNet(tx.amount);
  return {
    ...prev,
    mode: "pos_settlement",
    contact_id: "",
    invoice_id: "",
    target_account_id: tx.suggested_target_account_id || "",
    category: String(tx.suggested_category || "").trim() || POS_COMMISSION_CATEGORY,
    employee_id: "",
    personnel_pay_kind: DEFAULT_PERSONNEL_PAY_KIND,
    expense_id: "",
    pos_gross: amounts.pos_gross,
    pos_commission: amounts.pos_commission,
  };
}

export function emptyMatchDraft(tx?: BankMatchTx | null): MatchDraft {
  const draft: MatchDraft = {
    mode: "contact",
    contact_id: tx?.suggested_contact_id || "",
    invoice_id: "",
    target_account_id: "",
    category: "",
    employee_id: "",
    personnel_pay_kind: DEFAULT_PERSONNEL_PAY_KIND,
    expense_id: "",
    learn: true,
    pos_gross: "",
    pos_commission: "",
  };
  if (isPosInflowSuggestion(tx)) return draftForPosSettlement(tx as BankMatchTx, draft);
  return draft;
}

export function invoiceRemaining(inv?: Invoice | null): number {
  return (Number(inv?.grand_total) || 0) - (Number(inv?.paid_amount) || 0);
}

export function openInvoices(invoices: Invoice[], contactId: string, tx: BankMatchTx): Invoice[] {
  if (!contactId) return [];
  const want = tx.type === "inflow" ? "sales" : "purchase";
  const amount = Number(tx.amount) || 0;
  return (invoices || [])
    .filter((i) =>
      i.contact_id === contactId
      && i.payment_status !== "paid"
      && i.status !== "draft"
      && i.invoice_type === want
    )
    .sort((a, b) => Math.abs(invoiceRemaining(a) - amount) - Math.abs(invoiceRemaining(b) - amount));
}

export function matchTargets(accounts: BankAccount[], tx: BankMatchTx): BankAccount[] {
  const src = tx.account_id || "";
  return (accounts || []).filter((a) => idOf(a) !== src && !a.is_integrated);
}

export function canSubmitMatch(
  d: MatchDraft,
  tx?: { type?: string | null; amount?: number | string | null } | null,
  posBalance?: number | string | null,
): boolean {
  if (personnelCategoryOnly(d)) return false;
  if (d.mode === "pos_settlement") {
    if (!d.target_account_id) return false;
    if (!d.category.trim()) return false;
    return validatePosSettlement({
      gross: d.pos_gross,
      net: tx?.amount,
      commission: d.pos_commission,
      posBalance,
      isInflow: tx?.type === "inflow",
    }).length === 0;
  }
  if (d.mode === "category") return !!d.category.trim();
  if (d.mode === "expense") {
    if (!d.category.trim()) return false;
    if (isPersonnelExpenseCategory(d.category)) {
      return !!d.employee_id && !!d.personnel_pay_kind;
    }
    return true;
  }
  if (d.mode === "transfer") return !!d.target_account_id;
  return true;
}

export function matchPayload(d: MatchDraft) {
  if (d.mode === "pos_settlement") {
    return {
      mode: "pos_settlement" as const,
      target_account_id: d.target_account_id,
      pos_gross: round2(d.pos_gross),
      pos_commission: round2(d.pos_commission),
      category: d.category.trim() || POS_COMMISSION_CATEGORY,
      learn: !!d.learn,
    };
  }
  const personnel = d.mode === "expense" && isPersonnelExpenseCategory(d.category);
  return {
    learn: !!d.learn,
    category: d.mode === "category" || d.mode === "expense" ? (d.category.trim() || null) : null,
    contact_id: d.mode === "contact" ? d.contact_id || null : null,
    invoice_id: null as string | null,
    target_account_id: d.mode === "transfer" ? d.target_account_id || null : null,
    as_expense: d.mode === "expense",
    employee_id: personnel ? d.employee_id || null : null,
    personnel_pay_kind: personnel ? d.personnel_pay_kind || DEFAULT_PERSONNEL_PAY_KIND : null,
    expense_id: personnel && d.personnel_pay_kind === "reimburse" && d.expense_id ? d.expense_id : null,
  };
}

export const CONN_STATUS_TR: Record<string, string> = {
  connected: "Canlı bağlı",
  simulated: "Simüle",
  error: "Hata",
  disconnected: "Bağlı değil",
};

export const MATCHED_VIA_TR: Record<string, string> = {
  auto: "Otomatik",
  rule: "Kural",
  suggestion: "Öneri",
  manual: "Manuel",
};

export function connStatusTr(status?: string | null): string {
  if (!status) return "—";
  return CONN_STATUS_TR[status] || status;
}

export function connStatusTone(status?: string | null): "green" | "amber" | "red" | "slate" {
  if (status === "connected") return "green";
  if (status === "simulated") return "amber";
  if (status === "error") return "red";
  return "slate";
}

export function matchedViaTr(via?: string | null): string {
  if (!via) return "Manuel";
  return MATCHED_VIA_TR[via] || "Manuel";
}

export function matchResultLabel(tx: BankMatchTx): string {
  if (tx.match_kind === "pos_settlement") {
    return [tx.target_account_name, tx.category].filter(Boolean).join(" · ") || "POS bloke";
  }
  const parts = [
    tx.contact_name,
    tx.target_account_name ? `${tx.target_account_name} (virman)` : null,
    tx.related_invoice_number,
    tx.category,
  ].filter(Boolean);
  return parts.join(" · ") || "Eşleşti";
}

export function suggestionLabel(sg: MatchSuggestion): string {
  return [
    sg.contact_name,
    sg.target_account_name ? `${sg.target_account_name} (virman)` : null,
    sg.category,
  ].filter(Boolean).join(" · ") || "—";
}

export function ruleLabel(rule: MatchRule): string {
  const dest = [rule.contact_name, rule.target_account_name ? `${rule.target_account_name} (virman)` : null, rule.category]
    .filter(Boolean)
    .join(" · ") || "—";
  return `"${rule.pattern || ""}" → ${dest}`;
}

export function contactSelectGroups(contacts: Contact[], suggestedId?: string | null): SelectGroup[] {
  const options = (contacts || []).map((c) => ({
    value: idOf(c),
    label: suggestedId && idOf(c) === suggestedId ? `${c.name} ★` : (c.name || "Cari"),
  }));
  return options.length ? [{ label: "Cariler", options }] : [];
}

export function invoiceSelectGroups(invoices: Invoice[]): SelectGroup[] {
  const options = (invoices || []).map((i) => ({
    value: idOf(i),
    label: `${i.invoice_number || "Fatura"} · kalan ${fmtMoney(invoiceRemaining(i))}`,
  }));
  return [{ label: "Açık faturalar", options }];
}

/** Web PaymentTargetSelect: Türkçe hesap türü + banka adı · maskeli hesap · entegre. */
export function transferSelectGroups(accounts: BankAccount[], partners: Partner[] = []): SelectGroup[] {
  return paymentTargetGroups(accounts, partners);
}

/** POS bloke çözümü hesabı: yalnız pos / okc_pos, etikette bloke bakiyesi. */
export function posAccountGroups(accounts: BankAccount[] = []): SelectGroup[] {
  const options = (accounts || []).filter((account) => isPosAccount(account)).map((account) => ({
    value: idOf(account),
    label: `${account.account_name || "POS"} — bloke bakiye ${fmtMoney(account.current_balance)}`,
  }));
  return options.length ? [{ label: "POS hesapları", options }] : [];
}

/** Komisyon masraf kategorisi. Listede yoksa POS Komisyonu başa eklenir. */
export function posCategoryGroups(rows: ExpenseCategory[] = []): SelectGroup[] {
  const names = (rows || []).map((c) => String(c.name || c).trim()).filter(Boolean);
  if (!names.includes(POS_COMMISSION_CATEGORY)) names.unshift(POS_COMMISSION_CATEGORY);
  const options = names.map((name) => ({ value: name, label: name }));
  return [{ label: "Kategoriler", options }];
}

/** Masraf kategorileri — Personel Masrafı etiketi Personel. */
export function matchExpenseCategoryGroups(rows: ExpenseCategory[] = []): SelectGroup[] {
  const names = (rows || []).map((c) => String(c.name || c).trim()).filter(Boolean);
  const options = names.map((name) => ({ value: name, label: expenseCategoryOptionLabel(name) }));
  return options.length ? [{ label: "Kategoriler", options }] : [];
}

export function employeeSelectGroups(
  employees: { id?: string; _id?: string; full_name?: string; name?: string; is_active?: boolean }[] = [],
): SelectGroup[] {
  const active = (employees || []).filter((e) => e.is_active !== false);
  const options = active.map((e) => ({
    value: idOf(e),
    label: e.full_name || e.name || idOf(e),
  }));
  return options.length ? [{ label: "Personel", options }] : [];
}

export function personnelPayKindGroups(): SelectGroup[] {
  return [{
    label: "Ödeme türü",
    options: PERSONNEL_PAY_KINDS.map((k) => ({ value: k.key, label: k.label })),
  }];
}
