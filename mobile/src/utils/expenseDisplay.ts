import { dateSortKey } from "./calendar";

/** Görüntüleme: Türkçe harfleri uzunluğu koruyarak sadeleştirir. */
export function foldTr(value: string): string {
  const map: Record<string, string> = {
    İ: "i",
    I: "i",
    ı: "i",
    Ş: "s",
    ş: "s",
    Ğ: "g",
    ğ: "g",
    Ü: "u",
    ü: "u",
    Ö: "o",
    ö: "o",
    Ç: "c",
    ç: "c",
  };
  let out = "";
  for (const ch of value) out += map[ch] || ch.toLowerCase();
  return out;
}

const VENDOR_PREFIX = /^(?:firma(?:\s+adi)?|gonderen|satici|alici|unvan|tedarikci|isyeri|merchant)\s*:\s*/;

export type ExpenseNameRow = {
  contact_name?: string | null;
  description?: string | null;
  expense_number?: string | null;
};

/** Satıcı adı yalnız gösterim içindir; kayıtlı metni değiştirmez. */
export function expenseVendorName(row: ExpenseNameRow | null | undefined): string {
  const contact = String(row?.contact_name || "").trim();
  if (contact) return contact;
  const cleaned = stripVendorPrefix(String(row?.description || ""));
  if (cleaned) return cleaned;
  const number = String(row?.expense_number || "").trim();
  return number || "Masraf";
}

function stripVendorPrefix(raw: string): string {
  const trimmed = raw.trim();
  if (!trimmed) return "";
  const folded = foldTr(trimmed);
  const chars = [...trimmed];
  if (folded.length !== chars.length) return trimmed;
  const match = VENDOR_PREFIX.exec(folded);
  if (!match) return trimmed;
  return chars.slice([...match[0]].length).join("").trim();
}

const TR_MONTHS = [
  "Ocak", "Şubat", "Mart", "Nisan", "Mayıs", "Haziran",
  "Temmuz", "Ağustos", "Eylül", "Ekim", "Kasım", "Aralık",
];

export type ExpenseMonthTotal = { currency: string; amount: number };

export type ExpenseMonthGroup<T> = {
  key: string;
  label: string;
  items: T[];
  totals: ExpenseMonthTotal[];
};

export function expenseMonthKey(date?: string | null): string {
  const key = dateSortKey(date);
  const match = /^(\d{4})-(\d{2})-\d{2}$/.exec(key);
  if (!match) return "";
  const month = Number(match[2]);
  if (month < 1 || month > 12) return "";
  return `${match[1]}-${match[2]}`;
}

export function expenseMonthLabel(key: string): string {
  const match = /^(\d{4})-(\d{2})$/.exec(key);
  if (!match) return "Tarihsiz";
  return `${TR_MONTHS[Number(match[2]) - 1]} ${match[1]}`;
}

function expenseCurrency(value?: string | null): string {
  const currency = String(value || "").trim();
  return currency || "TRY";
}

export function expenseGroupTotals(
  rows: { total?: number | null; currency?: string | null }[],
): ExpenseMonthTotal[] {
  const sums = new Map<string, number>();
  for (const row of rows) {
    const currency = expenseCurrency(row.currency);
    const amount = Number(row.total);
    sums.set(currency, (sums.get(currency) || 0) + (Number.isFinite(amount) ? amount : 0));
  }
  return [...sums.entries()]
    .map(([currency, amount]) => ({ currency, amount }))
    .sort((a, b) => {
      if (a.currency === "TRY" && b.currency !== "TRY") return -1;
      if (b.currency === "TRY" && a.currency !== "TRY") return 1;
      return a.currency.localeCompare(b.currency);
    });
}

/** date (YYYY-MM) ile yeniden eskiye gruplar. Toplam yüklenmiş satırların total alanıdır. */
export function groupExpensesByMonth<T extends { date?: string | null; total?: number | null; currency?: string | null }>(
  rows: T[],
): ExpenseMonthGroup<T>[] {
  const sorted = rows.map((row, index) => ({ row, index })).sort((a, b) => {
    const ka = dateSortKey(a.row.date);
    const kb = dateSortKey(b.row.date);
    if (!ka && !kb) return a.index - b.index;
    if (!ka) return 1;
    if (!kb) return -1;
    if (ka !== kb) return kb.localeCompare(ka);
    return a.index - b.index;
  });
  const order: string[] = [];
  const buckets = new Map<string, T[]>();
  for (const { row } of sorted) {
    const key = expenseMonthKey(row.date) || "tarihsiz";
    if (!buckets.has(key)) {
      buckets.set(key, []);
      order.push(key);
    }
    buckets.get(key)!.push(row);
  }
  return order.map((key) => {
    const items = buckets.get(key) || [];
    return { key, label: expenseMonthLabel(key), items, totals: expenseGroupTotals(items) };
  });
}

const CATEGORY_ICONS: { test: RegExp; icon: string }[] = [
  { test: /yakit|akaryakit|benzin|motorin/, icon: "car" },
  { test: /yemek|restoran|gida/, icon: "restaurant" },
  { test: /kira/, icon: "home" },
  { test: /elektrik|fatura|dogalgaz|(^|[^a-z])su([^a-z]|$)/, icon: "flash" },
  { test: /kargo|nakliye/, icon: "cube" },
  { test: /internet|telefon/, icon: "call" },
  { test: /ulasim|(^|[^a-z])yol([^a-z]|$)/, icon: "bus" },
  { test: /ofis/, icon: "briefcase" },
  { test: /personel/, icon: "people" },
  { test: /vergi|harc|sgk/, icon: "document-text" },
  { test: /bakim|onarim/, icon: "construct" },
  { test: /pazarlama|reklam/, icon: "megaphone" },
  { test: /yazilim|abonelik/, icon: "laptop-outline" },
  { test: /muhasebe|danisman/, icon: "calculator" },
];

/** Bilinen masraf kategorisi → Ionicons adı. Bilinmeyen: receipt-outline. */
export function categoryIcon(category?: string | null): string {
  const folded = foldTr(String(category || ""));
  for (const rule of CATEGORY_ICONS) {
    if (rule.test.test(folded)) return rule.icon;
  }
  return "receipt-outline";
}
