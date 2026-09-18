export type AiCartItem = {
  requested?: string;
  quantity: number;
  product_id?: string | null;
  matched_name?: string | null;
  confidence?: number;
  learned?: boolean;
  on?: boolean;
};

export type AiCartUnmatched = { requested?: string; quantity?: number };

export type AiCartResult = {
  filename?: string;
  items: AiCartItem[];
  unmatched: AiCartUnmatched[];
};

const LEGACY_XLS = /\.xls$/i;
const XLSX = /\.xlsx$|\.xlsm$/i;

export function rejectLegacyXls(filename?: string | null): string | null {
  const name = String(filename || "").toLowerCase();
  if (LEGACY_XLS.test(name) && !XLSX.test(name)) {
    return "Eski .xls desteklenmiyor. Excel’de .xlsx olarak kaydedip yeniden yükleyin.";
  }
  return null;
}

export function normalizeAiCart(raw: { items?: AiCartItem[]; unmatched?: AiCartUnmatched[]; filename?: string } | null | undefined): AiCartResult {
  const items = Array.isArray(raw?.items) ? raw.items.map((i) => ({ ...i, on: i.on !== false, quantity: Math.max(1, Number(i.quantity) || 1) })) : [];
  const unmatched = Array.isArray(raw?.unmatched) ? raw.unmatched : [];
  return { filename: raw?.filename, items, unmatched };
}

export function toggleAiItem(res: AiCartResult, index: number, on: boolean): AiCartResult {
  return { ...res, items: res.items.map((x, i) => (i === index ? { ...x, on } : x)) };
}

export function setAiQty(res: AiCartResult, index: number, qty: number): AiCartResult {
  return { ...res, items: res.items.map((x, i) => (i === index ? { ...x, quantity: Math.max(1, Number(qty) || 1) } : x)) };
}

export function mapUnmatched(
  res: AiCartResult,
  index: number,
  product: { id: string; name: string }
): AiCartResult {
  const u = res.unmatched[index];
  if (!u) return res;
  return {
    ...res,
    items: [
      ...res.items,
      { requested: u.requested, quantity: Math.max(1, Number(u.quantity) || 1), product_id: product.id, matched_name: product.name, confidence: 1, learned: true, on: true },
    ],
    unmatched: res.unmatched.filter((_, j) => j !== index),
  };
}

export function selectedAiLines(res: AiCartResult | null | undefined): Array<{ product_id: string; quantity: number }> {
  return (res?.items || [])
    .filter((i) => i.on && i.product_id)
    .map((i) => ({ product_id: String(i.product_id), quantity: Math.max(1, Number(i.quantity) || 1) }));
}

/** Web ile aynı: öğrenilen veya adı listedekinden farklı eşlemeleri kaydet. */
export function learnMappings(res: AiCartResult | null | undefined): Array<{ alias: string; product_id: string }> {
  return (res?.items || [])
    .filter((i) => i.on && i.product_id && i.requested)
    .filter((i) => i.learned || (i.matched_name && String(i.requested).toLowerCase() !== String(i.matched_name).toLowerCase()))
    .map((i) => ({ alias: String(i.requested), product_id: String(i.product_id) }));
}
