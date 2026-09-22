import { collectableAccounts } from "./contactDraft";
import { fmtMoney, idOf } from "./money";

export const ACCOUNT_TYPES = [
  { key: "bank", label: "Banka" },
  { key: "cash_box", label: "Kasa" },
  { key: "pos", label: "POS" },
  { key: "okc_pos", label: "ÖKC POS" },
  { key: "credit_card", label: "Kredi Kartı" },
] as const;

export const ACCOUNT_TYPE_TR: Record<string, string> = Object.fromEntries(ACCOUNT_TYPES.map((t) => [t.key, t.label]));

const TYPE_ALIAS: Record<string, string> = {
  cash: "cash_box",
  kasa: "cash_box",
  cashbox: "cash_box",
  nakit: "cash_box",
  cash_box: "cash_box",
  bank: "bank",
  banka: "bank",
  pos: "pos",
  okc: "okc_pos",
  okc_pos: "okc_pos",
  credit_card: "credit_card",
  kart: "credit_card",
  card: "credit_card",
};

export function normalizeAccountType(t?: string | null): string {
  const raw = String(t || "").toLowerCase();
  return TYPE_ALIAS[raw] || raw || "bank";
}

export const TX_TYPE_TR: Record<string, string> = {
  inflow: "Tahsilat",
  outflow: "Tediye",
  transfer: "Virman",
};

export const PARTNER_TX_TR: Record<string, string> = {
  capital_in: "Sermaye Girişi",
  withdrawal: "Para Çekişi",
  profit_share: "Kâr Payı",
};

export type BankAccount = {
  id?: string;
  _id?: string;
  type?: string;
  bank_name?: string;
  account_name?: string;
  account_number?: string;
  iban?: string;
  currency?: string;
  current_balance?: number;
  balance?: number;
  pos_commission_rate?: number;
  card_holder?: string;
  card_last4?: string;
  card_expiry?: string;
  card_limit?: number | null;
  okc_brand?: string;
  okc_serial?: string;
  okc_terminal_id?: string;
  is_integrated?: boolean;
  integration_provider?: string;
  integration_status?: string;
};

export type BankTx = {
  id?: string;
  _id?: string;
  account_id?: string;
  account_name?: string;
  type?: string;
  category?: string;
  amount?: number;
  currency?: string;
  description?: string;
  date?: string;
  contact_id?: string;
  contact_name?: string;
  source?: string;
  is_simulated?: boolean;
  match_status?: string;
  matched_via?: string;
  suggested_contact_id?: string;
  suggested_contact_name?: string;
  related_invoice_id?: string;
  related_invoice_number?: string;
  target_account_id?: string;
  target_account_name?: string;
};

export type Partner = {
  id?: string;
  _id?: string;
  name?: string;
  share_percent?: number;
  phone?: string;
  email?: string;
  balance?: number;
  total_capital_in?: number;
  total_withdrawn?: number;
  total_profit_share?: number;
  is_active?: boolean;
};

export type PartnerSummary = {
  partner_count?: number;
  total_share_percent?: number;
  total_balance?: number;
  total_capital_in?: number;
  total_withdrawn?: number;
  total_profit_share?: number;
};

export type PartnerTx = {
  id?: string;
  _id?: string;
  partner_id?: string;
  partner_name?: string;
  type?: string;
  amount?: number;
  account_id?: string;
  account_name?: string;
  description?: string;
  date?: string;
  is_paid?: boolean;
};

export type AccountDraft = {
  type: string;
  bank_name: string;
  account_name: string;
  account_number: string;
  iban: string;
  currency: string;
  current_balance: string;
  pos_commission_rate: string;
  card_holder: string;
  card_last4: string;
  card_expiry: string;
  card_limit: string;
  okc_brand: string;
  okc_serial: string;
  okc_terminal_id: string;
};

export function emptyAccountDraft(): AccountDraft {
  return {
    type: "bank",
    bank_name: "",
    account_name: "",
    account_number: "",
    iban: "",
    currency: "TRY",
    current_balance: "0",
    pos_commission_rate: "1.5",
    card_holder: "",
    card_last4: "",
    card_expiry: "",
    card_limit: "",
    okc_brand: "",
    okc_serial: "",
    okc_terminal_id: "",
  };
}

export function draftFromAccount(acc: BankAccount): AccountDraft {
  return {
    ...emptyAccountDraft(),
    type: normalizeAccountType(acc.type) || "bank",
    bank_name: acc.bank_name || "",
    account_name: acc.account_name || "",
    account_number: acc.account_number || "",
    iban: acc.iban || "",
    currency: acc.currency || "TRY",
    current_balance: String(acc.current_balance ?? acc.balance ?? 0),
    pos_commission_rate: String(acc.pos_commission_rate ?? 1.5),
    card_holder: acc.card_holder || "",
    card_last4: acc.card_last4 || "",
    card_expiry: acc.card_expiry || "",
    card_limit: acc.card_limit == null ? "" : String(acc.card_limit),
    okc_brand: acc.okc_brand || "",
    okc_serial: acc.okc_serial || "",
    okc_terminal_id: acc.okc_terminal_id || "",
  };
}

function num(v: string): number {
  const n = Number(String(v).replace(",", "."));
  return Number.isFinite(n) ? n : 0;
}

export function accountBalance(a?: { current_balance?: number; balance?: number } | null): number {
  return Number(a?.current_balance ?? a?.balance ?? 0) || 0;
}

export type AccountGroupTone = {
  bg: string;
  border: string;
  label: string;
  amount: string;
  accent: string;
};

/** Web Kasa & Banka grup kartları: banka mavi, kasa yeşil, POS mor, ortak amber. */
export const ACCOUNT_GROUP_TONES: Record<string, AccountGroupTone> = {
  bank: { bg: "#EFF6FF", border: "#93C5FD", label: "#1D4ED8", amount: "#1E3A8A", accent: "#2563EB" },
  cash_box: { bg: "#ECFDF5", border: "#6EE7B7", label: "#047857", amount: "#065F46", accent: "#059669" },
  pos: { bg: "#F5F3FF", border: "#C4B5FD", label: "#6D28D9", amount: "#4C1D95", accent: "#7C3AED" },
  okc_pos: { bg: "#F0FDFA", border: "#5EEAD4", label: "#0F766E", amount: "#115E59", accent: "#0D9488" },
  credit_card: { bg: "#FDF4FF", border: "#F0ABFC", label: "#A21CAF", amount: "#86198F", accent: "#C026D3" },
  partners: { bg: "#FFFBEB", border: "#FCD34D", label: "#B45309", amount: "#92400E", accent: "#D97706" },
  other: { bg: "#F8FAFC", border: "#E2E8F0", label: "#475569", amount: "#0F172A", accent: "#64748B" },
};

export function accountGroupTone(key?: string | null): AccountGroupTone {
  return ACCOUNT_GROUP_TONES[String(key || "")] || ACCOUNT_GROUP_TONES.other;
}

export function filterPartners<T extends { name?: string; phone?: string; email?: string }>(
  partners: T[] | null | undefined,
  q: string,
): T[] {
  const list = partners || [];
  const s = q.trim().toLowerCase();
  if (!s) return list;
  return list.filter((p) => [p.name, p.phone, p.email].some((v) => String(v || "").toLowerCase().includes(s)));
}

/** Tümü + Banka + Ortaklar önde, sonra kasa / POS / kart. */
export function bankingListFilterKeys(groupKeys: string[], hasPartners: boolean): string[] {
  const keys = groupKeys || [];
  const rest = keys.filter((k) => k !== "bank");
  const out = ["all"];
  if (keys.includes("bank")) out.push("bank");
  if (hasPartners) out.push("partners");
  out.push(...rest);
  return out;
}

export function bankingFilterLabel(key: string): string {
  if (key === "all") return "Tümü";
  if (key === "partners") return "Ortaklar";
  return ACCOUNT_TYPE_TR[key] || key;
}

export function groupedAccounts<T extends { type?: string }>(accounts: T[]): { key: string; label: string; items: T[] }[] {
  const list = accounts || [];
  const groups: { key: string; label: string; items: T[] }[] = ACCOUNT_TYPES.map((g) => ({
    key: g.key,
    label: g.label,
    items: list.filter((a) => normalizeAccountType(a.type) === g.key),
  })).filter((g) => g.items.length);
  const known = new Set<string>(ACCOUNT_TYPES.map((t) => t.key));
  const other = list.filter((a) => !known.has(normalizeAccountType(a.type)));
  if (other.length) groups.push({ key: "other", label: "Diğer", items: other });
  return groups;
}

export function virmanAccounts<T extends { is_integrated?: boolean }>(accounts: T[]): T[] {
  return (accounts || []).filter((a) => !a.is_integrated);
}

const BANK_TAB_TYPES = new Set(["bank", "pos", "okc_pos"]);
const POS_TAB_TYPES = new Set(["pos", "okc_pos"]);

/** Kasa & Banka üst sekmesindeki Bankalar: banka + POS + ÖKC. */
export function isBankingBankAccount(a?: { type?: string } | null): boolean {
  return BANK_TAB_TYPES.has(normalizeAccountType(a?.type));
}

/** Üst sekmedeki POS: POS + ÖKC. */
export function isBankingPosAccount(a?: { type?: string } | null): boolean {
  return POS_TAB_TYPES.has(normalizeAccountType(a?.type));
}

export type PaymentTargetOption = { value: string; label: string; disabled?: boolean };
export type PaymentTargetGroup = { label: string; options: PaymentTargetOption[] };

/** Web PaymentTargetSelect karşılığı: tür bazlı gruplar + opsiyonel ortaklar. */
function partnerTargetGroup(partners: Partner[]): PaymentTargetGroup {
  return {
    label: "Ortaklar Hesabı",
    options: partners.map((p) => ({
      value: `partner:${idOf(p)}`,
      label: `${p.name || "Ortak"} (Ortak · %${p.share_percent ?? 0} · ${fmtMoney(p.balance)})`,
    })),
  };
}

export function paymentTargetGroups(
  accounts: BankAccount[],
  partners: Partner[] = [],
  opts: { collectableOnly?: boolean; includePartners?: boolean; partnersFirst?: boolean } = {}
): PaymentTargetGroup[] {
  const pool = opts.collectableOnly ? collectableAccounts(accounts || []) : accounts || [];
  const groups: PaymentTargetGroup[] = groupedAccounts(pool).map((g) => ({
    label: g.label,
    options: g.items.map((a) => ({
      value: idOf(a),
      label: `${a.account_name || a.bank_name || "Hesap"} · ${fmtMoney(accountBalance(a), a.currency)}`,
    })),
  }));
  const active = (partners || []).filter((p) => p.is_active !== false);
  if (opts.includePartners !== false && active.length) {
    const ortaklar = partnerTargetGroup(active);
    if (opts.partnersFirst) groups.unshift(ortaklar);
    else groups.push(ortaklar);
  }
  return groups;
}

/** Virman kaynak/hedef: kasa + banka + POS + ortaklar; entegre bankalar görünür ama kapalı. */
export function virmanSelectGroups(accounts: BankAccount[], partners: Partner[] = []): PaymentTargetGroup[] {
  const groups = paymentTargetGroups(virmanAccounts(accounts), partners);
  const integrated = (accounts || []).filter((a) => a.is_integrated);
  if (integrated.length) {
    groups.push({
      label: "Entegre banka",
      options: integrated.map((a) => ({
        value: `integrated:${idOf(a)}`,
        label: `${a.account_name || a.bank_name || "Hesap"} · ${fmtMoney(accountBalance(a), a.currency)} (entegre)`,
        disabled: true,
      })),
    });
  }
  return groups;
}

export function splitPaymentTarget(value?: string | null): { partner_id?: string | null; account_id?: string | null } {
  const v = String(value || "");
  if (v.startsWith("partner:")) return { partner_id: v.slice(8), account_id: null };
  return { account_id: v || null, partner_id: null };
}

export function validateContactPayment(amount: string, accountId: string): string | null {
  const amt = Number(String(amount).replace(",", "."));
  if (!(amt > 0)) return "Geçerli bir tutar girin.";
  if (!String(accountId || "").trim()) return "Kasa / banka / ortak seçin.";
  return null;
}

export function contactPaymentRequest(opts: {
  companyId: string;
  contactId: string;
  contactName: string;
  type: "inflow" | "outflow";
  amount: number;
  accountId: string;
  description: string;
  accounts: BankAccount[];
}) {
  const target = splitPaymentTarget(opts.accountId);
  if (target.partner_id) {
    return {
      path: `/contacts/${opts.contactId}/record-payment`,
      body: {
        partner_id: target.partner_id,
        type: opts.type,
        amount: opts.amount,
        description: opts.description,
      },
    };
  }
  const acc = opts.accounts.find((a) => idOf(a) === target.account_id);
  return {
    path: "/banking/transactions",
    body: {
      company_id: opts.companyId,
      account_id: target.account_id,
      account_name: acc?.account_name,
      type: opts.type,
      category: opts.type === "inflow" ? "Cari Tahsilat" : "Cari Ödeme",
      amount: opts.amount,
      currency: "TRY",
      description: `${opts.contactName}: ${opts.description}`,
      contact_id: opts.contactId,
      contact_name: opts.contactName,
      source: "manual",
    },
  };
}

export function totalLiquidity(accounts: BankAccount[]): number {
  return (accounts || [])
    .filter((a) => normalizeAccountType(a.type) !== "credit_card")
    .reduce((s, a) => s + accountBalance(a), 0);
}

export function validateAccountDraft(d: AccountDraft): string | null {
  if (!d.account_name.trim()) return "Hesap adı gerekli.";
  if (d.type === "bank" && !d.bank_name.trim()) return "Banka adı gerekli.";
  return null;
}

export function validatePartner(name: string, share: string, currentTotal = 0): string | null {
  if (!name.trim()) return "Ortak adı gerekli.";
  const s = num(share);
  if (!(s > 0)) return "Ortaklık payı girin.";
  if (currentTotal + s > 100.01) return "Toplam ortaklık payı %100'ü aşamaz.";
  return null;
}

export function accountPayload(d: AccountDraft, companyId?: string) {
  const isCard = d.type === "credit_card";
  const last4 = d.card_last4.replace(/\D/g, "").slice(-4);
  const body: Record<string, unknown> = {
    type: d.type,
    bank_name: d.bank_name.trim() || (d.type === "cash_box" ? "Kasa" : d.account_name.trim()),
    account_name: d.account_name.trim(),
    currency: d.currency || "TRY",
    current_balance: isCard ? -Math.abs(num(d.current_balance)) : num(d.current_balance),
  };
  if (companyId) body.company_id = companyId;
  if (isCard) {
    body.card_holder = d.card_holder.trim() || null;
    body.card_last4 = last4 || null;
    body.card_expiry = d.card_expiry.trim() || null;
    body.card_limit = d.card_limit === "" ? null : num(d.card_limit);
  } else {
    body.iban = d.iban.trim();
    body.account_number = d.account_number.trim();
    if (d.type === "pos" || d.type === "okc_pos") body.pos_commission_rate = num(d.pos_commission_rate);
    if (d.type === "okc_pos") {
      body.okc_brand = d.okc_brand.trim() || null;
      body.okc_serial = d.okc_serial.trim() || null;
      body.okc_terminal_id = d.okc_terminal_id.trim() || null;
    }
  }
  return body;
}

export function accountUpdatePayload(d: AccountDraft) {
  const { current_balance: _bal, company_id: _cid, ...meta } = accountPayload(d);
  void _bal;
  void _cid;
  return meta;
}

export const EXPENSE_DEFAULT_CATEGORIES = [
  "Kira", "Elektrik / Su / Doğalgaz", "İnternet / Telefon", "Yakıt", "Yemek", "Yol / Ulaşım",
  "Ofis Malzemesi", "Personel Masrafı", "Vergi / Harç / SGK", "Bakım / Onarım", "Pazarlama / Reklam",
  "Yazılım / Abonelik", "Kargo / Nakliye", "Muhasebe / Danışmanlık", "Diğer",
];

export type ExpenseCategory = { name?: string; is_default?: boolean };

/** /expenses/categories varsayılan ve şirkete özel kategorileri birlikte döner. */
export function expenseCategoryGroups(rows: ExpenseCategory[], extra: string[] = []): PaymentTargetGroup[] {
  const named = (rows || []).map((c) => ({ name: String(c.name || "").trim(), is_default: c.is_default !== false })).filter((c) => c.name);
  const base = named.length ? named : EXPENSE_DEFAULT_CATEGORIES.map((name) => ({ name, is_default: true }));
  const known = new Set(base.map((c) => c.name));
  const custom = [
    ...base.filter((c) => !c.is_default).map((c) => c.name),
    ...extra.map((n) => n.trim()).filter((n) => n && !known.has(n)),
  ];
  const groups: PaymentTargetGroup[] = [];
  const defaults = base.filter((c) => c.is_default).map((c) => c.name);
  if (defaults.length) groups.push({ label: "Varsayılan", options: defaults.map((name) => ({ value: name, label: name })) });
  if (custom.length) groups.push({ label: "Şirkete özel", options: custom.map((name) => ({ value: name, label: name })) });
  return groups;
}

export type Expense = {
  id?: string;
  _id?: string;
  expense_number?: string;
  date?: string;
  category?: string;
  description?: string;
  amount?: number;
  vat_rate?: number;
  vat_amount?: number;
  vat_included?: boolean;
  total?: number;
  payment_status?: string;
  account_id?: string;
  account_name?: string;
  contact_id?: string;
  contact_name?: string;
  employee_id?: string;
  employee_name?: string;
  project_id?: string;
  document_no?: string;
  notes?: string;
  is_recurring?: boolean;
  currency?: string;
};

export type ExpenseDraft = {
  date: string;
  category: string;
  description: string;
  amount: string;
  vat_rate: string;
  vat_included: boolean;
  account_id: string;
  contact_id: string;
  document_no: string;
  notes: string;
  is_recurring: boolean;
  currency: string;
};

export function emptyExpenseDraft(today: string): ExpenseDraft {
  return {
    date: today,
    category: "Diğer",
    description: "",
    amount: "",
    vat_rate: "20",
    vat_included: false,
    account_id: "",
    contact_id: "",
    document_no: "",
    notes: "",
    is_recurring: false,
    currency: "TRY",
  };
}

export function draftFromExpense(e: Expense, today: string): ExpenseDraft {
  return {
    ...emptyExpenseDraft(today),
    date: String(e.date || today).slice(0, 10),
    category: e.category || "Diğer",
    description: e.description || "",
    amount: String(e.amount ?? ""),
    vat_rate: String(e.vat_rate ?? 20),
    vat_included: !!e.vat_included,
    account_id: e.account_id || "",
    contact_id: e.contact_id || "",
    document_no: e.document_no || "",
    notes: e.notes || "",
    is_recurring: !!e.is_recurring,
    currency: e.currency || "TRY",
  };
}

export function expenseCalc(d: ExpenseDraft): { net: number; vat: number; total: number } {
  const a = num(d.amount);
  const r = num(d.vat_rate);
  const net = d.vat_included ? a / (1 + r / 100) : a;
  const vat = net * r / 100;
  return { net, vat, total: net * (1 + r / 100) };
}

export function validateExpenseDraft(d: ExpenseDraft): string | null {
  if (!d.description.trim()) return "Açıklama zorunlu.";
  if (!(num(d.amount) > 0)) return "Tutar sıfırdan büyük olmalı.";
  return null;
}

export function expensePayload(d: ExpenseDraft, companyId: string, projectId?: string | null) {
  const target = splitPaymentTarget(d.account_id);
  return {
    company_id: companyId,
    date: d.date,
    category: d.category || "Diğer",
    description: d.description.trim(),
    amount: num(d.amount),
    vat_rate: num(d.vat_rate),
    vat_included: d.vat_included,
    account_id: target.account_id,
    partner_id: target.partner_id,
    contact_id: d.contact_id || null,
    project_id: projectId || null,
    document_no: d.document_no,
    notes: d.notes,
    is_recurring: d.is_recurring,
    currency: d.currency || "TRY",
  };
}

/** Web ProjectExpenseModal: KDV dahil, ödenmemiş, projeye bağlı. */
export function emptyProjectExpenseDraft(today: string): ExpenseDraft {
  return { ...emptyExpenseDraft(today), vat_included: true };
}

export function validateVirman(sourceId: string, targetId: string, amount: string): string | null {
  if (!sourceId || !targetId) return "Kaynak ve hedef hesap seçin.";
  if (sourceId.startsWith("integrated:") || targetId.startsWith("integrated:")) {
    return "Entegre banka hesaplar virmana kapalı.";
  }
  if (sourceId === targetId) return "Kaynak ve hedef hesap aynı olamaz.";
  if (!(num(amount) > 0)) return "Geçerli bir tutar giriniz.";
  return null;
}

export function accountTypeTr(v?: string | null): string {
  if (!v) return "—";
  const key = normalizeAccountType(v);
  return ACCOUNT_TYPE_TR[key] || v;
}

export function txTypeTr(v?: string | null): string {
  if (!v) return "—";
  return TX_TYPE_TR[v] || v;
}

export function partnerTxTr(v?: string | null): string {
  if (!v) return "—";
  return PARTNER_TX_TR[v] || v;
}
