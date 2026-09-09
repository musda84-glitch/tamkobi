import React from "react";
import { FileSpreadsheet, FileText } from "lucide-react";
import { toast } from "sonner";

const cell = (v) => (v === null || v === undefined ? "" : typeof v === "number" ? v.toLocaleString("tr-TR", { minimumFractionDigits: 2, maximumFractionDigits: 2 }) : String(v));

export const exportExcel = (rows, columns, filename) => {
  const head = columns.map((c) => c.label).join(";");
  const body = rows.map((r) => columns.map((c) => `"${cell(typeof c.value === "function" ? c.value(r) : r[c.key]).replace(/"/g, '""')}"`).join(";")).join("\n");
  const blob = new Blob(["\ufeff" + head + "\n" + body], { type: "text/csv;charset=utf-8;" });
  const a = document.createElement("a"); a.href = URL.createObjectURL(blob); a.download = `${filename}_${new Date().toISOString().slice(0, 10)}.csv`; a.click(); URL.revokeObjectURL(a.href);
  toast.success(`${rows.length} satır Excel (CSV) olarak indirildi.`);
};

export const exportPdf = (rows, columns, filename, title, company) => {
  const w = window.open("", "_blank", "width=1100,height=800");
  if (!w) { toast.error("Açılır pencere engellendi. Tarayıcı izinlerini kontrol edin."); return; }
  const esc = (s) => String(s).replace(/&/g, "&amp;").replace(/</g, "&lt;");
  const html = `<!doctype html><html lang="tr"><head><meta charset="utf-8"><title>${esc(title)}</title>
  <style>body{font-family:Arial,Helvetica,sans-serif;font-size:11px;color:#0f172a;margin:24px}h1{font-size:18px;margin:0}h2{font-size:12px;color:#64748b;font-weight:normal;margin:4px 0 14px}table{width:100%;border-collapse:collapse}th{background:#0f172a;color:#fff;text-align:left;padding:6px 8px;font-size:10px;text-transform:uppercase}td{padding:6px 8px;border-bottom:1px solid #e2e8f0}tr:nth-child(even) td{background:#f8fafc}td.num,th.num{text-align:right}.foot{margin-top:14px;font-size:10px;color:#94a3b8;display:flex;justify-content:space-between}@media print{@page{size:A4 landscape;margin:12mm}}</style></head>
  <body><h1>${esc(title)}</h1><h2>${esc(company || "")} · ${new Date().toLocaleString("tr-TR")} · ${rows.length} kayıt</h2>
  <table><thead><tr>${columns.map((c) => `<th class="${c.num ? "num" : ""}">${esc(c.label)}</th>`).join("")}</tr></thead>
  <tbody>${rows.map((r) => `<tr>${columns.map((c) => `<td class="${c.num ? "num" : ""}">${esc(cell(typeof c.value === "function" ? c.value(r) : r[c.key]))}</td>`).join("")}</tr>`).join("")}</tbody></table>
  <div class="foot"><span>TamKobi</span><span>${esc(filename)}</span></div><script>window.onload=()=>{window.print();}</script></body></html>`;
  w.document.write(html); w.document.close();
};

export const ExportButtons = ({ rows, columns, filename, title, company, size = "sm" }) => {
  const cls = size === "sm" ? "px-2.5 py-1.5 text-xs" : "px-3 py-2 text-sm";
  return (
    <div className="flex items-center gap-1" data-testid="export-buttons">
      <button type="button" onClick={() => exportExcel(rows, columns, filename)} disabled={!rows?.length} className={`${cls} flex items-center gap-1 bg-emerald-50 hover:bg-emerald-100 text-emerald-700 border border-emerald-200 rounded-lg font-semibold disabled:opacity-40`} title="Excel (CSV) indir" data-testid="export-excel-btn"><FileSpreadsheet className="w-3.5 h-3.5" /> Excel</button>
      <button type="button" onClick={() => exportPdf(rows, columns, filename, title, company)} disabled={!rows?.length} className={`${cls} flex items-center gap-1 bg-rose-50 hover:bg-rose-100 text-rose-700 border border-rose-200 rounded-lg font-semibold disabled:opacity-40`} title="PDF olarak yazdır / kaydet" data-testid="export-pdf-btn"><FileText className="w-3.5 h-3.5" /> PDF</button>
    </div>
  );
};
