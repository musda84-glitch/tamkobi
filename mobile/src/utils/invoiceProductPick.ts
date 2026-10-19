import AsyncStorage from "@react-native-async-storage/async-storage";
import type { Product } from "../types";
import type { ProductLineCommit } from "./documentLines";
import { idOf } from "./money";
import { asList, productImage, stockBadge, stockQuantity, stockRightLabel } from "./productDisplay";

export const INVOICE_PRODUCT_PAGE_SIZE = 30;
export const INVOICE_PRODUCT_SEARCH_DEBOUNCE_MS = 300;
export const FREQUENT_INVOICE_PRODUCTS = 10;

export function frequentInvoiceProductsKey(companyId: string): string {
  return `tamkobi.invoice.frequent_products.v1:${String(companyId || "").trim()}`;
}

/** Sayfalı ürün araması. Boş q gönderilmez; lite=1 maliyet geçmişini istemez. */
export function invoiceProductPageQuery(opts: {
  companyId: string;
  q?: string;
  page?: number;
}): Record<string, string | number> {
  const page = opts.page && opts.page > 0 ? Math.floor(opts.page) : 1;
  const query: Record<string, string | number> = {
    company_id: opts.companyId,
    page,
    page_size: INVOICE_PRODUCT_PAGE_SIZE,
    lite: 1,
    active: "active",
  };
  const q = String(opts.q || "").trim();
  if (q) query.q = q;
  return query;
}

export type InvoiceProductPage = {
  items: Product[];
  total: number;
  page: number;
  page_size: number;
  has_more: boolean;
};

export function parseInvoiceProductPage(data: unknown): InvoiceProductPage {
  if (Array.isArray(data)) {
    const items = data as Product[];
    return {
      items,
      total: items.length,
      page: 1,
      page_size: items.length || INVOICE_PRODUCT_PAGE_SIZE,
      has_more: false,
    };
  }
  const row = (data && typeof data === "object" ? data : {}) as Record<string, unknown>;
  const items = Array.isArray(row.items) ? (row.items as Product[]) : [];
  const page = Number(row.page) > 0 ? Number(row.page) : 1;
  const pageSize = Number(row.page_size) > 0 ? Number(row.page_size) : INVOICE_PRODUCT_PAGE_SIZE;
  const total = Number(row.total);
  const hasMore = typeof row.has_more === "boolean"
    ? row.has_more
    : (Number.isFinite(total) ? page * pageSize < total : false);
  return {
    items,
    total: Number.isFinite(total) ? total : items.length,
    page,
    page_size: pageSize,
    has_more: hasMore,
  };
}

export function appendProductPage(current: Product[], incoming: Product[]): Product[] {
  const seen = new Set(current.map((row) => idOf(row)).filter(Boolean));
  const next = [...current];
  for (const row of incoming) {
    const id = idOf(row);
    if (!id || seen.has(id)) continue;
    seen.add(id);
    next.push(row);
  }
  return next;
}

export function slimFrequentProduct(product: Product): Product {
  const thumb = productImage(product);
  return {
    id: product.id,
    _id: product._id,
    name: product.name,
    sku: product.sku,
    barcode: product.barcode,
    unit: product.unit,
    vat_rate: product.vat_rate,
    sale_price: product.sale_price,
    purchase_price: product.purchase_price,
    last_purchase_price: product.last_purchase_price,
    price_includes_vat: product.price_includes_vat,
    type: product.type,
    stock_quantity: product.stock_quantity,
    min_stock_alert: product.min_stock_alert,
    track_stock: product.track_stock,
    thumbnail_url: thumb || undefined,
    image_url: thumb || undefined,
    variants: product.variants,
    gtip: product.gtip,
    origin_country: product.origin_country,
  };
}

export function parseFrequentInvoiceProducts(raw: string | null | undefined): Product[] {
  if (!raw) return [];
  try {
    const data = JSON.parse(raw) as unknown;
    const rows = Array.isArray(data) ? data : [];
    return rows
      .filter((row): row is Product => !!row && typeof row === "object" && !!idOf(row as Product))
      .slice(0, FREQUENT_INVOICE_PRODUCTS);
  } catch {
    return [];
  }
}

/** Son eklenen başa gelir; aynı ürün tekrar eklenince öne taşınır. */
export function pushFrequentInvoiceProducts(existing: Product[], added: Product[], limit = FREQUENT_INVOICE_PRODUCTS): Product[] {
  let next = [...existing];
  for (const product of added) {
    const id = idOf(product);
    if (!id) continue;
    next = [slimFrequentProduct(product), ...next.filter((row) => idOf(row) !== id)];
  }
  return next.slice(0, limit);
}

export async function readFrequentInvoiceProducts(companyId: string): Promise<Product[]> {
  if (!String(companyId || "").trim()) return [];
  try {
    return parseFrequentInvoiceProducts(await AsyncStorage.getItem(frequentInvoiceProductsKey(companyId)));
  } catch {
    return [];
  }
}

export async function rememberFrequentInvoiceProducts(companyId: string, added: Product[]): Promise<Product[]> {
  const cid = String(companyId || "").trim();
  if (!cid || !added.length) return readFrequentInvoiceProducts(cid);
  const next = pushFrequentInvoiceProducts(await readFrequentInvoiceProducts(cid), added);
  try {
    await AsyncStorage.setItem(frequentInvoiceProductsKey(cid), JSON.stringify(next));
  } catch {
    /* kota doluysa liste yalnız bu oturumda kalır */
  }
  return next;
}

export function mergeProductCard(base: Product, fresh: Product): Product {
  const next: Product = { ...base, ...fresh, name: fresh.name || base.name };
  if (fresh.variants == null && base.variants) next.variants = base.variants;
  if (fresh.last_purchase_price == null && base.last_purchase_price != null) {
    next.last_purchase_price = base.last_purchase_price;
  }
  if (fresh.purchase_price == null && base.purchase_price != null) next.purchase_price = base.purchase_price;
  return next;
}

export function mergeFreshProducts(order: Product[], fresh: Product[]): Product[] {
  const map = new Map(fresh.map((row) => [idOf(row), row]));
  return order.map((row) => {
    const next = map.get(idOf(row));
    return next ? mergeProductCard(row, next) : row;
  });
}

export function upsertProducts(current: Product[], rows: Product[]): Product[] {
  const map = new Map<string, Product>();
  for (const row of current) {
    const id = idOf(row);
    if (id) map.set(id, row);
  }
  for (const row of rows) {
    const id = idOf(row);
    if (!id) continue;
    const prev = map.get(id);
    map.set(id, prev ? mergeProductCard(prev, row) : row);
  }
  return [...map.values()];
}

export function invoiceQtyForProduct(
  items: Array<{ product_id?: string; quantity?: number }> | null | undefined,
  productId: string,
): number {
  if (!productId) return 0;
  return (items || []).reduce((sum, row) => (
    row.product_id === productId ? sum + (Number(row.quantity) || 0) : sum
  ), 0);
}

function formatQty(n: number): string {
  if (!Number.isFinite(n)) return "0";
  if (Number.isInteger(n)) return String(n);
  return String(Math.round(n * 1000) / 1000);
}

export function invoicePickMeta(product: Pick<Product, "sku" | "unit" | "vat_rate">, invoiceQty = 0): string {
  const sku = String(product.sku || "").trim() || "—";
  const unit = String(product.unit || "").trim() || "Adet";
  const raw = product.vat_rate as unknown;
  const vat = raw == null || (typeof raw === "string" && raw.trim() === "") ? 20 : Number(raw);
  const vatLabel = Number.isFinite(vat) ? vat : 20;
  const base = `${sku} · ${unit} · KDV %${vatLabel}`;
  if (invoiceQty > 0) return `${base} · faturada ${formatQty(invoiceQty)}`;
  return base;
}

export type InvoicePickStock = { label: string; tone: "green" | "amber" | "red" | "muted" };

/** Yeterli yeşil, az amber, sıfır/eksi kırmızı. Hizmet stokBadge yerine gri "stoksuz". */
export function invoicePickStock(
  product: Pick<Product, "stock_quantity" | "unit" | "min_stock_alert" | "track_stock" | "type">,
): InvoicePickStock {
  if (product.type === "service") return { label: "stoksuz", tone: "muted" };
  const badge = stockBadge(product);
  const qty = stockQuantity(product);
  const label = badge?.label || stockRightLabel(product);
  if (qty <= 0 || badge?.tone === "danger") return { label, tone: "red" };
  if (badge?.tone === "warning") return { label, tone: "amber" };
  return { label, tone: "green" };
}

export function invoicePickAddLabel(count: number, qty: number): string {
  return `${count} ürün ekle (${qty} adet)`;
}

export function invoiceScanStrip(result: Pick<ProductLineCommit, "line">): string {
  const name = result.line.name || result.line.product_name || "Ürün";
  const unit = String(result.line.unit || "").trim() || "Adet";
  return `📷 ${name} +1 → faturada ${result.line.quantity} ${unit}`;
}

export function productsFromIdsPayload(data: unknown): Product[] {
  return asList<Product>(data);
}
