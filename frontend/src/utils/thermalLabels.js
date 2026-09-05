import JsBarcode from "jsbarcode";
import { toast } from "sonner";

const esc = (s) => String(s ?? "").replace(/&/g, "&amp;").replace(/</g, "&lt;");
const barcodeSvg = (value) => {
  try { const svg = document.createElementNS("http://www.w3.org/2000/svg", "svg"); JsBarcode(svg, String(value), { format: "CODE128", displayValue: true, height: 46, width: 1.6, fontSize: 11, margin: 0 }); return svg.outerHTML; }
  catch { return `<div class="mono">${esc(value)}</div>`; }
};

/* 100×150 mm termal kargo etiketleri — her sipariş ayrı sayfa; yazdır penceresi açar */
export const printThermalLabels = (orders, company = {}, { size = "100x150" } = {}) => {
  if (!orders.length) { toast.error("Etiket için sipariş seçilmedi."); return false; }
  const [w, h] = size.split("x").map(Number);
  const w0 = window.open("", "_blank", "width=720,height=900");
  if (!w0) { toast.error("Açılır pencere engellendi. Tarayıcı izinlerini kontrol edin."); return false; }
  const labels = orders.map((o) => {
    const code = o.cargo_barcode || o.cargo_tracking_number || o.order_number;
    const items = (o.items || []).map((i) => `${i.quantity}× ${esc(i.product_name)}${i.sku ? ` <span class="muted">[${esc(i.sku)}]</span>` : ""}`).join("<br>");
    return `<section class="label">
      <div class="top"><div><div class="carrier">${esc(o.cargo_carrier_name || o.cargo_carrier || "KARGO")}</div><div class="muted">${esc(o.channel ? o.channel.toUpperCase() : "")} · ${esc(o.order_number)}</div></div><div class="qty">${(o.items || []).reduce((s, i) => s + (i.quantity || 0), 0)} adet</div></div>
      <div class="box"><div class="lbl">ALICI</div><div class="name">${esc(o.customer_name)}</div><div>${esc(o.shipping_address || "")}</div><div class="city">${esc([o.district, o.city].filter(Boolean).join(" / "))}</div>${o.customer_phone ? `<div>Tel: ${esc(o.customer_phone)}</div>` : ""}</div>
      <div class="box small"><div class="lbl">GÖNDERİCİ</div><b>${esc(company.name || "")}</b> ${esc(company.address || "")} ${company.phone ? "· " + esc(company.phone) : ""}</div>
      <div class="items">${items}</div>
      <div class="bc">${barcodeSvg(code)}</div>
      <div class="foot">${o.cargo_tracking_number ? "Takip: " + esc(o.cargo_tracking_number) : ""}${o.total_amount ? ` · ${Number(o.total_amount).toLocaleString("tr-TR", { minimumFractionDigits: 2 })} ₺` : ""}${o.payment_type === "cod" ? " · KAPIDA ÖDEME" : ""}</div>
    </section>`;
  }).join("");
  w0.document.write(`<!doctype html><html lang="tr"><head><meta charset="utf-8"><title>Kargo Etiketleri (${orders.length})</title>
  <style>@page{size:${w}mm ${h}mm;margin:0}html,body{margin:0;padding:0;font-family:Arial,Helvetica,sans-serif;color:#000;background:#777}.label{width:${w}mm;height:${h}mm;box-sizing:border-box;padding:4mm;background:#fff;page-break-after:always;display:flex;flex-direction:column;gap:2.2mm;overflow:hidden;margin:0 auto 4mm}
  @media print{body{background:#fff}.label{margin:0}}.top{display:flex;justify-content:space-between;align-items:flex-start;border-bottom:2px solid #000;padding-bottom:1.5mm}.carrier{font-size:15pt;font-weight:900;text-transform:uppercase}.qty{font-size:12pt;font-weight:800;border:2px solid #000;padding:1mm 2mm;border-radius:2mm}
  .box{border:1.5px solid #000;border-radius:2mm;padding:2mm;font-size:10pt;line-height:1.25}.box.small{font-size:7.5pt;border-style:dashed}.lbl{font-size:7pt;font-weight:800;letter-spacing:.5px;color:#444}.name{font-size:13pt;font-weight:900}.city{font-size:12pt;font-weight:800;margin-top:.5mm}
  .items{font-size:8pt;flex:1;overflow:hidden;line-height:1.3}.muted{color:#555}.bc{text-align:center}.bc svg{max-width:100%;height:auto}.foot{font-size:8pt;text-align:center;border-top:1px solid #000;padding-top:1mm}.mono{font-family:monospace;font-size:14pt;font-weight:800}</style></head>
  <body>${labels}<script>window.onload=()=>setTimeout(()=>window.print(),300)</script></body></html>`);
  w0.document.close();
  return true;
};
