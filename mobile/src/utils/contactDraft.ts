export type ContactDraft = {
  type: string;
  name: string;
  company_title: string;
  contact_person: string;
  contact_person_phone: string;
  tax_number_or_id: string;
  tax_office: string;
  is_e_invoice_user: boolean;
  email: string;
  phone: string;
  website: string;
  address: string;
  city: string;
  district: string;
  location_url: string;
  credit_limit: string;
  payment_term_days: string;
  late_fee_rate: string;
  default_discount: string;
  currency: string;
  payment_method: string;
  iban: string;
  bank_name: string;
  category: string;
  sales_rep: string;
  risk_status: string;
  b2b_enabled: boolean;
  b2b_discount: string;
  b2b_login_email: string;
  b2b_password: string;
  sms_opt_in: boolean;
  email_opt_in: boolean;
  tags: string;
  notes: string;
};

export const CONTACT_TYPES = [
  { key: "customer", label: "Müşteri" },
  { key: "supplier", label: "Tedarikçi" },
  { key: "both", label: "Müşteri & Tedarikçi" },
] as const;

export const CONTACT_CURRENCIES = ["TRY", "USD", "EUR", "GBP"] as const;

export const CONTACT_PAY_METHODS = [
  { key: "", label: "—" },
  { key: "cash", label: "Nakit" },
  { key: "transfer", label: "Havale/EFT" },
  { key: "card", label: "Kredi Kartı" },
  { key: "check", label: "Çek" },
  { key: "note", label: "Senet" },
  { key: "open_account", label: "Açık Hesap" },
] as const;

export const CONTACT_RISK = [
  { key: "normal", label: "Normal" },
  { key: "watch", label: "Takipte" },
  { key: "blocked", label: "Bloke" },
] as const;

export const CONTACT_FORM_TABS = [
  { key: "general", label: "Genel" },
  { key: "tax", label: "Vergi" },
  { key: "address", label: "Adres" },
  { key: "finance", label: "Finans" },
  { key: "b2b", label: "B2B" },
  { key: "notes", label: "Notlar" },
] as const;

export function emptyContactDraft(): ContactDraft {
  return {
    type: "customer",
    name: "",
    company_title: "",
    contact_person: "",
    contact_person_phone: "",
    tax_number_or_id: "",
    tax_office: "",
    is_e_invoice_user: false,
    email: "",
    phone: "",
    website: "",
    address: "",
    city: "İstanbul",
    district: "",
    location_url: "",
    credit_limit: "0",
    payment_term_days: "0",
    late_fee_rate: "0",
    default_discount: "0",
    currency: "TRY",
    payment_method: "",
    iban: "",
    bank_name: "",
    category: "Genel",
    sales_rep: "",
    risk_status: "normal",
    b2b_enabled: false,
    b2b_discount: "0",
    b2b_login_email: "",
    b2b_password: "",
    sms_opt_in: true,
    email_opt_in: true,
    tags: "",
    notes: "",
  };
}

function str(v: unknown, fallback = ""): string {
  return v == null ? fallback : String(v);
}

function numStr(v: unknown, fallback = "0"): string {
  if (v == null || v === "") return fallback;
  return String(v);
}

export function draftFromContact(c: Record<string, unknown>): ContactDraft {
  const tags = Array.isArray(c.tags) ? (c.tags as string[]).join(", ") : str(c.tags);
  return {
    ...emptyContactDraft(),
    type: str(c.type, "customer") || "customer",
    name: str(c.name),
    company_title: str(c.company_title),
    contact_person: str(c.contact_person),
    contact_person_phone: str(c.contact_person_phone),
    tax_number_or_id: str(c.tax_number_or_id),
    tax_office: str(c.tax_office),
    is_e_invoice_user: !!c.is_e_invoice_user,
    email: str(c.email),
    phone: str(c.phone),
    website: str(c.website),
    address: str(c.address),
    city: str(c.city, "İstanbul") || "İstanbul",
    district: str(c.district),
    location_url: str(c.location_url),
    credit_limit: numStr(c.credit_limit),
    payment_term_days: numStr(c.payment_term_days),
    late_fee_rate: numStr(c.late_fee_rate),
    default_discount: numStr(c.default_discount),
    currency: str(c.currency, "TRY") || "TRY",
    payment_method: str(c.payment_method),
    iban: str(c.iban),
    bank_name: str(c.bank_name),
    category: str(c.category, "Genel") || "Genel",
    sales_rep: str(c.sales_rep),
    risk_status: str(c.risk_status, "normal") || "normal",
    b2b_enabled: !!c.b2b_enabled,
    b2b_discount: numStr(c.b2b_discount),
    b2b_login_email: str(c.b2b_login_email),
    b2b_password: "",
    sms_opt_in: c.sms_opt_in !== false,
    email_opt_in: c.email_opt_in !== false,
    tags,
    notes: str(c.notes),
  };
}

export function validateContactDraft(d: ContactDraft): string | null {
  if (!d.name.trim()) return "Cari adı zorunludur.";
  if (!d.tax_number_or_id.trim()) return "VKN/TCKN zorunludur.";
  return null;
}

function n(v: string): number {
  const x = Number(String(v).replace(",", "."));
  return Number.isFinite(x) ? x : 0;
}

export function contactPayload(d: ContactDraft, companyId?: string): Record<string, unknown> {
  const tags = d.tags.split(",").map((t) => t.trim()).filter(Boolean);
  const body: Record<string, unknown> = {
    type: d.type,
    name: d.name.trim(),
    company_title: d.company_title.trim(),
    contact_person: d.contact_person.trim(),
    contact_person_phone: d.contact_person_phone.trim(),
    tax_number_or_id: d.tax_number_or_id.trim(),
    tax_office: d.tax_office.trim(),
    is_e_invoice_user: d.is_e_invoice_user,
    email: d.email.trim(),
    phone: d.phone.trim(),
    website: d.website.trim(),
    address: d.address.trim(),
    city: d.city.trim(),
    district: d.district.trim(),
    location_url: d.location_url.trim(),
    credit_limit: n(d.credit_limit),
    payment_term_days: n(d.payment_term_days),
    late_fee_rate: n(d.late_fee_rate),
    default_discount: n(d.default_discount),
    currency: d.currency || "TRY",
    payment_method: d.payment_method || null,
    iban: d.iban.trim(),
    bank_name: d.bank_name.trim(),
    category: d.category.trim() || "Genel",
    sales_rep: d.sales_rep.trim(),
    risk_status: d.risk_status || "normal",
    b2b_enabled: d.b2b_enabled,
    b2b_discount: n(d.b2b_discount),
    b2b_login_email: d.b2b_login_email.trim(),
    sms_opt_in: d.sms_opt_in,
    email_opt_in: d.email_opt_in,
    tags,
    notes: d.notes.trim(),
  };
  if (companyId) body.company_id = companyId;
  if (d.b2b_password.trim()) body.b2b_password = d.b2b_password;
  return body;
}

export function normalizeAccountType(t?: string | null): string {
  const raw = String(t || "").toLowerCase();
  if (raw === "cash" || raw === "kasa" || raw === "cashbox" || raw === "nakit") return "cash_box";
  return raw;
}

export function collectableAccounts<T extends { type?: string }>(accounts: T[]): T[] {
  return (accounts || []).filter((a) => normalizeAccountType(a.type) !== "credit_card");
}

export function splitPaymentTarget(value?: string | null): { partner_id?: string; account_id?: string } {
  const v = String(value || "");
  if (v.startsWith("partner:")) return { partner_id: v.slice(8) };
  return { account_id: v || undefined };
}
