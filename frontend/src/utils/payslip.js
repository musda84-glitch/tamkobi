
import { toast } from "sonner";

const fmt = (n) => (Number(n) || 0).toLocaleString("tr-TR", { minimumFractionDigits: 2 });
const esc = (s) => String(s ?? "").replace(/&/g, "&amp;").replace(/</g, "&lt;");

/* Tek personel için yazdırılabilir maaş bordrosu (yeni pencere → PDF olarak kaydet) */
export const printPayslip = (p, company = {}) => {
  const w = window.open("", "_blank", "width=900,height=1000");
  if (!w) { toast.error("Açılır pencere engellendi. Tarayıcı izinlerini kontrol edin."); return; }
  const ot = p.overtime_rate || {};
  const rows = [
    ["Brüt (bordro) maaş", p.gross_salary, "muted"],
    ["Net maaş", p.net_salary],
    p.overtime_pay > 0 && [`Fazla mesai ücreti — ${p.overtime_hours} sa (hafta içi ${p.overtime_weekday_hours || 0} sa × ${fmt(ot.weekday_rate)} ₺${p.overtime_holiday_hours ? `, tatil ${p.overtime_holiday_hours} sa × ${fmt(ot.holiday_rate)} ₺` : ""})`, p.overtime_pay],
    p.second_salary > 0 && ["2. maaş", p.second_salary],
    p.bonus > 0 && ["Prim / ikramiye", p.bonus],
    p.deduction > 0 && ["Kesinti", -p.deduction],
    p.advance_payment > 0 && ["Avans mahsubu", -p.advance_payment],
  ].filter(Boolean);
  const html = `<!doctype html><html lang="tr"><head><meta charset="utf-8"><title>Bordro ${esc(p.period)} - ${esc(p.employee_name)}</title>
  <style>body{font-family:Arial,Helvetica,sans-serif;font-size:12px;color:#0f172a;margin:28px}h1{font-size:20px;margin:0}.sub{color:#64748b;margin:2px 0 18px}.grid{display:grid;grid-template-columns:1fr 1fr;gap:16px;margin-bottom:18px}.box{border:1px solid #e2e8f0;border-radius:10px;padding:12px}.box b{display:block;font-size:10px;text-transform:uppercase;color:#94a3b8;margin-bottom:4px}table{width:100%;border-collapse:collapse}td{padding:8px 10px;border-bottom:1px solid #e2e8f0}td.num{text-align:right;font-variant-numeric:tabular-nums}tr.muted td{color:#94a3b8}tr.total td{font-weight:800;font-size:15px;border-top:2px solid #0f172a;border-bottom:none;background:#f8fafc}.badge{display:inline-block;padding:2px 8px;border-radius:999px;font-size:10px;font-weight:700;background:${p.status === "paid" ? "#dcfce7;color:#166534" : "#fef3c7;color:#92400e"}}.sig{display:flex;justify-content:space-between;margin-top:56px;font-size:11px;color:#64748b}.sig div{width:40%;border-top:1px solid #94a3b8;padding-top:6px;text-align:center}.foot{margin-top:24px;font-size:10px;color:#94a3b8}@media print{@page{size:A4;margin:14mm}}</style></head>
  <body><h1>MAAŞ BORDROSU <span class="badge">${p.status === "paid" ? "ÖDENDİ" : "BEKLİYOR"}</span></h1><div class="sub">${esc(company.name || "")}${company.tax_number ? " · VKN " + esc(company.tax_number) : ""} · Dönem <b>${esc(p.period)}</b></div>
  <div class="grid"><div class="box"><b>Personel</b>${esc(p.employee_name)}${p.department ? "<br>" + esc(p.department) : ""}</div><div class="box"><b>Bordro</b>No: ${esc(p.id || p._id || "")}<br>Hesaplama: ${esc((p.updated_at || p.created_at || "").slice(0, 10))}${p.paid_at ? "<br>Ödeme: " + esc(String(p.paid_at).slice(0, 10)) : ""}${ot.method ? `<br>Mesai yöntemi: ${ot.method === "fixed" ? "Sabit saatlik" : `Yasal (brüt/${ot.divisor || 225} × ${ot.multiplier || 1.5})`}` : ""}</div></div>
  <table>${rows.map(([l, v, cls]) => `<tr class="${cls || ""}"><td>${esc(l)}</td><td class="num">${v < 0 ? "−" : ""}${fmt(Math.abs(v))} ₺</td></tr>`).join("")}<tr class="total"><td>ÖDENECEK NET TUTAR</td><td class="num">${fmt(p.final_payable)} ₺</td></tr></table>
  <div class="sig"><div>İşveren / Yetkili</div><div>Personel İmzası</div></div>
  <div class="foot">TamKobi · ${new Date().toLocaleString("tr-TR")} · Bu belge ${esc(p.period)} dönemi için hesaplanan ödemeyi gösterir; resmi SGK bordrosu yerine geçmez.</div>
  <script>window.onload=()=>{window.print();}</script></body></html>`;
  w.document.write(html); w.document.close();
};
