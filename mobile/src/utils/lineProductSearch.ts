import type { Product } from "../types";
import { computeLine, lineFromProduct, type InvoiceLine } from "./documentLines";
import { asList, filterProducts } from "./productDisplay";
import { fmtMoney, idOf } from "./money";
import { workItemFromProduct, type WorkItem } from "./workDocs";

export const LINE_PRODUCT_SEARCH_MIN_CHARS = 2;
export const LINE_PRODUCT_SEARCH_DEBOUNCE_MS = 300;
export const LINE_PRODUCT_SEARCH_LIMIT = 8;

export type LineProductHit = Pick<
  Product,
  "id" | "_id" | "name" | "sku" | "barcode" | "stock_quantity" | "sale_price" | "unit" | "vat_rate" | "image_url" | "thumbnail_url" | "images" | "type" | "price_includes_vat" | "purchase_price"
>;

/** Hizmet satırında stok araması kapalı; Ürün'de en az 2 karakter. */
export function lineProductSearchQuery(name: string, isService?: boolean): string | null {
  if (isService) return null;
  const q = String(name || "").trim();
  if (q.length < LINE_PRODUCT_SEARCH_MIN_CHARS) return null;
  return q;
}

export function lineProductSearchEnabled(isService?: boolean): boolean {
  return !isService;
}

/** Mevcut ürün arama API'si: ad / SKU / barkod. */
export function lineProductSearchRequest(companyId: string, q: string): { path: string; query: Record<string, string> } {
  return { path: "/search", query: { q, company_id: companyId } };
}

export function lineProductDetailRequest(productId: string): { path: string } {
  return { path: `/products/${encodeURIComponent(productId)}` };
}

export function lineBarcodeLookupRequest(companyId: string, code: string): { path: string; query: Record<string, string> } {
  return {
    path: `/products/barcode/${encodeURIComponent(String(code || "").trim())}`,
    query: { company_id: companyId },
  };
}

export function productsFromSearchPayload(data: unknown): LineProductHit[] {
  if (!data || typeof data !== "object") return asList<LineProductHit>(data);
  const o = data as { products?: unknown };
  if (Array.isArray(o.products)) return asList<LineProductHit>(o.products);
  return asList<LineProductHit>(data);
}

export function lineProductNeedsHydrate(p: LineProductHit | Product | null | undefined): boolean {
  if (!p || !idOf(p)) return false;
  const hasVat = p.vat_rate != null && Number.isFinite(Number(p.vat_rate));
  const hasUnit = !!String(p.unit || "").trim();
  return !hasVat || !hasUnit;
}

export function findCatalogProduct(
  catalog: Array<LineProductHit | Product> | null | undefined,
  hit: { id?: string; _id?: string } | string | null | undefined,
): (LineProductHit | Product) | undefined {
  const id = typeof hit === "string" ? hit : idOf(hit);
  if (!id) return undefined;
  return (catalog || []).find((p) => idOf(p) === id);
}

export function findCatalogByScan<T extends Pick<Product, "barcode" | "sku">>(
  catalog: T[] | null | undefined,
  code: string,
): T | undefined {
  const c = String(code || "").trim();
  if (!c) return undefined;
  return (catalog || []).find((p) => String(p.barcode || "").trim() === c || String(p.sku || "").trim() === c);
}

export function mergeLineProductHits(
  local: LineProductHit[],
  remote: LineProductHit[],
  opts?: { excludeId?: string; limit?: number },
): LineProductHit[] {
  const limit = opts?.limit ?? LINE_PRODUCT_SEARCH_LIMIT;
  const exclude = String(opts?.excludeId || "");
  const seen = new Set<string>();
  const out: LineProductHit[] = [];
  for (const p of [...local, ...remote]) {
    const id = idOf(p);
    if (!id || seen.has(id) || (exclude && id === exclude)) continue;
    seen.add(id);
    out.push(p);
    if (out.length >= limit) break;
  }
  return out;
}

export async function fetchLineProductHits(opts: {
  search: (path: string, query?: Record<string, string>) => Promise<unknown>;
  companyId: string;
  query: string;
  catalog?: LineProductHit[] | Product[] | null;
  isService?: boolean;
  excludeId?: string;
  limit?: number;
}): Promise<LineProductHit[]> {
  const q = lineProductSearchQuery(opts.query, opts.isService);
  if (!q) return [];
  const local = filterProducts(opts.catalog || [], q, "all", opts.limit ?? LINE_PRODUCT_SEARCH_LIMIT);
  let remote: LineProductHit[] = [];
  try {
    const req = lineProductSearchRequest(opts.companyId, q);
    remote = productsFromSearchPayload(await opts.search(req.path, req.query));
  } catch {
    remote = [];
  }
  return mergeLineProductHits(local, remote, { excludeId: opts.excludeId, limit: opts.limit });
}

export function lineProductHitMeta(p: Pick<LineProductHit, "sku" | "stock_quantity" | "unit">): string {
  const sku = String(p.sku || "").trim() || "—";
  const qty = Number(p.stock_quantity);
  const stock = Number.isFinite(qty) ? qty.toLocaleString("tr-TR") : "—";
  const unit = String(p.unit || "").trim();
  return `SKU ${sku} · Stok ${stock}${unit ? ` ${unit}` : ""}`;
}

export function lineProductHitPrice(p: Pick<LineProductHit, "sale_price">, currency = "TRY"): string {
  return fmtMoney(p.sale_price, currency);
}

export function shouldShowLineProductHits(opts: {
  isService?: boolean;
  query: string;
  hits?: unknown[] | null;
  focused?: boolean;
}): boolean {
  if (!lineProductSearchQuery(opts.query, opts.isService)) return false;
  if (opts.focused === false) return false;
  return (opts.hits || []).length > 0;
}

/** Listede yoksa yeni ürün butonu yok; serbest metin devam eder. */
export function lineProductAddNewAction(): null {
  return null;
}

export function applyLineNameDraft<T extends { name?: string; product_id?: string }>(item: T, nextName: string): T {
  const prev = String(item.name || "");
  const next = { ...item, name: nextName };
  if (item.product_id && nextName.trim() !== prev.trim()) {
    next.product_id = "";
  }
  return next;
}

export function fillWorkItemFromProduct(item: WorkItem, prod: LineProductHit | Product): WorkItem {
  const filled = workItemFromProduct(prod);
  return {
    ...filled,
    quantity: Number(item.quantity) || 1,
    description: item.description || "",
    is_service: false,
    product_id: idOf(prod),
  };
}

export function fillInvoiceLineFromProduct(
  item: InvoiceLine,
  prod: LineProductHit | Product,
  invoiceType = "sales",
): InvoiceLine {
  const line = lineFromProduct(prod as unknown as Record<string, unknown>, {
    invoiceType,
    quantity: Number(item.quantity) || 1,
  });
  return computeLine(
    {
      ...line,
      is_service: false,
      product_id: idOf(prod),
      discount_rate: item.discount_rate || 0,
    },
    "discount_rate",
  );
}
