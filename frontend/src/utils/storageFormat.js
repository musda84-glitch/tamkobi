/** Depolama ölçüleri. Ondalık ayırıcı virgüldür. */

const tr = new Intl.NumberFormat("tr-TR", { maximumFractionDigits: 1, minimumFractionDigits: 0 });
const MB = 1024 * 1024;
const GB = 1024 * 1024 * 1024;

export function formatTrNumber(value) {
  const n = Number(value);
  if (!Number.isFinite(n)) return "0";
  return tr.format(n);
}

export function formatBytes(bytes) {
  const b = Math.max(0, Number(bytes) || 0);
  if (b >= GB) return `${formatTrNumber(b / GB)} GB`;
  if (b >= MB) return `${formatTrNumber(b / MB)} MB`;
  if (b >= 1024) return `${formatTrNumber(b / 1024)} KB`;
  return `${formatTrNumber(b)} B`;
}

export function formatLimitMb(mb) {
  const n = Number(mb) || 0;
  if (n <= 0) return "Sınırsız";
  if (n >= 1024) return `${formatTrNumber(n / 1024)} GB`;
  return `${formatTrNumber(n)} MB`;
}

export function formatPercent(value) {
  const n = Number(value);
  if (!Number.isFinite(n)) return "—";
  return `%${formatTrNumber(n)}`;
}

export function storageMbFromForm(amount, unit) {
  const text = String(amount ?? "").trim().replace(/\s/g, "").replace(",", ".");
  if (!text) return null;
  const n = Number(text);
  if (!Number.isFinite(n) || n < 0) return NaN;
  return unit === "gb" ? Math.round(n * 1024) : Math.round(n);
}

export function convertStorageAmount(amount, fromUnit, toUnit) {
  if (fromUnit === toUnit) return String(amount ?? "");
  const mb = storageMbFromForm(amount, fromUnit);
  if (mb == null || Number.isNaN(mb)) return String(amount ?? "");
  if (toUnit === "gb") {
    const gb = mb / 1024;
    return String(gb).replace(".", ",");
  }
  return String(mb);
}
