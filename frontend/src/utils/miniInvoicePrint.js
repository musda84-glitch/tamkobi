import { formatTrAmount } from "./money";
/** Compact invoice slip used by the orders bulk menu. */

export const miniInvoiceSize = (key) => (key === "8x20" ? { w: 80, h: 200, label: "8×20 cm" } : { w: 100, h: 150, label: "10×15 cm" });

const esc = (s) => String(s ?? "").replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
const money = (n) => formatTrAmount((Number(n) || 0));

export const buildMiniInvoiceHtml = (orders, company = {}, sizeKey = "10x15") => {
  const { w, h } = miniInvoiceSize(sizeKey);
  const pages = (orders || []).map((o) => {
    const rows = (o.items || []).map((it) => `<tr><td>${esc(it.product_name || it.name)}</td><td class="r">${esc(it.quantity)} ${esc(it.unit || "ad")}</td><td class="r">${money(it.total_incl ?? it.total)} ₺</td></tr>`).join("");
    const total = o.grand_total ?? o.total_amount ?? 0;
    return `<section class="slip">
      <div class="co">${esc(company.name || "")}</div>
      <div class="title">${esc(o.invoice_number || o.order_number)}</div>
      <div class="who">${esc(o.customer_name || "")}</div>
      <table>${rows}</table>
      <div class="tot">Toplam <b>${money(total)} ₺</b></div>
    </section>`;
  }).join("");
  return `<!doctype html><html lang="tr"><head><meta charset="utf-8"><title>Mini fatura</title>
  <style>@page{size:${w}mm ${h}mm;margin:0}html,body{margin:0;font-family:Arial,Helvetica,sans-serif;color:#111}
  .slip{width:${w}mm;height:${h}mm;box-sizing:border-box;padding:4mm;page-break-after:always}
  .co{font-weight:800;font-size:11pt}.title{font-size:9pt;margin:1mm 0}.who{font-weight:700;font-size:10pt;margin-bottom:2mm}
  table{width:100%;border-collapse:collapse;font-size:8pt}td{border-bottom:1px solid #ddd;padding:1mm 0;vertical-align:top}
  .r{text-align:right;white-space:nowrap}.tot{margin-top:2mm;text-align:right;font-size:11pt}</style></head><body>${pages}</body></html>`;
};

export const printMiniInvoices = (orders, company, sizeKey) => {
  const list = (orders || []).filter((o) => o.invoice_id || o.invoice_number);
  if (!list.length || typeof window === "undefined") return false;
  const w0 = window.open("", "_blank", "width=720,height=900");
  if (!w0) return false;
  w0.document.write(buildMiniInvoiceHtml(list, company, sizeKey));
  w0.document.close();
  w0.onload = () => setTimeout(() => w0.print(), 250);
  return true;
};
