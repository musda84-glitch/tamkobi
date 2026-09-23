/** One label per ordered unit; empty lines still get a single copy. Cap 200. */
export function labelCopyCount(line) {
  const n = Number(line?.ordered_qty);
  if (!Number.isFinite(n) || n <= 0) return 1;
  return Math.min(200, Math.max(1, Math.round(n)));
}

export function expandPickLabelJobs(items) {
  const jobs = [];
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
