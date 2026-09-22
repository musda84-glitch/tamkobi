import type { Company, Order, Product } from "../types";
import { code128Svg } from "./code128";
import { fmtDate, fmtMoney } from "./money";
import {
  balanceSentence,
  isOrderQuotePrint,
  lineTotalIncl,
  printDiscountLabel,
  printNetAmount,
  printQtyLabel,
  printShelfLabel,
  printVatLines,
  vatRateLabel,
} from "./printFormLayout";

export type PrintCompany = Pick<Company, "name"> & {
  id?: string;
  _id?: string;
  address?: string;
  city?: string;
  phone?: string;
  email?: string;
  tax_number?: string;
  tax_office?: string;
  logo_url?: string | null;
  iban?: string;
  bank_name?: string;
};

export type PrintTemplate = {
  show_logo?: boolean;
  primary_color?: string;
  header_note?: string;
  footer_note?: string;
  show_bank_info?: boolean;
  show_tax_info?: boolean;
  show_signature?: boolean;
  show_barcode?: boolean;
  show_images?: boolean;
  font_size?: "xs" | "sm" | "base" | string;
  paper?: string;
  title_override?: string;
  layout?: "classic" | "modern" | "minimal" | "bold" | string;
  hide_line_prices?: boolean;
  hide_vat?: boolean;
  hide_all_prices?: boolean;
  show_item_notes?: boolean;
  show_order_notes?: boolean;
};

export type PrintProduct = Pick<Product, "barcode" | "sku" | "thumbnail_url" | "image_url" | "images"> & {
  id?: string;
  _id?: string;
};

export type PrintDocType = "order" | "quote" | "invoice" | "dispatch";

export type PrintPaymentRow = {
  no?: number | string;
  label?: string;
  due_date?: string;
  amount?: number;
  status?: string;
};

export type OrderFormOptions = {
  template?: Partial<PrintTemplate> | null;
  products?: Record<string, PrintProduct>;
  mediaBase?: string;
  docType?: PrintDocType;
  contactBalance?: number | null;
  paymentPlan?: PrintPaymentRow[] | null;
};

const DOC_TITLES: Record<PrintDocType, string> = {
  invoice: "FATURA",
  order: "SİPARİŞ FORMU",
  quote: "FİYAT TEKLİFİ",
  dispatch: "İRSALİYE",
};

export function printDocTitle(docType: PrintDocType, doc: Record<string, unknown> = {}, override?: string): string {
  if (override) return override;
  if (doc.e_type === "e_export" || doc.trade_kind === "export") return "e-İHRACAT FATURASI";
  if (doc.trade_kind === "import") return "İTHALAT FATURASI";
  return DOC_TITLES[docType] || "BELGE";
}

export function printDocNumber(docType: PrintDocType, doc: Record<string, unknown> = {}): string {
  if (docType === "quote") return String(doc.quote_number || doc.order_number || "");
  if (docType === "order") return String(doc.order_number || "");
  return String(doc.invoice_number || doc.quote_number || doc.order_number || "");
}

export const DEFAULT_PRINT_TEMPLATE: PrintTemplate = {
  show_logo: true,
  primary_color: "#059669",
  header_note: "",
  footer_note: "Bizi tercih ettiğiniz için teşekkür ederiz.",
  show_bank_info: true,
  show_tax_info: true,
  show_signature: true,
  show_barcode: true,
  show_images: true,
  font_size: "sm",
  paper: "A4",
  title_override: "",
  layout: "classic",
  hide_line_prices: false,
  hide_vat: false,
  hide_all_prices: false,
  show_item_notes: true,
  show_order_notes: true,
};

export function mergePrintTemplate(raw?: Partial<PrintTemplate> | null): PrintTemplate {
  return { ...DEFAULT_PRINT_TEMPLATE, ...(raw || {}) };
}

function esc(value: unknown): string {
  return String(value ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

function num(value: unknown, fallback = 0): number {
  const n = Number(value);
  return Number.isFinite(n) ? n : fallback;
}

function rec(item: Record<string, unknown>): Record<string, unknown> {
  return item || {};
}

type PrintLine = {
  name: string;
  qty: number;
  unit: string;
  price: number;
  priceIncl: number;
  total: number;
  totalIncl: number;
  vat: number;
  sku?: string;
  barcode?: string;
  image?: string;
  note?: string;
  discount?: number;
  gtip?: string;
  origin?: string;
  shelf?: string;
  raw?: Record<string, unknown>;
};

function pickItemImage(it: Record<string, unknown>, prod?: PrintProduct): string {
  const images = Array.isArray(it.images) ? it.images : [];
  const prodImages = Array.isArray(prod?.images) ? prod.images : [];
  return String(
    it.print_image_url || it.thumbnail_url || it.image_url || prod?.thumbnail_url || prod?.image_url || images[0] || prodImages[0] || "",
  );
}

function printThumbUrl(raw: string, mediaBase?: string): string {
  const s = String(raw || "").trim();
  if (!s) return "";
  let resolved = s;
  if (!/^(https?:|data:|blob:)/i.test(s) && mediaBase) {
    const origin = mediaBase.replace(/\/$/, "");
    resolved = s.startsWith("/") ? `${origin}${s}` : `${origin}/api/files/${s.replace(/^\/+/, "")}`;
  }
  try {
    const u = new URL(resolved);
    if (/unsplash\.com|images\.pexels\.com|cloudinary\.com/i.test(u.hostname) || u.searchParams.has("w")) {
      u.searchParams.set("w", "128");
      if (!u.searchParams.has("q") && /unsplash/i.test(u.hostname)) u.searchParams.set("q", "60");
      return u.toString();
    }
  } catch {
    /* keep */
  }
  return resolved;
}

function itemsOf(order: Order, products: Record<string, PrintProduct> = {}, mediaBase?: string): PrintLine[] {
  return (order.items || []).map((raw) => {
    const it = rec(raw as Record<string, unknown>);
    const prod = products[String(it.product_id || "")] || {};
    const vat = num(it.vat_rate, 20);
    const price = num(it.unit_price);
    const priceIncl = num(it.unit_price_incl, price * (1 + vat / 100));
    const total = num(it.total, num(it.quantity) * price);
    return {
      name: String(it.product_name || it.name || "Kalem"),
      qty: num(it.quantity),
      unit: String(it.unit || ""),
      price,
      priceIncl,
      total,
      totalIncl: num(it.total_incl, total * (1 + vat / 100)),
      vat,
      sku: it.sku || prod.sku ? String(it.sku || prod.sku) : undefined,
      barcode: it.barcode || prod.barcode ? String(it.barcode || prod.barcode) : undefined,
      image: printThumbUrl(pickItemImage(it, prod), mediaBase),
      note: String(it.note || it.notes || it.description || it.line_note || ""),
      discount: num(it.discount_rate),
      gtip: it.gtip ? String(it.gtip) : undefined,
      origin: it.origin_country ? String(it.origin_country) : undefined,
      shelf: printShelfLabel(it, prod as Record<string, unknown>),
      raw: it,
    };
  });
}

function money(n: unknown, currency?: string): string {
  return fmtMoney(n, currency || "TRY");
}

function customerOrderNo(order: Order): string {
  const extra = order as Order & {
    po_number?: string;
    buyer_order_number?: string;
    external_order_number?: string;
    customer_po?: string;
  };
  return String(
    extra.customer_order_number || extra.po_number || extra.buyer_order_number || extra.external_order_number || extra.customer_po || "",
  ).trim();
}

function orderDate(order: Order): string {
  const extra = order as Order & { issue_date?: string };
  return String(extra.issue_date || order.order_date || order.created_at || "").slice(0, 10) || fmtDate(order.order_date);
}

function quoteExtras(order: Order): { validUntil?: string; dueDate?: string; subject?: string; terms?: string } {
  const extra = order as Order & { valid_until?: string; due_date?: string; title?: string; terms?: string };
  return {
    validUntil: extra.valid_until ? String(extra.valid_until) : undefined,
    dueDate: extra.due_date ? String(extra.due_date) : undefined,
    subject: extra.title ? String(extra.title) : undefined,
    terms: extra.terms ? String(extra.terms) : undefined,
  };
}

export function orderFormHtml(order: Order, company?: PrintCompany | null, options?: OrderFormOptions): string {
  const tpl = mergePrintTemplate(options?.template);
  const lines = itemsOf(order, options?.products || {}, options?.mediaBase);
  const rawItems = (order.items || []) as Record<string, unknown>[];
  const layout = tpl.layout || "classic";
  const color = layout === "minimal" ? "#0f172a" : tpl.primary_color || "#059669";
  const hideAll = !!tpl.hide_all_prices;
  const hideLine = hideAll || !!tpl.hide_line_prices;
  const hideVat = hideAll || !!tpl.hide_vat;
  const fontSize = tpl.font_size === "xs" ? "10px" : tpl.font_size === "base" ? "14px" : "12px";
  const isModern = layout === "modern";
  const isMinimal = layout === "minimal";
  const isBold = layout === "bold";
  const docType = options?.docType || "order";
  const compact = isOrderQuotePrint(docType);
  const doc = order as Order & Record<string, unknown>;
  const title = printDocTitle(docType, doc, tpl.title_override);
  const number = printDocNumber(docType, { ...doc, quote_number: doc.quote_number || (docType === "quote" ? order.order_number : "") });
  const extras = quoteExtras(order);
  const currency = doc.currency as string | undefined;
  const thBg = isMinimal ? "transparent" : isBold ? "#0f172a" : color;
  const thColor = isMinimal ? "#0f172a" : "#fff";
  const thBorder = isMinimal ? "border-bottom:2px solid #0f172a;" : "";
  const customer = order.contact_name || order.customer_name || "";
  const total = order.grand_total ?? order.total_amount ?? 0;
  const custNo = customerOrderNo(order);
  const orderNotes = [order.customer_note, order.order_note, order.customer_notes].filter(Boolean);
  const showImages = tpl.show_images !== false;
  const showBarcode = tpl.show_barcode !== false;
  const vatLines = printVatLines(doc, rawItems);
  const netAmount = printNetAmount(doc, rawItems);
  const balanceText = !hideAll ? balanceSentence(options?.contactBalance) : "";
  const shipAddr = order.shipping_address || String(doc.address || "");
  const logo = tpl.show_logo && company?.logo_url
    ? `<img src="${esc(printThumbUrl(company.logo_url, options?.mediaBase))}" alt="logo" style="height:56px;object-fit:contain;${isModern ? "background:#fff;border-radius:8px;padding:4px;" : ""}"/>`
    : "";
  const tax = tpl.show_tax_info && (company?.tax_office || company?.tax_number)
    ? `<div style="opacity:${isModern ? "0.8" : "1"};color:${isModern ? "#fff" : "#64748b"}">VD: ${esc(company?.tax_office || "")} • VKN: ${esc(company?.tax_number || "")}</div>`
    : "";
  const companyMeta = `
    <div>
      <div style="font-size:16px;font-weight:700;color:${isModern ? "#fff" : color}">${esc(company?.name || "")}</div>
      <div style="color:${isModern ? "rgba(255,255,255,.8)" : "#64748b"}">${esc(company?.address || "")} ${esc(company?.city || "")}</div>
      ${tax}
      <div style="color:${isModern ? "rgba(255,255,255,.8)" : "#64748b"}">${[company?.phone, company?.email].filter(Boolean).map(esc).join(" • ")}</div>
    </div>`;
  const headerRight = `
    <div style="text-align:right">
      <div style="font-size:${isBold ? "28px" : "24px"};font-weight:900;letter-spacing:-0.3px;color:${isModern ? "#fff" : isBold ? "#0f172a" : color}">${esc(title)}</div>
      <div style="font-family:ui-monospace,monospace;font-weight:600;color:${isModern ? "#fff" : "#0f172a"}">${esc(number)}</div>
      <div style="color:${isModern ? "rgba(255,255,255,.8)" : "#64748b"}">Tarih: ${esc(orderDate(order))}</div>
      ${extras.validUntil ? `<div style="color:${isModern ? "rgba(255,255,255,.8)" : "#64748b"}">Geçerlilik: ${esc(extras.validUntil)}</div>` : ""}
      ${extras.dueDate ? `<div style="color:${isModern ? "rgba(255,255,255,.8)" : "#64748b"}">Vade: ${esc(extras.dueDate)}</div>` : ""}
    </div>`;
  const header = isModern
    ? `<div style="padding:24px 40px;color:#fff;display:flex;justify-content:space-between;align-items:flex-start;background:${color}">
        <div style="display:flex;align-items:center;gap:12px">${logo}${companyMeta}</div>${headerRight}
      </div>`
    : `<div style="display:flex;justify-content:space-between;align-items:flex-start;padding-bottom:16px;${isMinimal ? "border-bottom:1px solid #0f172a" : `border-bottom:4px solid ${color}`}">
        <div style="display:flex;align-items:center;gap:12px">${logo}${companyMeta}</div>${headerRight}
      </div>`;

  const tradeMeta = [doc.incoterm, doc.country, doc.customs_office, doc.regime_code && `Rejim ${doc.regime_code}`, doc.declaration_no && `Bey. ${doc.declaration_no}`, doc.bl_awb && `BL ${doc.bl_awb}`, doc.dab_no && `DAB ${doc.dab_no}`, doc.certificate, doc.trade_file_number]
    .filter(Boolean)
    .map((v) => esc(v))
    .join(" · ");

  const compactRows = lines.map((it, i) => {
    const code = showBarcode ? it.barcode || it.sku || "" : "";
    const img = showImages ? it.image : "";
    const note = tpl.show_item_notes !== false && it.note
      ? `<div style="font-size:10px;color:#64748b;font-style:italic;white-space:pre-wrap">${esc(it.note)}</div>`
      : "";
    const gtip = it.gtip
      ? `<div style="font-size:10px;font-family:monospace;color:#94a3b8">GTIP ${esc(it.gtip)}${it.origin ? ` · ${esc(it.origin)}` : ""}</div>`
      : "";
    const barcodeCell = !showBarcode
      ? ""
      : `<td style="padding:8px 4px;vertical-align:middle;text-align:center">${code
        ? `<div style="display:flex;flex-direction:column;align-items:center;gap:2px">${code128Svg(code, { height: 28, moduleWidth: 1.1, margin: 4, displayValue: false })}<span style="font-family:monospace;font-size:10px;color:#334155">${esc(code)}</span></div>`
        : ""}</td>`;
    const priceCells = hideLine
      ? ""
      : `<td style="padding:12px 8px;text-align:right;white-space:nowrap">${esc(money(it.price, currency))}</td>
         <td style="padding:12px 8px;text-align:right;white-space:nowrap">${esc(printDiscountLabel(it.discount))}</td>
         ${hideVat ? "" : `<td style="padding:12px 8px;text-align:right;white-space:nowrap">%${esc(it.vat)}</td>`}
         <td style="padding:12px 8px 12px 8px;text-align:right;white-space:nowrap">${esc(money(hideVat ? it.total : lineTotalIncl(it.raw || { total: it.total, total_incl: it.totalIncl, vat_rate: it.vat }), currency))}</td>`;
    return `<tr style="border-bottom:1px solid #e2e8f0" data-print-item="${i}">
      <td style="padding:12px 8px 12px 0;vertical-align:middle">
        <div style="display:flex;align-items:center;gap:10px;min-width:0">
          <span style="width:16px;flex-shrink:0;font-size:12px;color:#64748b">${i + 1}</span>
          ${showImages ? (img
            ? `<img src="${esc(img)}" alt="" width="44" height="44" style="width:44px;height:44px;object-fit:contain;background:#fff;flex-shrink:0"/>`
            : `<span style="display:block;width:44px;height:44px;background:#f8fafc;flex-shrink:0"></span>`) : ""}
          <div style="min-width:0"><div style="font-weight:700;color:#0f172a">${esc(it.name)}</div>${gtip}${note}</div>
        </div>
      </td>
      <td style="padding:12px 8px;vertical-align:middle;white-space:nowrap;color:#334155">${esc(it.shelf || "")}</td>
      ${barcodeCell}
      <td style="padding:12px 8px;text-align:right;vertical-align:middle;white-space:nowrap">${esc(printQtyLabel(it.qty, it.unit))}</td>
      ${priceCells}
    </tr>`;
  }).join("");

  const compactHead = `<tr style="color:#0f172a;border-bottom:1px solid #94a3b8">
      <th style="text-align:left;padding:8px 8px 8px 0;font-weight:600">Açıklama</th>
      <th style="text-align:left;padding:8px;font-weight:600;white-space:nowrap">Raf Yeri</th>
      ${showBarcode ? `<th style="text-align:center;padding:8px;font-weight:600;white-space:nowrap">Barkod</th>` : ""}
      <th style="text-align:right;padding:8px;font-weight:600;white-space:nowrap">Miktar</th>
      ${hideLine ? "" : `<th style="text-align:right;padding:8px;font-weight:600">Fiyat</th>
        <th style="text-align:right;padding:8px;font-weight:600;white-space:nowrap">İndirim (%)</th>
        ${hideVat ? "" : `<th style="text-align:right;padding:8px;font-weight:600;white-space:nowrap">KDV (%)</th>`}
        <th style="text-align:right;padding:8px 0 8px 8px;font-weight:600;white-space:nowrap">${hideVat ? "Tutar" : "Tutar (KDV Dahil)"}</th>`}
    </tr>`;

  const widePriceHeads = hideLine
    ? ""
    : `<th style="text-align:right;padding:8px">Birim (KDV'siz)</th>${
        hideVat ? "" : `<th style="text-align:right;padding:8px">Birim (KDV'li)</th><th style="text-align:right;padding:8px">KDV</th>`
      }<th style="text-align:right;padding:8px">${hideVat ? "Tutar" : "Tutar Hariç"}</th>${
        hideVat ? "" : `<th style="text-align:right;padding:8px">Tutar Dahil</th>`
      }`;

  const wideRows = lines.map((it, i) => {
    const code = showBarcode ? it.barcode || it.sku || "" : "";
    const img = showImages ? it.image : "";
    const zebra = isBold && i % 2 ? "background:#f8fafc;" : "";
    const note = tpl.show_item_notes !== false && it.note
      ? `<div style="font-size:10px;color:#64748b;font-style:italic;white-space:pre-wrap">${esc(it.note)}</div>`
      : "";
    const disc = !hideLine && it.discount && it.discount > 0
      ? `<span style="margin-left:4px;font-size:10px;color:#e11d48;font-weight:400">(%${esc(it.discount)} isk.)</span>`
      : "";
    const gtip = it.gtip
      ? `<div style="font-size:10px;font-family:monospace;color:#94a3b8">GTIP ${esc(it.gtip)}${it.origin ? ` · ${esc(it.origin)}` : ""}</div>`
      : "";
    const barcodeCell = code
      ? `<div style="display:flex;flex-direction:column;align-items:center;gap:4px;min-width:12rem;width:200px;padding:4px 0;background:#fff">${code128Svg(code, { height: 40, moduleWidth: 1.3, margin: 6, displayValue: false }) }<span style="font-family:monospace;font-size:11px;color:#334155;letter-spacing:.4px">${esc(code)}</span></div>`
      : `<span style="color:#cbd5e1">—</span>`;
    const priceCells = hideLine
      ? ""
      : `<td style="padding:8px;text-align:right">${esc(money(it.price, currency))}</td>${
          hideVat ? "" : `<td style="padding:8px;text-align:right">${esc(money(it.priceIncl, currency))}</td><td style="padding:8px;text-align:right">%${esc(it.vat)}</td>`
        }<td style="padding:8px;text-align:right;font-weight:600">${esc(money(it.total, currency))}</td>${
          hideVat ? "" : `<td style="padding:8px;text-align:right;font-weight:700">${esc(money(it.totalIncl, currency))}</td>`
        }`;
    return `<tr style="border-bottom:1px solid #f1f5f9;${zebra}" data-print-item="${i}">
      <td style="padding:8px;vertical-align:middle">${img ? `<img src="${esc(img)}" alt="" width="64" height="64" style="width:64px;height:64px;object-fit:contain;border:1px solid #e2e8f0;border-radius:6px;background:#fff"/>` : `<div style="width:64px;height:64px;border:1px dashed #e2e8f0;border-radius:6px;background:#f8fafc"></div>`}</td>
      <td style="padding:8px;vertical-align:middle"><div style="font-weight:600;color:#0f172a">${esc(it.name)}${disc}</div>${gtip}${note}</td>
      <td style="padding:8px;vertical-align:middle">${barcodeCell}</td>
      <td style="padding:8px;text-align:right;vertical-align:middle">${esc(it.qty)} ${esc(it.unit)}</td>
      ${priceCells}
    </tr>`;
  }).join("");

  const itemsTable = compact
    ? `<table data-print-items="compact" style="width:100%;border-collapse:collapse;margin-top:24px">
        <thead>${compactHead}</thead>
        <tbody>${compactRows || `<tr><td colspan="8" style="padding:8px">Kalem yok</td></tr>`}</tbody>
      </table>`
    : `<table data-print-items="wide" style="width:100%;border-collapse:collapse;margin-top:24px${isModern ? ";overflow:hidden;border-radius:12px" : ""}">
        <thead><tr style="background:${thBg};color:${thColor};${thBorder}">
          <th style="padding:8px;width:80px;text-align:left">Resim</th>
          <th style="padding:8px;text-align:left">Açıklama</th>
          <th style="padding:8px;width:200px;text-align:left">Barkod</th>
          <th style="padding:8px;text-align:right">Miktar</th>
          ${widePriceHeads}
        </tr></thead>
        <tbody>${wideRows || `<tr><td colspan="8" style="padding:8px">Kalem yok</td></tr>`}</tbody>
      </table>`;

  const compactVat = !hideVat
    ? vatLines.map((line) => `<div style="display:flex;justify-content:space-between;gap:32px"><span>${esc(vatRateLabel(line.rate))}</span><span>${esc(money(line.amount, currency))}</span></div>`).join("")
    : "";
  const withhold = num(doc.withholding_amount) > 0
    ? `<div style="display:flex;justify-content:space-between;gap:32px;color:#4338ca"><span>Tevkifat</span><span>-${esc(money(doc.withholding_amount, currency))}</span></div>`
    : "";
  const totalsInner = hideAll
    ? ""
    : compact
      ? `<div style="min-width:16rem;font-size:14px">
          ${num(order.discount_total) > 0 ? `<div style="display:flex;justify-content:space-between;gap:32px;color:#e11d48"><span>İskonto</span><span>-${esc(money(order.discount_total, currency))}</span></div>` : ""}
          ${!hideVat ? `<div data-print-net style="display:flex;justify-content:space-between;gap:32px"><span>Net</span><span>${esc(money(netAmount, currency))}</span></div>` : ""}
          ${compactVat}
          ${withhold}
          <div data-print-grand-total style="display:flex;justify-content:space-between;gap:32px;font-size:18px;font-weight:900;border-top:1px solid #cbd5e1;padding-top:4px;margin-top:4px"><span>Toplam</span><span>${esc(money(total, currency))}</span></div>
        </div>`
      : `<div style="width:260px;${isModern ? `background:${color}14;border-radius:12px;padding:12px;` : ""}">
          ${num(order.discount_total) > 0 ? `<div style="display:flex;justify-content:space-between;color:#e11d48"><span>İskonto</span><span>-${esc(money(order.discount_total, currency))}</span></div>` : ""}
          ${!hideVat && order.subtotal !== undefined ? `<div data-print-net style="display:flex;justify-content:space-between"><span style="color:#64748b">Ara Toplam (KDV Hariç)</span><span>${esc(money(order.subtotal, currency))}</span></div>` : ""}
          ${!hideVat && order.vat_total !== undefined ? `<div style="display:flex;justify-content:space-between"><span style="color:#64748b">KDV</span><span>${esc(money(order.vat_total, currency))}</span></div>` : ""}
          ${withhold}
          <div data-print-grand-total style="display:flex;justify-content:space-between;font-size:16px;font-weight:900;border-top:2px solid ${color};padding-top:4px;margin-top:4px"><span>${hideVat ? "TOPLAM" : "GENEL TOPLAM (KDV Dahil)"}</span><span style="color:${color}">${esc(money(total, currency))}</span></div>
        </div>`;
  const totals = (compact ? (balanceText || !hideAll) : !hideAll)
    ? `<div data-print-totals style="margin-top:16px;display:flex;align-items:flex-start;justify-content:${compact ? "space-between" : "flex-end"};gap:24px">
        ${compact ? `<div data-print-balance style="padding-top:4px;font-size:14px;color:#1e293b">${esc(balanceText)}</div>` : ""}
        ${totalsInner}
      </div>`
    : "";

  const notesBox = tpl.show_order_notes !== false && orderNotes.length
    ? `<div style="margin-top:12px;background:#fffbeb;border:1px solid #fde68a;border-radius:8px;padding:8px;color:#334155;white-space:pre-wrap"><b>Sipariş Notu:</b> ${esc(orderNotes.join(" • "))}</div>`
    : "";
  const extraNotes = (order.notes || extras.terms)
    ? `<div style="margin-top:24px;color:#475569;white-space:pre-wrap">${order.notes ? esc(order.notes) : ""}${extras.terms ? `<div style="margin-top:8px"><b>Şartlar:</b> ${esc(extras.terms)}</div>` : ""}</div>`
    : "";
  const bank = tpl.show_bank_info && company?.iban
    ? `<div style="margin-top:24px;color:#475569"><b>Banka:</b> ${esc(company.bank_name || "")} • <b>IBAN:</b> <span style="font-family:monospace">${esc(company.iban)}</span></div>`
    : "";
  const plan = (options?.paymentPlan || []).length
    ? `<div data-print-payment-plan style="margin-top:24px">
        <div style="font-size:10px;text-transform:uppercase;font-weight:700;color:#94a3b8;margin-bottom:4px">Ödeme Planı (${options!.paymentPlan!.length} taksit)</div>
        <table style="width:100%;border-collapse:collapse">${options!.paymentPlan!.map((r) => `<tr style="border-bottom:1px solid #f1f5f9"><td style="padding:4px 0;font-weight:600">${esc(r.label || "")}</td><td style="padding:4px 0;color:#64748b;font-family:ui-monospace,monospace">${esc(r.due_date || "")}</td><td style="padding:4px 0;text-align:right;font-weight:600">${esc(money(r.amount, "TRY"))}</td><td style="padding:4px 0;text-align:right;width:80px">${r.status === "paid" ? `<span style="color:#047857;font-weight:700">Ödendi</span>` : r.status ? `<span style="color:#94a3b8">Bekliyor</span>` : ""}</td></tr>`).join("")}</table>
      </div>`
    : "";
  const docImages = Array.isArray(doc.images) ? (doc.images as unknown[]).slice(0, 8) : [];
  const gallery = docImages.length
    ? `<div style="margin-top:24px;display:grid;grid-template-columns:repeat(4,1fr);gap:8px">${docImages.map((img) => `<img src="${esc(printThumbUrl(String(img), options?.mediaBase))}" alt="" style="width:100%;height:96px;object-fit:cover;border-radius:8px;border:1px solid #e2e8f0"/>`).join("")}</div>`
    : "";
  const footer = `<div style="margin-top:40px;display:flex;justify-content:space-between;align-items:flex-end">
    <div style="color:#94a3b8;font-style:italic">${esc(tpl.footer_note || "")}</div>
    ${tpl.show_signature ? `<div style="text-align:center"><div style="width:160px;border-bottom:1px solid #cbd5e1;margin-bottom:4px"></div><div style="color:#64748b">Kaşe / İmza</div></div>` : ""}
  </div>`;

  const subjectBox = extras.subject
    ? `<div style="text-align:right"><div style="font-size:10px;text-transform:uppercase;font-weight:700;color:#94a3b8;margin-bottom:4px">Konu</div><div style="font-weight:600">${esc(extras.subject)}</div></div>`
    : "";

  return `<div data-print="${docType}" data-print-paper="${esc(tpl.paper || "A4")}" style="font-size:${fontSize};color:#1e293b;display:flex;font-family:-apple-system,Roboto,'Segoe UI','Noto Sans','Liberation Sans',Arial,Helvetica,sans-serif">
    ${isBold ? `<div style="width:12px;align-self:stretch;background:${color}"></div>` : ""}
    <div style="flex:1;${isModern ? "" : "padding:40px"}">
      ${header}
      <div style="${isModern ? "padding:0 40px 40px" : ""}">
        ${tpl.header_note ? `<p style="margin:12px 0 0;color:#475569;font-style:italic">${esc(tpl.header_note)}</p>` : ""}
        <div style="margin-top:20px;display:grid;grid-template-columns:1fr 1fr;gap:24px">
          <div>
            <div style="font-size:10px;text-transform:uppercase;font-weight:700;color:#94a3b8;margin-bottom:4px">Sayın</div>
            <div style="font-weight:700;font-size:16px">${esc(customer || "—")}</div>
            ${shipAddr || order.city ? `<div style="color:#64748b">${esc(shipAddr)} ${esc(order.city || "")}</div>` : ""}
            ${order.customer_phone ? `<div style="color:#64748b">${esc(order.customer_phone)}</div>` : ""}
            ${custNo ? `<div style="margin-top:8px;display:inline-block;border:1px solid #a7f3d0;background:#ecfdf5;border-radius:8px;padding:4px 8px;font-size:12px;font-weight:600;color:#064e3b">Müşteri sipariş no: <span style="font-family:monospace">${esc(custNo)}</span></div>` : ""}
            ${tradeMeta ? `<div style="color:#64748b;margin-top:4px">${tradeMeta}</div>` : ""}
          </div>
          ${subjectBox}
        </div>
        ${itemsTable}
        ${notesBox}
        ${totals}
        ${plan}
        ${extraNotes}
        ${gallery}
        ${bank}
        ${footer}
      </div>
    </div>
  </div>`;
}

export function cargoLabelCode(order: Order): string {
  return String(order.cargo_barcode || order.cargo_tracking_number || order.order_number || "").trim();
}

export function cargoLabelHtml(order: Order, company?: PrintCompany | null): string {
  const code = cargoLabelCode(order);
  const pieces = itemsOf(order).reduce((s, it) => s + it.qty, 0);
  const items = (order.items || []).map((raw) => {
    const it = rec(raw as Record<string, unknown>);
    const sku = it.sku ? ` <span class="muted">[${esc(it.sku)}]</span>` : "";
    return `${esc(it.quantity)}× ${esc(it.product_name || it.name || "Kalem")}${sku}`;
  }).join("<br>");
  const barcode = code
    ? code128Svg(code, { height: 46, moduleWidth: 1.6, margin: 10, displayValue: true, fontSize: 11 })
    : `<div class="mono">—</div>`;
  const track = order.cargo_tracking_number ? `Takip: ${esc(order.cargo_tracking_number)}` : "";
  const cod = order.payment_type === "cod" ? `${track ? " · " : ""}KAPIDA ÖDEME` : "";
  return `<section class="label">
      <div class="top"><div><div class="carrier">${esc(order.cargo_carrier_name || order.cargo_carrier || "KARGO")}</div><div class="muted">${esc(order.channel ? String(order.channel).toUpperCase() : "")} · ${esc(order.order_number || "")}</div></div><div class="qty">${esc(pieces)} adet</div></div>
      <div class="box"><div class="lbl">ALICI</div><div class="name">${esc(order.customer_name || "—")}</div><div>${esc(order.shipping_address || "")}</div><div class="city">${esc([order.district, order.city].filter(Boolean).join(" / "))}</div>${order.customer_phone ? `<div>Tel: ${esc(order.customer_phone)}</div>` : ""}</div>
      <div class="box small"><div class="lbl">GÖNDERİCİ</div><b>${esc(company?.name || "")}</b> ${esc(company?.address || "")}${company?.phone ? " · " + esc(company.phone) : ""}</div>
      <div class="items">${items}</div>
      <div class="bc">${barcode}</div>
      <div class="foot">${track}${cod}</div>
    </section>`;
}

export function orderFormText(order: Order, company?: PrintCompany | null): string {
  const lines = itemsOf(order).map((it) => `  ${it.qty} × ${it.name}  ${fmtMoney(it.totalIncl || it.total)}`);
  return [
    "SİPARİŞ FORMU",
    company?.name || "",
    `${order.order_number || "Sipariş"} · ${fmtDate(order.order_date)}`,
    `Müşteri: ${order.customer_name || "—"}`,
    [order.shipping_address, order.city, order.customer_phone].filter(Boolean).join(" · "),
    "",
    ...lines,
    "",
    `Toplam ${fmtMoney(order.grand_total || order.total_amount)}`,
    order.notes ? `Not: ${order.notes}` : "",
  ].filter((x) => x !== "").join("\n");
}

export function cargoLabelText(order: Order, company?: PrintCompany | null): string {
  const track = cargoLabelCode(order) || "Kargo oluşturulmadı";
  return [
    `KARGO ETİKETİ · ${order.order_number || ""}`,
    `Alıcı: ${order.customer_name || "—"}`,
    [order.shipping_address, order.city, order.customer_phone].filter(Boolean).join(" · "),
    `Gönderici: ${company?.name || ""}`,
    `Takip: ${track}`,
  ].filter(Boolean).join("\n");
}

export type PrintPageKind = "default" | "a4" | "thermal";
export type PrintPaper = "A4" | "A5" | string;

export function printPageSize(paper?: PrintPaper | null): PrintPaper {
  return paper === "A5" ? "A5" : "A4";
}

export function thermalLabelCss(size = "100x150"): string {
  const [w, h] = size.split("x").map(Number);
  const width = Number.isFinite(w) ? w : 100;
  const height = Number.isFinite(h) ? h : 150;
  return `@page{size:${width}mm ${height}mm;margin:0}html,body{margin:0;padding:0;font-family:Arial,Helvetica,sans-serif;color:#000;background:#777}.label{width:${width}mm;height:${height}mm;box-sizing:border-box;padding:4mm;background:#fff;page-break-after:always;display:flex;flex-direction:column;gap:2.2mm;overflow:hidden;margin:0 auto 4mm}
  @media print{body{background:#fff}.label{margin:0}}.top{display:flex;justify-content:space-between;align-items:flex-start;border-bottom:2px solid #000;padding-bottom:1.5mm}.carrier{font-size:15pt;font-weight:900;text-transform:uppercase}.qty{font-size:12pt;font-weight:800;border:2px solid #000;padding:1mm 2mm;border-radius:2mm}
  .box{border:1.5px solid #000;border-radius:2mm;padding:2mm;font-size:10pt;line-height:1.25}.box.small{font-size:7.5pt;border-style:dashed}.lbl{font-size:7pt;font-weight:800;letter-spacing:.5px;color:#444}.name{font-size:13pt;font-weight:900}.city{font-size:12pt;font-weight:800;margin-top:.5mm}
  .items{font-size:8pt;flex:1;overflow:hidden;line-height:1.3}.muted{color:#555}.bc{text-align:center}.bc svg{max-width:100%;height:auto}.foot{font-size:8pt;text-align:center;border-top:1px solid #000;padding-top:1mm}.mono{font-family:monospace;font-size:14pt;font-weight:800}`;
}

export function safePrintFilename(raw: unknown, fallback: string): string {
  const cleaned = String(raw || "").replace(/[^\w.-]+/g, "_").replace(/^_+|_+$/g, "");
  return cleaned || fallback;
}

export function orderPdfFilename(order: { order_number?: string } | null | undefined): string {
  return `${safePrintFilename(order?.order_number, "siparis")}.pdf`;
}

export function cargoLabelFilename(order: { order_number?: string } | null | undefined, ext = "pdf"): string {
  return `kargo-${safePrintFilename(order?.order_number, "etiket")}.${ext}`;
}

export function officialLabelFileMeta(type?: string | null, bytes?: Uint8Array | null): {
  mime: string;
  ext: string;
  kind: "pdf" | "image" | "file";
} {
  const t = String(type || "").toLowerCase();
  const b = bytes || new Uint8Array();
  const pdfMagic = b.length >= 4 && b[0] === 0x25 && b[1] === 0x50 && b[2] === 0x44 && b[3] === 0x46;
  const pngMagic = b.length >= 4 && b[0] === 0x89 && b[1] === 0x50 && b[2] === 0x4e && b[3] === 0x47;
  const jpegMagic = b.length >= 3 && b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff;
  const gifMagic = b.length >= 3 && b[0] === 0x47 && b[1] === 0x49 && b[2] === 0x46;
  const webpMagic = b.length >= 12 && b[0] === 0x52 && b[1] === 0x49 && b[2] === 0x46 && b[3] === 0x46
    && b[8] === 0x57 && b[9] === 0x45 && b[10] === 0x42 && b[11] === 0x50;
  if (/pdf/.test(t) || pdfMagic) return { mime: "application/pdf", ext: "pdf", kind: "pdf" };
  if (/png/.test(t) || pngMagic) return { mime: "image/png", ext: "png", kind: "image" };
  if (/jpe?g/.test(t) || jpegMagic) return { mime: "image/jpeg", ext: "jpg", kind: "image" };
  if (/webp/.test(t) || webpMagic) return { mime: "image/webp", ext: "webp", kind: "image" };
  if (/gif/.test(t) || gifMagic) return { mime: "image/gif", ext: "gif", kind: "image" };
  return { mime: t || "application/octet-stream", ext: "bin", kind: "file" };
}

/** Native expo-print belgesi — window.print scripti yok. */
export function printDocumentHtml(
  title: string,
  bodyHtml: string,
  page: PrintPageKind = "a4",
  paper?: PrintPaper | null,
): string {
  return `<!doctype html><html lang="tr"><head><meta charset="utf-8"><title>${esc(title)}</title>
    <style>${documentCss(page, paper)}</style>
    </head><body>${bodyHtml}</body></html>`;
}

function documentCss(page: PrintPageKind, paper?: PrintPaper | null): string {
  if (page === "thermal") return thermalLabelCss();
  if (page === "a4") {
    const size = printPageSize(paper);
    return `@page{size:${size};margin:10mm}html,body{margin:0;padding:0;font-family:Arial,Helvetica,sans-serif;color:#0f172a;background:#fff}@media print{body{padding:0}}`;
  }
  return `body{font-family:Arial,Helvetica,sans-serif;color:#0f172a;padding:16px;margin:0}@media print{body{padding:8px}}`;
}

function printHtmlIframe(html: string): boolean {
  if (typeof document === "undefined") return false;
  const iframe = document.createElement("iframe");
  iframe.setAttribute("aria-hidden", "true");
  iframe.style.cssText = "position:fixed;right:0;bottom:0;width:0;height:0;border:0";
  document.body.appendChild(iframe);
  const win = iframe.contentWindow;
  if (!win) {
    iframe.remove();
    return false;
  }
  win.document.open();
  win.document.write(html);
  win.document.close();
  const cleanup = () => { try { iframe.remove(); } catch { /* already gone */ } };
  win.addEventListener("afterprint", cleanup);
  setTimeout(() => {
    try {
      win.focus();
      win.print();
    } catch {
      cleanup();
    }
  }, 300);
  setTimeout(cleanup, 60_000);
  return true;
}

export function openPrintHtml(title: string, bodyHtml: string, opts?: { page?: PrintPageKind; paper?: PrintPaper | null }): boolean {
  if (typeof document === "undefined") return false;
  const page = opts?.page || "default";
  const html = `<!doctype html><html lang="tr"><head><meta charset="utf-8"><title>${esc(title)}</title>
    <style>${documentCss(page, opts?.paper)}</style>
    </head><body>${bodyHtml}<script>window.onload=function(){setTimeout(function(){window.print()},${page === "thermal" ? 300 : 250})}</script></body></html>`;
  if (typeof window !== "undefined" && typeof window.open === "function") {
    try {
      const w = window.open("", "_blank", page === "thermal" ? "width=720,height=900" : "width=800,height=900");
      if (w) {
        w.document.write(html);
        w.document.close();
        return true;
      }
    } catch {
      /* popup blocked — iframe */
    }
  }
  return printHtmlIframe(html);
}
