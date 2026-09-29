/**
 * Barkod etiket yazdırma: önizlemede görünen ürün görseli termal/A4 çıktıda
 * kaybolmasın (about:blank relative URL + display:none lazy-load).
 */

/** Relative /api/files... → absolute; print penceresi about:blank olsa bile yüklensin. */
export function absolutizeUrl(url, baseHref = typeof window !== "undefined" ? window.location.href : "") {
  const raw = String(url || "").trim();
  if (!raw) return "";
  if (/^(data:|blob:)/i.test(raw)) return raw;
  try {
    return new URL(raw, baseHref || "http://localhost/").href;
  } catch {
    return raw;
  }
}

/** innerHTML içindeki img src değerlerini absolute yap. */
export function absolutizeHtmlUrls(html, baseHref) {
  const src = String(html || "");
  if (!src) return "";
  return src.replace(/(<img\b[^>]*?\bsrc=["'])([^"']+)(["'])/gi, (_, a, url, c) => `${a}${absolutizeUrl(url, baseHref)}${c}`);
}

/** Termal için çizgi çizimleri koyulaştır (gri çizgi yazıcıda kaybolmasın). */
export async function imageToThermalDataUrl(url, opts = {}) {
  const abs = absolutizeUrl(url, opts.baseHref);
  if (!abs || abs.startsWith("data:image")) return abs;
  if (typeof document === "undefined") return abs;
  try {
    const res = await fetch(abs, { credentials: "include", mode: "cors" });
    if (!res.ok) return abs;
    const blob = await res.blob();
    const objUrl = URL.createObjectURL(blob);
    try {
      const img = await loadImage(objUrl);
      const w = Math.max(1, img.naturalWidth || img.width || 1);
      const h = Math.max(1, img.naturalHeight || img.height || 1);
      const canvas = document.createElement("canvas");
      canvas.width = w;
      canvas.height = h;
      const ctx = canvas.getContext("2d");
      if (!ctx) return abs;
      ctx.fillStyle = "#fff";
      ctx.fillRect(0, 0, w, h);
      ctx.drawImage(img, 0, 0, w, h);
      const data = ctx.getImageData(0, 0, w, h);
      const d = data.data;
      const threshold = opts.threshold ?? 200;
      for (let i = 0; i < d.length; i += 4) {
        const g = 0.299 * d[i] + 0.587 * d[i + 1] + 0.114 * d[i + 2];
        const v = g < threshold ? 0 : 255;
        d[i] = d[i + 1] = d[i + 2] = v;
        d[i + 3] = 255;
      }
      ctx.putImageData(data, 0, 0);
      return canvas.toDataURL("image/png");
    } finally {
      URL.revokeObjectURL(objUrl);
    }
  } catch {
    return abs;
  }
}

function loadImage(src) {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => resolve(img);
    img.onerror = () => reject(new Error("image load failed"));
    img.src = src;
  });
}

/** Kaynak DOM'daki img'leri data-URL'e çevir (yazdırma penceresinde kırılmasın). */
export async function embedLabelImages(root, opts = {}) {
  if (!root?.querySelectorAll) return;
  const imgs = Array.from(root.querySelectorAll("img"));
  await Promise.all(imgs.map(async (img) => {
    const src = img.getAttribute("src") || img.src || "";
    if (!src || src.startsWith("data:")) return;
    const dataUrl = await imageToThermalDataUrl(src, opts);
    if (dataUrl) img.setAttribute("src", dataUrl);
  }));
}

export function buildLabelPrintDocument({ html, tpl, page, baseHref }) {
  const isA4 = page?.mode === "a4";
  const cols = isA4 ? Math.max(1, Number(page?.cols) || 1) : 1;
  const gap = Number(page?.gap_mm) || 0;
  const w = tpl?.width_mm || 100;
  const h = tpl?.height_mm || 30;
  const body = absolutizeHtmlUrls(html, baseHref);
  const base = baseHref ? `<base href="${String(baseHref).replace(/"/g, "")}">` : "";
  return `<!doctype html><html><head><meta charset="utf-8"><title>Etiketler</title>${base}
<style>
@page{size:${isA4 ? "A4" : `${w}mm ${h}mm`};margin:${isA4 ? "8mm" : "0"}}
html,body{margin:0;padding:0;font-family:Arial,Helvetica,sans-serif;background:#fff;color:#000}
.grid{display:grid;grid-template-columns:repeat(${cols},${w}mm);gap:${gap}mm}
.lbl{width:${w}mm;height:${h}mm;position:relative;overflow:hidden;${isA4 ? "" : "page-break-after:always;"}break-inside:avoid;background:#fff}
svg{display:block;overflow:visible}
img{-webkit-print-color-adjust:exact;print-color-adjust:exact;image-rendering:crisp-edges}
[data-label-box],[data-label-line]{-webkit-print-color-adjust:exact;print-color-adjust:exact}
[data-label-box] rect{stroke:#000!important;fill:none!important}
[data-label-line]{background:#000!important}
</style></head><body><div class="grid">${body}</div></body></html>`;
}
