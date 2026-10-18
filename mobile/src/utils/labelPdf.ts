import type { ApiClient } from "../api/client";
import { safePrintFilename } from "./orderPrint";
import {
  deliverTemplateLabelHtml,
  loadTemplates,
  type TemplateLabelJob,
} from "./pickLabelPrint";
import {
  builtinLabelTemplates,
  pickLineToLabelProduct,
  resolveLabelTemplateInfo,
  type LabelTemplateLike,
} from "./resolveLabelTemplate";
import { clampCopies } from "./tspl";

export type LabelPdfMode = "print" | "pdf";

export type LabelPdfProduct = {
  id?: string | null;
  _id?: string | null;
  name?: string | null;
  product_name?: string | null;
  sku?: string | null;
  barcode?: string | null;
  sale_price?: number | null;
  price?: number | null;
  vat_rate?: number | null;
  currency?: string | null;
  price_includes_vat?: boolean | null;
  tags?: string[] | null;
  category?: string | null;
  variant_name?: string | null;
  image_url?: string | null;
  label_image_url?: string | null;
  thumbnail_url?: string | null;
  label_template_id?: string | null;
};

export type ProductLabelPdfItem = {
  product: LabelPdfProduct | null | undefined;
  copies?: number;
  includePrice?: boolean;
};

/** TSPL koli etiketindeki alanlar: sipariş no, cari, adres, koli sayısı, isteğe bağlı QR. */
export type ShipmentLabelPdfInput = {
  orderNo?: string | null;
  customer?: string | null;
  address?: string | null;
  packageTotal?: number | null;
  qr?: string | null;
};

const SHIP_W_MM = 100;
const SHIP_H_MM = 50;

function withoutPrice(tpl: LabelTemplateLike): LabelTemplateLike {
  const elements = (Array.isArray(tpl.elements) ? tpl.elements : []).filter((el) => {
    const field = String(el?.field || "");
    const type = String(el?.type || "");
    return field !== "price" && type !== "price";
  });
  return { ...tpl, elements };
}

function priceShown(product: LabelPdfProduct | null | undefined, includePrice: boolean | undefined): boolean {
  if (includePrice === false || !product) return false;
  const raw = product.sale_price ?? product.price;
  if (raw == null) return false;
  return Number.isFinite(Number(raw));
}

function toLabelRecord(product: LabelPdfProduct): Record<string, unknown> {
  const record: Record<string, unknown> = { ...product };
  if (record.sale_price == null && record.price != null) record.sale_price = record.price;
  return record;
}

/** Stok / ürün etiketi: şirket şablonu, yoksa hazır şablon. Sistem yazdırma veya PDF. */
export async function printProductLabelsPdf(
  client: ApiClient,
  companyId: string | null | undefined,
  products: ProductLabelPdfItem[] | null | undefined,
  mode: LabelPdfMode,
  company?: { name?: string | null; logo_url?: string | null } | null,
): Promise<boolean> {
  const items = products || [];
  if (!items.length) return false;
  const loaded = await loadTemplates(client, companyId || undefined);
  const builtins = builtinLabelTemplates();
  const jobs: TemplateLabelJob[] = [];
  for (const item of items) {
    if (!item?.product) continue;
    const mapped = pickLineToLabelProduct(toLabelRecord(item.product));
    if (!mapped) continue;
    const info = resolveLabelTemplateInfo(loaded.list, mapped, builtins);
    if (!info.tpl) continue;
    const showPrice = priceShown(item.product, item.includePrice);
    const tpl = showPrice ? info.tpl : withoutPrice(info.tpl);
    const product = showPrice ? mapped : { ...mapped, sale_price: undefined };
    const copies = clampCopies(item.copies, 200);
    for (let i = 0; i < copies; i += 1) jobs.push({ tpl, product });
  }
  if (!jobs.length) return false;
  const filename = `etiket-${safePrintFilename(items[0]?.product?.sku || items[0]?.product?.name, "urun")}.pdf`;
  return deliverTemplateLabelHtml({
    title: "Ürün etiketleri",
    filename,
    jobs,
    company: (company?.name || company?.logo_url)
      ? { name: company?.name || undefined, logo_url: company?.logo_url || undefined }
      : undefined,
    mediaBase: client?.baseUrl || "",
    token: client?.token || null,
    mode,
  });
}

function shipmentJob(shipment: ShipmentLabelPdfInput, index: number, total: number): TemplateLabelJob {
  const orderNo = String(shipment.orderNo || "").trim();
  const customer = String(shipment.customer || "").trim();
  const address = String(shipment.address || "").trim();
  const box = `Koli ${index}/${total}`;
  const qr = String(shipment.qr || "").trim() || `SEVK:${orderNo || "SIP"}:${index}/${total}`;
  return {
    tpl: {
      id: "shipment-koli",
      name: "Koli etiketi",
      width_mm: SHIP_W_MM,
      height_mm: SHIP_H_MM,
      elements: [
        { type: "field", field: "text", text: orderNo, x: 2, y: 2, w: 70, h: 8, font: 14, bold: true, align: "left" },
        { type: "field", field: "text", text: customer, x: 2, y: 11, w: 70, h: 7, font: 11, align: "left" },
        { type: "field", field: "text", text: address, x: 2, y: 19, w: 70, h: 14, font: 9, align: "left" },
        { type: "field", field: "text", text: box, x: 2, y: 34, w: 70, h: 12, font: 16, bold: true, align: "left" },
        { type: "qr", x: 74, y: 2, w: 22, h: 22 },
      ],
    },
    product: { name: orderNo, sku: customer, barcode: qr },
  };
}

/** Her koli için bir sayfa; metin "Koli x/n". Sistem yazdırma veya PDF. */
export async function printShipmentLabelsPdf(
  client: ApiClient,
  companyId: string | null | undefined,
  shipment: ShipmentLabelPdfInput | null | undefined,
  mode: LabelPdfMode,
): Promise<boolean> {
  void companyId;
  if (!shipment) return false;
  const total = clampCopies(shipment.packageTotal ?? undefined, 200);
  const jobs: TemplateLabelJob[] = [];
  for (let index = 1; index <= total; index += 1) jobs.push(shipmentJob(shipment, index, total));
  const orderNo = String(shipment.orderNo || "").trim();
  const filename = `etiket-${safePrintFilename(orderNo, "koli")}.pdf`;
  return deliverTemplateLabelHtml({
    title: `Koli etiketi ${orderNo}`.trim(),
    filename,
    jobs,
    mediaBase: client?.baseUrl || "",
    token: client?.token || null,
    mode,
  });
}
