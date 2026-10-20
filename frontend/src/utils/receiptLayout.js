/** Tahsilat/tediye makbuzu: yoğunluk ve nüsha sayfalama. Saf; DOM ölçümü ayrı. */

export const RECEIPT_HALF_MM = 148.5;
export const RECEIPT_CSS_PX_PER_MM = 96 / 25.4;

/**
 * Yoğun yazıdan sonra bir yarıya sığan çek satırı.
 * Sabit blok (başlık, cari, toplam, yalnız, imza, 6mm iç boşluk) ~70mm;
 * 7pt ve 2 satır keşideci ile satır ~6mm. 10 satır yarıda kalır, fazlası ayrı sayfaya iner.
 */
export const RECEIPT_HALF_MAX_ROWS = 10;

export function receiptHalfLimitPx(limitMm = RECEIPT_HALF_MM) {
  const mm = Number(limitMm);
  if (!Number.isFinite(mm) || mm <= 0) return 0;
  return mm * RECEIPT_CSS_PX_PER_MM;
}

function rowCount(rows) {
  const n = Number(rows);
  if (!Number.isFinite(n) || n <= 0) return 0;
  return Math.floor(n);
}

/** ≤3 normal, 4–6 compact, 7+ dense. */
export function receiptDensity(rows) {
  const n = rowCount(rows);
  if (n <= 3) return "normal";
  if (n <= 6) return "compact";
  return "dense";
}

export function receiptHalfOverflows(scrollHeightPx, limitMm = RECEIPT_HALF_MM) {
  const px = Number(scrollHeightPx);
  if (!Number.isFinite(px) || px <= 0) return false;
  return px > receiptHalfLimitPx(limitMm);
}

/** Satır eşiği ve/veya ölçülen yükseklik yarıyı aşıyorsa false. */
export function receiptFitsHalf(rows, scrollHeightPx) {
  if (rowCount(rows) > RECEIPT_HALF_MAX_ROWS) return false;
  if (receiptHalfOverflows(scrollHeightPx)) return false;
  return true;
}

/**
 * 1–5 nüsha. Sığıyorsa sayfa başına iki nüsha; sığmıyorsa her nüsha kendi sayfasında.
 * @returns {number[][]} her sayfadaki nüsha indeksleri
 */
export function receiptCopyPages(copies, { fitsHalf = true } = {}) {
  const n = Math.min(5, Math.max(1, Number(copies) || 1));
  if (!fitsHalf) return Array.from({ length: n }, (_, i) => [i]);
  const pages = [];
  for (let i = 0; i < n; i += 2) {
    const page = [i];
    if (i + 1 < n) page.push(i + 1);
    pages.push(page);
  }
  return pages;
}

/** Baskı genişliğinde (210mm) klonun scrollHeight'ı. jsdom'da 0 döner. */
export function measureReceiptProbe(node) {
  if (typeof document === "undefined" || !node || typeof node.cloneNode !== "function" || !document.body) return 0;
  const probe = node.cloneNode(true);
  probe.classList.add("receipt-measure");
  probe.removeAttribute("data-testid");
  probe.querySelectorAll("[data-testid]").forEach((el) => el.removeAttribute("data-testid"));
  probe.setAttribute("aria-hidden", "true");
  probe.style.position = "absolute";
  probe.style.left = "-10000px";
  probe.style.top = "0";
  probe.style.visibility = "hidden";
  probe.style.display = "block";
  probe.style.height = "auto";
  probe.style.maxHeight = "none";
  probe.style.overflow = "visible";
  probe.style.width = "210mm";
  probe.style.boxSizing = "border-box";
  probe.style.padding = "6mm";
  probe.style.fontSize = "9pt";
  probe.style.lineHeight = "1.25";
  document.body.appendChild(probe);
  const height = Number(probe.scrollHeight) || 0;
  probe.remove();
  return height;
}
