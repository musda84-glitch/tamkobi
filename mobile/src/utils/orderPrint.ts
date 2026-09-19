import type { Company, Order, Product } from "../types";
import { code128Svg } from "./code128";
import { fmtDate, fmtMoney } from "./money";

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

export type OrderFormOptions = {
  template?: Partial<PrintTemplate> | null;
  products?: Record<string, PrintProduct>;
  mediaBase?: string;
};

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
};

function pickItemImage(it: Record<string, unknown>, prod?: PrintProduct): string {
  const images = Array.isArray(it.images) ? it.images : [];
  const prodImages = Array.isArray(prod?.images) ? prod.images : [];
  return String(
    it.thumbnail_url || it.image_url || prod?.thumbnail_url || prod?.image_url || images[0] || prodImages[0] || "",
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
  return String(order.order_date || order.created_at || "").slice(0, 10) || fmtDate(order.order_date);
}

export function orderFormHtml(order: Order, company?: PrintCompany | null, options?: OrderFormOptions): string {
  const tpl = mergePrintTemplate(options?.template);
  const lines = itemsOf(order, options?.products || {}, options?.mediaBase);
  const layout = tpl.layout || "classic";
  const color = layout === "minimal" ? "#0f172a" : tpl.primary_color || "#059669";
  const hideAll = !!tpl.hide_all_prices;
  const hideLine = hideAll || !!tpl.hide_line_prices;
  const hideVat = hideAll || !!tpl.hide_vat;
  const fontSize = tpl.font_size === "xs" ? "10px" : tpl.font_size === "base" ? "14px" : "12px";
  const isModern = layout === "modern";
  const isMinimal = layout === "minimal";
  const isBold = layout === "bold";
  const title = tpl.title_override || "SİPARİŞ FORMU";
  const currency = (order as Order & { currency?: string }).currency;
  const thBg = isMinimal ? "transparent" : isBold ? "#0f172a" : color;
  const thColor = isMinimal ? "#0f172a" : "#fff";
  const thBorder = isMinimal ? "border-bottom:2px solid #0f172a;" : "";
  const customer = order.contact_name || order.customer_name || "";
  const total = order.grand_total ?? order.total_amount ?? 0;
  const custNo = customerOrderNo(order);
  const orderNotes = [order.customer_note, order.order_note, order.customer_notes].filter(Boolean);
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
      <div style="font-family:ui-monospace,monospace;font-weight:600;color:${isModern ? "#fff" : "#0f172a"}">${esc(order.order_number || "")}</div>
      <div style="color:${isModern ? "rgba(255,255,255,.8)" : "#64748b"}">Tarih: ${esc(orderDate(order))}</div>
    </div>`;
  const header = isModern
    ? `<div style="padding:24px 40px;color:#fff;display:flex;justify-content:space-between;align-items:flex-start;background:${color}">
        <div style="display:flex;align-items:center;gap:12px">${logo}${companyMeta}</div>${headerRight}
      </div>`
    : `<div style="display:flex;justify-content:space-between;align-items:flex-start;padding-bottom:16px;${isMinimal ? "border-bottom:1px solid #0f172a" : `border-bottom:4px solid ${color}`}">
        <div style="display:flex;align-items:center;gap:12px">${logo}${companyMeta}</div>${headerRight}
      </div>`;

  const priceHeads = hideLine
    ? ""
    : `<th style="text-align:right;padding:8px">Birim (KDV'siz)</th>${
        hideVat ? "" : `<th style="text-align:right;padding:8px">Birim (KDV'li)</th><th style="text-align:right;padding:8px">KDV</th>`
      }<th style="text-align:right;padding:8px">${hideVat ? "Tutar" : "Tutar Hariç"}</th>${
        hideVat ? "" : `<th style="text-align:right;padding:8px">Tutar Dahil</th>`
      }`;

  const rows = lines.map((it, i) => {
    const code = tpl.show_barcode === false ? "" : it.barcode || it.sku || "";
    const img = tpl.show_images === false ? "" : it.image;
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
    return `<tr style="border-bottom:1px solid #f1f5f9;${zebra}">
      <td style="padding:8px;vertical-align:middle">${img ? `<img src="${esc(img)}" alt="" width="64" height="64" style="width:64px;height:64px;object-fit:contain;border:1px solid #e2e8f0;border-radius:6px;background:#fff"/>` : `<div style="width:64px;height:64px;border:1px dashed #e2e8f0;border-radius:6px;background:#f8fafc"></div>`}</td>
      <td style="padding:8px;vertical-align:middle"><div style="font-weight:600;color:#0f172a">${esc(it.name)}${disc}</div>${gtip}${note}</td>
      <td style="padding:8px;vertical-align:middle">${barcodeCell}</td>
      <td style="padding:8px;text-align:right;vertical-align:middle">${esc(it.qty)} ${esc(it.unit)}</td>
      ${priceCells}
    </tr>`;
  }).join("");

  const totals = hideAll
    ? ""
    : `<div style="display:flex;justify-content:flex-end;margin-top:16px"><div style="width:260px;${isModern ? `background:${color}14;border-radius:12px;padding:12px;` : ""}">
        ${num(order.discount_total) > 0 ? `<div style="display:flex;justify-content:space-between;color:#e11d48"><span>İskonto</span><span>-${esc(money(order.discount_total, currency))}</span></div>` : ""}
        ${!hideVat && order.subtotal !== undefined ? `<div style="display:flex;justify-content:space-between"><span style="color:#64748b">Ara Toplam (KDV Hariç)</span><span>${esc(money(order.subtotal, currency))}</span></div>` : ""}
        ${!hideVat && order.vat_total !== undefined ? `<div style="display:flex;justify-content:space-between"><span style="color:#64748b">KDV</span><span>${esc(money(order.vat_total, currency))}</span></div>` : ""}
        <div style="display:flex;justify-content:space-between;font-size:16px;font-weight:900;border-top:2px solid ${color};padding-top:4px;margin-top:4px"><span>${hideVat ? "TOPLAM" : "GENEL TOPLAM (KDV Dahil)"}</span><span style="color:${color}">${esc(money(total, currency))}</span></div>
      </div></div>`;

  const notesBox = tpl.show_order_notes !== false && orderNotes.length
    ? `<div style="margin-top:12px;background:#fffbeb;border:1px solid #fde68a;border-radius:8px;padding:8px;color:#334155;white-space:pre-wrap"><b>Sipariş Notu:</b> ${esc(orderNotes.join(" • "))}</div>`
    : "";
  const extraNotes = order.notes
    ? `<div style="margin-top:24px;color:#475569;white-space:pre-wrap">${esc(order.notes)}</div>`
    : "";
  const bank = tpl.show_bank_info && company?.iban
    ? `<div style="margin-top:24px;color:#475569"><b>Banka:</b> ${esc(company.bank_name || "")} • <b>IBAN:</b> <span style="font-family:monospace">${esc(company.iban)}</span></div>`
    : "";
  const footer = `<div style="margin-top:40px;display:flex;justify-content:space-between;align-items:flex-end">
    <div style="color:#94a3b8;font-style:italic">${esc(tpl.footer_note || "")}</div>
    ${tpl.show_signature ? `<div style="text-align:center"><div style="width:160px;border-bottom:1px solid #cbd5e1;margin-bottom:4px"></div><div style="color:#64748b">Kaşe / İmza</div></div>` : ""}
  </div>`;

  return `<div data-print="order" style="font-size:${fontSize};color:#1e293b;display:flex;font-family:Arial,Helvetica,sans-serif">
    ${isBold ? `<div style="width:12px;align-self:stretch;background:${color}"></div>` : ""}
    <div style="flex:1;${isModern ? "" : "padding:40px"}">
      ${header}
      <div style="${isModern ? "padding:0 40px 40px" : ""}">
        ${tpl.header_note ? `<p style="margin:12px 0 0;color:#475569;font-style:italic">${esc(tpl.header_note)}</p>` : ""}
        <div style="margin-top:20px;display:grid;grid-template-columns:1fr 1fr;gap:24px">
          <div>
            <div style="font-size:10px;text-transform:uppercase;font-weight:700;color:#94a3b8;margin-bottom:4px">Sayın</div>
            <div style="font-weight:700;font-size:16px">${esc(customer || "—")}</div>
            ${order.shipping_address || order.city ? `<div style="color:#64748b">${esc(order.shipping_address || "")} ${esc(order.city || "")}</div>` : ""}
            ${order.customer_phone ? `<div style="color:#64748b">${esc(order.customer_phone)}</div>` : ""}
            ${custNo ? `<div style="margin-top:8px;display:inline-block;border:1px solid #a7f3d0;background:#ecfdf5;border-radius:8px;padding:4px 8px;font-size:12px;font-weight:600;color:#064e3b">Müşteri sipariş no: <span style="font-family:monospace">${esc(custNo)}</span></div>` : ""}
          </div>
        </div>
        <table style="width:100%;border-collapse:collapse;margin-top:24px${isModern ? ";overflow:hidden;border-radius:12px" : ""}">
          <thead><tr style="background:${thBg};color:${thColor};${thBorder}">
            <th style="padding:8px;width:80px;text-align:left">Resim</th>
            <th style="padding:8px;text-align:left">Açıklama</th>
            <th style="padding:8px;width:200px;text-align:left">Barkod</th>
            <th style="padding:8px;text-align:right">Miktar</th>
            ${priceHeads}
          </tr></thead>
          <tbody>${rows || `<tr><td colspan="8" style="padding:8px">Kalem yok</td></tr>`}</tbody>
        </table>
        ${notesBox}
        ${totals}
        ${extraNotes}
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

export function thermalLabelCss(size = "100x150"): string {
  const [w, h] = size.split("x").map(Number);
  const width = Number.isFinite(w) ? w : 100;
  const height = Number.isFinite(h) ? h : 150;
  return `@page{size:${width}mm ${height}mm;margin:0}html,body{margin:0;padding:0;font-family:Arial,Helvetica,sans-serif;color:#000;background:#777}.label{width:${width}mm;height:${height}mm;box-sizing:border-box;padding:4mm;background:#fff;page-break-after:always;display:flex;flex-direction:column;gap:2.2mm;overflow:hidden;margin:0 auto 4mm}
  @media print{body{background:#fff}.label{margin:0}}.top{display:flex;justify-content:space-between;align-items:flex-start;border-bottom:2px solid #000;padding-bottom:1.5mm}.carrier{font-size:15pt;font-weight:900;text-transform:uppercase}.qty{font-size:12pt;font-weight:800;border:2px solid #000;padding:1mm 2mm;border-radius:2mm}
  .box{border:1.5px solid #000;border-radius:2mm;padding:2mm;font-size:10pt;line-height:1.25}.box.small{font-size:7.5pt;border-style:dashed}.lbl{font-size:7pt;font-weight:800;letter-spacing:.5px;color:#444}.name{font-size:13pt;font-weight:900}.city{font-size:12pt;font-weight:800;margin-top:.5mm}
  .items{font-size:8pt;flex:1;overflow:hidden;line-height:1.3}.muted{color:#555}.bc{text-align:center}.bc svg{max-width:100%;height:auto}.foot{font-size:8pt;text-align:center;border-top:1px solid #000;padding-top:1mm}.mono{font-family:monospace;font-size:14pt;font-weight:800}`;
}

function documentCss(page: PrintPageKind): string {
  if (page === "thermal") return thermalLabelCss();
  if (page === "a4") {
    return `@page{size:A4;margin:8mm}html,body{margin:0;padding:0;font-family:Arial,Helvetica,sans-serif;color:#0f172a;background:#fff}@media print{body{padding:0}}`;
  }
  return `body{font-family:Arial,Helvetica,sans-serif;color:#0f172a;padding:16px;margin:0}@media print{body{padding:8px}}`;
}

export function openPrintHtml(title: string, bodyHtml: string, opts?: { page?: PrintPageKind }): boolean {
  if (typeof window === "undefined" || typeof window.open !== "function") return false;
  const page = opts?.page || "default";
  const w = window.open("", "_blank", page === "thermal" ? "width=720,height=900" : "width=800,height=900");
  if (!w) return false;
  w.document.write(`<!doctype html><html lang="tr"><head><meta charset="utf-8"><title>${esc(title)}</title>
    <style>${documentCss(page)}</style>
    </head><body>${bodyHtml}<script>window.onload=function(){setTimeout(function(){window.print()},${page === "thermal" ? 300 : 250})}</script></body></html>`);
  w.document.close();
  return true;
}
