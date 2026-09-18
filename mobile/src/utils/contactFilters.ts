export type ContactTypeFilter = "all" | "customer" | "supplier";

export const CONTACT_TYPE_FILTERS: { key: ContactTypeFilter; label: string }[] = [
  { key: "all", label: "Tümü" },
  { key: "customer", label: "Müşteri" },
  { key: "supplier", label: "Tedarikçi" },
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

export function filterContacts<T extends FilterableContact>(rows: T[], filter: ContactTypeFilter, query: string, limit = 80): T[] {
  return (rows || [])
    .filter((c) => matchesContactType(c.type, filter) && matchesContactSearch(c, query))
    .slice(0, limit);
}
