import { formatTrAmount } from "./money";
/**
 * 80mm termal POS fişi — tarayıcı yazdırma penceresi (ESC/POS sürücüsü gerekmez).
 */
const esc = (s) => String(s ?? "").replace(/&/g, "&amp;").replace(/</g, "&lt;");
const money = (n) => formatTrAmount(Number(n || 0));

const PAY_LABEL = { cash: "NAKİT", card: "KART", mixed: "NAKİT+KART" };

export function printThermalReceipt(receipt, { autoPrint = true } = {}) {
  if (!receipt) return false;
  const w = window.open("", "_blank", "width=420,height=720");
  if (!w) return false;
  const items = (receipt.items || [])
    .map((it) => {
      const meta = [it.lot_number && `Lot:${esc(it.lot_number)}`, it.serial_number && `Seri:${esc(it.serial_number)}`, it.expiry_date && `SKT:${esc(it.expiry_date)}`]
        .filter(Boolean)
        .join(" · ");
      return `<tr>
        <td class="name">${esc(it.name)}${meta ? `<div class="meta">${meta}</div>` : ""}</td>
        <td class="qty">${esc(it.quantity)} ${esc(it.unit || "")}</td>
        <td class="amt">${money(it.total_incl)}</td>
      </tr>`;
    })
    .join("");
  w.document.write(`<!doctype html><html lang="tr"><head><meta charset="utf-8"><title>Fiş ${esc(receipt.invoice_number)}</title>
<style>
@page{size:80mm auto;margin:2mm}
html,body{margin:0;padding:0;font-family:"Courier New",Courier,monospace;color:#000;background:#fff}
.ticket{width:72mm;margin:0 auto;padding:2mm;font-size:11px;line-height:1.25}
.center{text-align:center}.bold{font-weight:800}.muted{color:#444;font-size:10px}
.hr{border-top:1px dashed #000;margin:3mm 0}
table{width:100%;border-collapse:collapse}
td{vertical-align:top;padding:1mm 0}
td.qty{text-align:center;white-space:nowrap;width:18mm}
td.amt{text-align:right;white-space:nowrap;width:18mm}
.name{font-weight:700}.meta{font-size:9px;font-weight:400;color:#333}
.total{font-size:14px;font-weight:900}
.foot{margin-top:3mm;font-size:10px}
@media print{body{background:#fff}}
</style></head><body>
<section class="ticket">
  <div class="center bold">${esc(receipt.company_name || "TamKobi")}</div>
  <div class="center muted">${esc(receipt.company_address || "")}</div>
  ${receipt.company_tax ? `<div class="center muted">VKN: ${esc(receipt.company_tax)}</div>` : ""}
  <div class="hr"></div>
  <div>Fiş No: <b>${esc(receipt.invoice_number)}</div>
  <div>${esc(receipt.date)} ${esc(receipt.time || "")}</div>
  <div>Ödeme: <b>${esc(PAY_LABEL[receipt.payment_method] || receipt.payment_method || "NAKİT")}</b>
    ${receipt.sector ? ` · ${esc(receipt.sector)}` : ""}</div>
  <div class="hr"></div>
  <table><tbody>${items}</tbody></table>
  <div class="hr"></div>
  <div>Ara Toplam: ${money(receipt.subtotal)} ₺</div>
  <div>KDV: ${money(receipt.vat_total)} ₺</div>
  <div class="total">TOPLAM: ${money(receipt.grand_total)} ₺</div>
  <div class="hr"></div>
  <div class="center foot">Bizi tercih ettiğiniz için teşekkürler.<br/>TamKobi Hızlı Satış</div>
</section>
${autoPrint ? "<script>window.onload=()=>setTimeout(()=>window.print(),250)</script>" : ""}
</body></html>`);
  w.document.close();
  return true;
}
