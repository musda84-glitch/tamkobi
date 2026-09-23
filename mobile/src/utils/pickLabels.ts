import { code128Svg } from "./code128";
import type { PickLine } from "./orderPick";

export const PRODUCT_LABEL_PX = { width: 142, height: 85 };
export const PRODUCT_LABEL_SIZE = "50x30";

export type PickLabelJob = {
  name: string;
  sku: string;
  code: string;
};

function esc(value: unknown): string {
  return String(value ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

function num(v: unknown): number {
  const n = Number(v);
  return Number.isFinite(n) ? n : 0;
}

/** One label per ordered unit; empty lines still get a single copy. Cap 200. */
export function labelCopyCount(line?: PickLine | null): number {
  const n = num(line?.ordered_qty);
  if (n <= 0) return 1;
  return Math.min(200, Math.max(1, Math.round(n)));
}

export function expandPickLabelJobs(items?: Array<PickLine | null | undefined> | null): PickLabelJob[] {
  const jobs: PickLabelJob[] = [];
  for (const line of items || []) {
    if (!line) continue;
    const name = String(line.product_name || "Ürün").trim() || "Ürün";
    const sku = String(line.sku || "").trim();
    const code = String(line.barcode || line.sku || "").trim();
    const copies = labelCopyCount(line);
    for (let i = 0; i < copies; i += 1) jobs.push({ name, sku, code });
  }
  return jobs;
}

export function productLabelCss(size = PRODUCT_LABEL_SIZE): string {
  const [w, h] = String(size).split("x").map(Number);
  const width = Number.isFinite(w) ? w : 50;
  const height = Number.isFinite(h) ? h : 30;
  return `@page{size:${width}mm ${height}mm;margin:0}html,body{margin:0;padding:0;font-family:Arial,Helvetica,sans-serif;color:#0f172a;background:#777}
.label{width:${width}mm;height:${height}mm;box-sizing:border-box;padding:1.4mm 1.6mm;background:#fff;page-break-after:always;display:flex;flex-direction:column;gap:0.6mm;overflow:hidden;margin:0 auto 3mm;border:0.3mm solid #cbd5e1}
@media print{body{background:#fff}.label{margin:0;border-color:#e2e8f0}}
.co{font-size:5.5pt;font-weight:800;letter-spacing:.3px;text-transform:uppercase;color:#64748b}
.name{font-size:8pt;font-weight:800;line-height:1.15;max-height:8.4mm;overflow:hidden}
.sku{font-size:6pt;font-family:monospace;color:#475569}
.bc{margin-top:auto;text-align:center}.bc svg{max-width:100%;height:11mm}
.miss{font-size:6.5pt;color:#be123c;font-weight:700}`;
}

export function productLabelCardHtml(job: PickLabelJob, companyName?: string): string {
  const code = job.code;
  const barcode = code
    ? `<div class="bc">${code128Svg(code, { height: 28, moduleWidth: 1.15, margin: 2, displayValue: true, fontSize: 8 })}</div>`
    : `<div class="miss">Barkod yok</div>`;
  return `<div class="label" data-testid="pick-product-label">
    ${companyName ? `<div class="co">${esc(companyName)}</div>` : ""}
    <div class="name">${esc(job.name)}</div>
    ${job.sku ? `<div class="sku">${esc(job.sku)}</div>` : ""}
    ${barcode}
  </div>`;
}

export function productLabelBodyHtml(jobs: PickLabelJob[], companyName?: string): string {
  return jobs.map((job) => productLabelCardHtml(job, companyName)).join("");
}

export function productLabelDocumentHtml(
  title: string,
  jobs: PickLabelJob[],
  companyName?: string,
  autoPrint = false,
): string {
  const script = autoPrint
    ? `<script>window.onload=function(){setTimeout(function(){window.print()},300)}</script>`
    : "";
  return `<!doctype html><html lang="tr"><head><meta charset="utf-8"><title>${esc(title)}</title>
    <style>${productLabelCss()}</style></head><body>${productLabelBodyHtml(jobs, companyName)}${script}</body></html>`;
}
