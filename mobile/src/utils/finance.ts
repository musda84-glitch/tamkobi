export const ACCOUNT_TYPES = [
  { key: "bank", label: "Banka" },
  { key: "cash_box", label: "Kasa" },
  { key: "pos", label: "POS" },
  { key: "okc_pos", label: "ÖKC POS" },
  { key: "credit_card", label: "Kredi Kartı" },
] as const;

export const ACCOUNT_TYPE_TR: Record<string, string> = Object.fromEntries(ACCOUNT_TYPES.map((t) => [t.key, t.label]));

export const TX_TYPE_TR: Record<string, string> = {
  inflow: "Tahsilat",
  outflow: "Tediye",
  transfer: "Virman",
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
  pos_commission_rate?: number;
  card_holder?: string;
  card_last4?: string;
  card_expiry?: string;
  card_limit?: number | null;
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
  contact_name?: string;
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
  };
}

export function draftFromAccount(acc: BankAccount): AccountDraft {
  return {
    ...emptyAccountDraft(),
    type: acc.type || "bank",
    bank_name: acc.bank_name || "",
    account_name: acc.account_name || "",
    account_number: acc.account_number || "",
    iban: acc.iban || "",
    currency: acc.currency || "TRY",
    current_balance: String(acc.current_balance ?? 0),
    pos_commission_rate: String(acc.pos_commission_rate ?? 1.5),
    card_holder: acc.card_holder || "",
    card_last4: acc.card_last4 || "",
    card_expiry: acc.card_expiry || "",
    card_limit: acc.card_limit == null ? "" : String(acc.card_limit),
  };
}

function num(v: string): number {
  const n = Number(String(v).replace(",", "."));
  return Number.isFinite(n) ? n : 0;
}

export function validateAccountDraft(d: AccountDraft): string | null {
  if (!d.account_name.trim()) return "Hesap adı gerekli.";
  if (d.type === "bank" && !d.bank_name.trim()) return "Banka adı gerekli.";
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

export function expensePayload(d: ExpenseDraft, companyId: string) {
  return {
    company_id: companyId,
    date: d.date,
    category: d.category || "Diğer",
    description: d.description.trim(),
    amount: num(d.amount),
    vat_rate: num(d.vat_rate),
    vat_included: d.vat_included,
    account_id: d.account_id || null,
    contact_id: d.contact_id || null,
    document_no: d.document_no,
    notes: d.notes,
    is_recurring: d.is_recurring,
    currency: d.currency || "TRY",
  };
}

export function validateVirman(sourceId: string, targetId: string, amount: string): string | null {
  if (!sourceId || !targetId) return "Kaynak ve hedef hesap seçin.";
  if (sourceId === targetId) return "Kaynak ve hedef hesap aynı olamaz.";
  if (!(num(amount) > 0)) return "Geçerli bir tutar giriniz.";
  return null;
}

export function accountTypeTr(v?: string | null): string {
  if (!v) return "—";
  return ACCOUNT_TYPE_TR[v] || v;
}

export function txTypeTr(v?: string | null): string {
  if (!v) return "—";
  return TX_TYPE_TR[v] || v;
}
