import { code128Svg } from "./code128";
import { absolutizeLabelUrl } from "./labelMedia";
import { formatTrAmount, moneySuffix } from "./money";
import { qrSvg } from "./qrSvg";
import type { LabelTemplateLike } from "./resolveLabelTemplate";

type LabelProduct = {
  name?: string;
  sku?: string;
  barcode?: string;
  sale_price?: number;
  vat_rate?: number;
  currency?: string;
  price_includes_vat?: boolean;
  tags?: string[];
  category?: string;
  variant_name?: string;
  image_url?: string;
  label_image_url?: string;
};

type CompanyLike = { name?: string; logo_url?: string } | null | undefined;

export type LabelRenderOpts = {
  mediaBase?: string | null;
};

function esc(value: unknown): string {
  return String(value ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

function productTagSlots(product?: LabelProduct | null): string[] {
  const tags = Array.isArray(product?.tags) ? product!.tags! : [];
  return [0, 1, 2].map((i) => String(tags[i] ?? "").trim());
}

export function labelFieldValue(
  el: Record<string, unknown> | null | undefined,
  product: LabelProduct | null | undefined,
  company?: CompanyLike,
): string {
  if (!product) return el?.field === "text" ? String(el.text || "Metin") : `{${el?.field}}`;
  const vat = Number(product.vat_rate ?? 20);
  const base = Number(product.sale_price || 0);
  const price = el?.vat === "excl"
    ? (product.price_includes_vat ? base / (1 + vat / 100) : base)
    : (product.price_includes_vat ? base : base * (1 + vat / 100));
  const [tag1, tag2, tag3] = productTagSlots(product);
  const map: Record<string, string> = {
    name: String(product.name || ""),
    price: `${el?.prefix || ""}${formatTrAmount(price)} ${el?.currency || moneySuffix(product.currency)}${el?.vat === "excl" ? " +KDV" : ""}`,
    sku: String(product.sku || ""),
    barcode_text: String(product.barcode || ""),
    variant: String(product.variant_name || ""),
    category: String(product.category || ""),
    company: String(company?.name || ""),
    label_1: tag1,
    label_2: tag2,
    label_3: tag3,
    text: String(el?.text || ""),
  };
  return map[String(el?.field || "")] ?? "";
}

function elStyle(el: Record<string, unknown>): string {
  const x = Number(el.x) || 0;
  const y = Number(el.y) || 0;
  const w = Number(el.w) || 10;
  const h = el.type === "line" ? Math.max(0.15, Number(el.h) || 0.3) : (Number(el.h) || 5);
  const rot = Number(el.rotate) || 0;
  return [
    "position:absolute",
    `left:${x}mm`,
    `top:${y}mm`,
    `width:${w}mm`,
    `height:${h}mm`,
    "overflow:hidden",
    "box-sizing:border-box",
    rot ? `transform:rotate(${rot}deg)` : "",
  ].filter(Boolean).join(";");
}

function productImageUrl(product: LabelProduct | null | undefined): string {
  return String(product?.label_image_url || product?.image_url || "").trim();
}

function renderElement(
  el: Record<string, unknown>,
  product: LabelProduct,
  company?: CompanyLike,
  opts?: LabelRenderOpts,
): string {
  const type = String(el.type || "");
  const code = String(product.barcode || product.sku || "").trim();
  const style = elStyle(el);
  if (type === "barcode") {
    const showText = el.showText !== false;
    const svg = code
      ? code128Svg(code, { height: 28, moduleWidth: 1.15, margin: 2, displayValue: showText, fontSize: 8 })
      : `<div style="font-size:6pt;color:#be123c;font-weight:700">Barkod yok</div>`;
    return `<div style="${style};display:flex;align-items:center;justify-content:center">${svg}</div>`;
  }
  if (type === "qr") {
    const mm = Math.min(Number(el.w) || 15, Number(el.h) || 15);
    const px = Math.max(48, Math.round(mm * 3.78));
    const svg = qrSvg(code, px);
    return `<div style="${style};display:flex;align-items:center;justify-content:center">${svg}</div>`;
  }
  if (type === "line") {
    return `<div style="${style};background:#000"></div>`;
  }
  if (type === "box") {
    return `<div style="${style};border:0.2mm solid #000"></div>`;
  }
  if (type === "logo" || type === "image") {
    const raw = type === "logo" ? company?.logo_url : productImageUrl(product);
    const url = absolutizeLabelUrl(raw, opts?.mediaBase);
    if (url) {
      return `<div style="${style}"><img src="${esc(url)}" alt="" style="width:100%;height:100%;object-fit:contain;-webkit-print-color-adjust:exact;print-color-adjust:exact"/></div>`;
    }
    return `<div style="${style};background:#f1f5f9;font-size:5pt;color:#94a3b8;display:flex;align-items:center;justify-content:center">${type === "logo" ? "LOGO" : "GÖRSEL"}</div>`;
  }
  // field / text
  const font = Number(el.font) || 10;
  const align = String(el.align || "left");
  const bold = el.bold ? "700" : "400";
  const italic = el.italic ? "italic" : "normal";
  const mono = el.mono ? "monospace" : "Arial,Helvetica,sans-serif";
  const text = esc(labelFieldValue(el, product, company));
  return `<div style="${style};font-size:${font}pt;font-weight:${bold};font-style:${italic};text-align:${align};font-family:${mono};line-height:1.1;display:flex;align-items:${el.valign === "middle" ? "center" : "flex-start"};justify-content:${align === "center" ? "center" : align === "right" ? "flex-end" : "flex-start"};white-space:normal;word-break:break-word">${text}</div>`;
}

export function templateLabelCardHtml(
  tpl: LabelTemplateLike,
  product: LabelProduct,
  company?: CompanyLike,
  opts?: LabelRenderOpts,
): string {
  const w = Number(tpl.width_mm) || 50;
  const h = Number(tpl.height_mm) || 30;
  const els = Array.isArray(tpl.elements) ? tpl.elements : [];
  const body = els.map((el) => renderElement(el as Record<string, unknown>, product, company, opts)).join("");
  return `<div class="label" data-testid="pick-product-label" style="width:${w}mm;height:${h}mm;position:relative;overflow:hidden;box-sizing:border-box;background:#fff;page-break-after:always">${body}</div>`;
}

export function templateLabelDocumentHtml(
  title: string,
  jobs: Array<{ tpl: LabelTemplateLike; product: LabelProduct }>,
  company?: CompanyLike,
  autoPrint = false,
  opts?: LabelRenderOpts,
): { html: string; widthMm: number; heightMm: number } {
  const first = jobs[0]?.tpl;
  const widthMm = Number(first?.width_mm) || 50;
  const heightMm = Number(first?.height_mm) || 30;
  const script = autoPrint
    ? `<script>window.onload=function(){setTimeout(function(){window.print()},300)}</script>`
    : "";
  const baseHref = opts?.mediaBase
    ? `<base href="${esc(String(opts.mediaBase).replace(/\/?$/, "/"))}">`
    : "";
  const cards = jobs.map((j) => templateLabelCardHtml(j.tpl, j.product, company, opts)).join("");
  const html = `<!doctype html><html lang="tr"><head><meta charset="utf-8"><title>${esc(title)}</title>${baseHref}
<style>
@page{size:${widthMm}mm ${heightMm}mm;margin:0}
html,body{margin:0;padding:0;font-family:Arial,Helvetica,sans-serif;color:#0f172a;background:#fff}
.label{margin:0 auto}
img{-webkit-print-color-adjust:exact;print-color-adjust:exact;image-rendering:crisp-edges}
svg{display:block;overflow:visible}
@media print{body{background:#fff}}
</style></head><body>${cards}${script}</body></html>`;
  return { html, widthMm, heightMm };
}
