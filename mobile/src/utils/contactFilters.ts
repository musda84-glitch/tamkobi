export type ContactTypeFilter = "all" | "customer" | "supplier";
export type ContactBalanceFilter = "all" | "receivable" | "payable";

export const CONTACT_TYPE_FILTERS: { key: ContactTypeFilter; label: string }[] = [
  { key: "all", label: "Tümü" },
  { key: "customer", label: "Müşteri" },
  { key: "supplier", label: "Tedarikçi" },
];

export const CONTACT_BALANCE_FILTERS: { key: ContactBalanceFilter; label: string }[] = [
  { key: "receivable", label: "Alacaklı Olanlar" },
  { key: "payable", label: "Borçlu Olanlar" },
];

type FilterableContact = {
  name?: string;
  company_title?: string;
  phone?: string;
  email?: string;
  tax_number_or_id?: string;
  city?: string;
  type?: string;
};

/** "both" tipindeki cariler hem müşteri hem tedarikçi filtresinde görünür. */
export function matchesContactType(type: string | undefined, filter: ContactTypeFilter): boolean {
  if (filter === "all") return true;
  const t = String(type || "customer");
  return t === filter || t === "both";
}

export function matchesContactSearch(contact: FilterableContact, query: string): boolean {
  const s = query.trim().toLowerCase();
  if (!s) return true;
  return [contact.name, contact.phone, contact.email, contact.tax_number_or_id, contact.city, contact.company_title]
    .some((v) => String(v || "").toLowerCase().includes(s));
}

/** Alacaklı = bakiye > 0, Borçlu = bakiye < 0. */
export function matchesContactBalance(balance: unknown, filter: ContactBalanceFilter): boolean {
  if (filter === "all") return true;
  const n = Number(balance);
  const amount = Number.isFinite(n) ? n : 0;
  if (filter === "receivable") return amount > 0;
  if (filter === "payable") return amount < 0;
  return true;
}

export function filterContacts<T extends FilterableContact>(
  rows: T[],
  filter: ContactTypeFilter,
  query: string,
  limit = 80,
  balance: ContactBalanceFilter = "all",
  amountOf?: (contact: T) => unknown,
): T[] {
  return (rows || [])
    .filter((c) => matchesContactType(c.type, filter) && matchesContactSearch(c, query) && matchesContactBalance(amountOf ? amountOf(c) : 0, balance))
    .slice(0, limit);
}
