/**
 * Barkod etiket yazdırma.
 * Önizleme görseli termal çıktıda kaybolmasın (relative URL → absolute / data-URL).
 * XP-490B: tuval piksel + CSS scale/zoom sayfayı kaydırıp solu (logo, MODEL, ad)
 * kırpıyor. Yazdırma belgesi mm kutusuna oturur; @page margin 0, gövde genişliği
 * etiket genişliği, transform/zoom yok. Pencere about:blank kalmasın.
 */
import { LABEL_PX_PER_MM } from "./labelBoxStroke";

export const LABEL_PRINT_TITLE = "Etiketler";

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

const LENGTH_PROPS = new Set(["left", "top", "width", "height", "font-size", "min-width", "min-height", "max-width", "max-height"]);

function trimNumber(n) {
  const rounded = Math.round(Number(n) * 10000) / 10000;
  return Number.isFinite(rounded) ? String(rounded) : "0";
}

function parseStyle(style) {
  const map = {};
  String(style || "").split(";").forEach((part) => {
    const i = part.indexOf(":");
    if (i < 0) return;
    const key = part.slice(0, i).trim().toLowerCase();
    const value = part.slice(i + 1).trim();
    if (key) map[key] = value;
  });
  return map;
}

function serializeStyle(map) {
  return Object.entries(map)
    .filter(([, value]) => value != null && value !== "")
    .map(([key, value]) => `${key}: ${value}`)
    .join("; ");
}

function readPx(value) {
  const match = String(value || "").trim().match(/^(-?\d+(?:\.\d+)?)px$/i);
  if (!match) return 0;
  const n = Number(match[1]);
  return Number.isFinite(n) && n > 0 ? n : 0;
}

function pxToMm(value, pxPerMm) {
  const match = String(value || "").trim().match(/^(-?\d+(?:\.\d+)?)px$/i);
  if (!match || !(pxPerMm > 0)) return value;
  return `${trimNumber(Number(match[1]) / pxPerMm)}mm`;
}

function uniformScale(transform) {
  const match = String(transform || "").match(/scale\(\s*(-?\d+(?:\.\d+)?)\s*\)/i);
  if (!match) return 1;
  const n = Number(match[1]);
  return Number.isFinite(n) && n > 0 ? n : 1;
}

function stripScaleTransform(transform) {
  return String(transform || "")
    .replace(/scale(?:x|y|3d)?\([^)]*\)/gi, "")
    .replace(/\s+/g, " ")
    .trim();
}

function scalePxLength(value, factor) {
  if (factor === 1) return value;
  const match = String(value || "").trim().match(/^(-?\d+(?:\.\d+)?)px$/i);
  if (!match) return value;
  return `${trimNumber(Number(match[1]) * factor)}px`;
}

function fitElementStyles(el, pxPerMm) {
  const style = parseStyle(el.getAttribute("style"));
  const factor = uniformScale(style.transform);
  if (factor !== 1) {
    if (style.width) style.width = scalePxLength(style.width, factor);
    if (style.height) style.height = scalePxLength(style.height, factor);
  }
  if (style.transform) {
    const next = stripScaleTransform(style.transform);
    if (next) style.transform = next;
    else delete style.transform;
  }
  delete style.zoom;
  if (!style.transform) delete style["transform-origin"];
  Object.keys(style).forEach((key) => {
    if (LENGTH_PROPS.has(key)) style[key] = pxToMm(style[key], pxPerMm);
  });
  if (Object.keys(style).length) el.setAttribute("style", serializeStyle(style));
  else el.removeAttribute("style");
}

/** Piksel tuvali etiket mm kutusuna oturt; scale/zoom bırakma. */
export function fitLabelHtmlToBox(html, { widthMm, heightMm } = {}) {
  const w = Number(widthMm) || 100;
  const h = Number(heightMm) || 30;
  const src = String(html || "");
  if (!src || typeof DOMParser === "undefined") return src;
  try {
    const doc = new DOMParser().parseFromString(`<div id="label-print-fit-root">${src}</div>`, "text/html");
    const root = doc.getElementById("label-print-fit-root");
    if (!root) return src;
    root.querySelectorAll(".lbl").forEach((lbl) => {
      const canvas = lbl.firstElementChild;
      const canvasPx = readPx(parseStyle(canvas?.getAttribute("style")).width);
      const pxPerMm = canvasPx > 0 ? canvasPx / w : LABEL_PX_PER_MM;
      lbl.querySelectorAll("*").forEach((el) => fitElementStyles(el, pxPerMm));
      if (canvas && canvasPx > 0) {
        const box = parseStyle(canvas.getAttribute("style"));
        box.position = "relative";
        box.width = `${trimNumber(w)}mm`;
        box.height = `${trimNumber(h)}mm`;
        box.overflow = "hidden";
        box.margin = "0";
        box.padding = "0";
        box["box-sizing"] = "border-box";
        delete box.zoom;
        delete box.transform;
        delete box["transform-origin"];
        canvas.setAttribute("style", serializeStyle(box));
      }
      const frame = parseStyle(lbl.getAttribute("style"));
      frame.width = `${trimNumber(w)}mm`;
      frame.height = `${trimNumber(h)}mm`;
      frame.position = "relative";
      frame.overflow = "hidden";
      frame.margin = "0";
      frame.padding = "0";
      frame["box-sizing"] = "border-box";
      frame["max-width"] = `${trimNumber(w)}mm`;
      delete frame.zoom;
      delete frame.transform;
      lbl.setAttribute("style", serializeStyle(frame));
    });
    return root.innerHTML;
  } catch {
    return src;
  }
}

function labelPrintCss({ isA4, w, h, cols, gap }) {
  const pageSize = isA4 ? "A4" : `${w}mm ${h}mm`;
  const pageMargin = isA4 ? "8mm" : "0";
  const bodyW = isA4 ? 210 : w;
  const sheetW = isA4 ? cols * w + Math.max(0, cols - 1) * gap : w;
  return `@page{size:${pageSize};margin:${pageMargin}}
html,body{margin:0;padding:0;width:${bodyW}mm;overflow-x:hidden;font-family:Arial,Helvetica,sans-serif;background:#fff;color:#000}
@media print{html,body{width:${bodyW}mm !important;margin:0 !important;padding:0 !important;overflow-x:hidden !important}}
.grid{display:grid;grid-template-columns:repeat(${cols},minmax(0,${w}mm));gap:${gap}mm;width:${sheetW}mm;margin:0;padding:0}
.lbl{width:${w}mm;height:${h}mm;min-width:0;max-width:${w}mm;position:relative;overflow:hidden;margin:0;padding:0;box-sizing:border-box;${isA4 ? "" : "page-break-after:always;break-after:page;"}break-inside:avoid;background:#fff}
.lbl:last-child{page-break-after:auto;break-after:auto}
svg{display:block;max-width:100%;max-height:100%;overflow:hidden}
img{max-width:100%;max-height:100%;object-fit:contain;-webkit-print-color-adjust:exact;print-color-adjust:exact;image-rendering:crisp-edges}
[data-label-box],[data-label-line]{-webkit-print-color-adjust:exact;print-color-adjust:exact}
[data-label-box] rect{stroke:#000!important;fill:none!important}
[data-label-line]{background:#000!important}`;
}

export function buildLabelPrintDocument({ html, tpl, page, baseHref, title = LABEL_PRINT_TITLE }) {
  const isA4 = page?.mode === "a4";
  const cols = isA4 ? Math.max(1, Number(page?.cols) || 1) : 1;
  const gap = Number(page?.gap_mm) || 0;
  const w = Number(tpl?.width_mm) || 100;
  const h = Number(tpl?.height_mm) || 30;
  const body = fitLabelHtmlToBox(absolutizeHtmlUrls(html, baseHref), { widthMm: w, heightMm: h });
  const safeTitle = String(title || LABEL_PRINT_TITLE)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");
  const titleJs = JSON.stringify(String(title || LABEL_PRINT_TITLE));
  const base = baseHref ? `<base href="${String(baseHref).replace(/"/g, "")}">` : "";
  return `<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><title>${safeTitle}</title><script>document.title=${titleJs}</script>${base}
<style>
${labelPrintCss({ isA4, w, h, cols, gap })}
</style></head><body><div class="grid">${body}</div></body></html>`;
}

function writePrintShell(win, title) {
  const safe = String(title || LABEL_PRINT_TITLE)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");
  const shell = `<!doctype html><html><head><meta charset="utf-8"><title>${safe}</title><script>document.title=${JSON.stringify(String(title || LABEL_PRINT_TITLE))}</script></head><body></body></html>`;
  win.document.open();
  win.document.write(shell);
  win.document.close();
  win.document.title = title || LABEL_PRINT_TITLE;
}

/** Sekme başlığı about:blank kalmasın diye pencereyi hemen "Etiketler" ile aç. */
export function createLabelPrintWindow(title = LABEL_PRINT_TITLE) {
  if (typeof window === "undefined" || typeof window.open !== "function") return null;
  const win = window.open("", "_blank", "width=900,height=700");
  if (!win) return null;
  try { writePrintShell(win, title); } catch { /* blob belgesi başlığı yine de yazar */ }
  return win;
}

function withAutoPrint(html, title) {
  const titleJs = JSON.stringify(String(title || LABEL_PRINT_TITLE));
  const script = `<script>document.title=${titleJs};window.addEventListener("load",function(){document.title=${titleJs};setTimeout(function(){document.title=${titleJs};window.focus();window.print()},350)});</script>`;
  const src = String(html || "");
  if (src.includes("</body>")) return src.replace("</body>", `${script}</body>`);
  return `${src}${script}`;
}

/** about:blank üzerine yazmak Chrome yazdırma başlığını değiştirmez; blob belge aç. */
export function showLabelPrintDocument(win, html, title = LABEL_PRINT_TITLE) {
  if (!win) return false;
  let url = "";
  try {
    const blob = new Blob([withAutoPrint(html, title)], { type: "text/html;charset=utf-8" });
    url = URL.createObjectURL(blob);
  } catch {
    return false;
  }
  try {
    win.location.replace(url);
  } catch {
    try { URL.revokeObjectURL(url); } catch { /* ignore */ }
    return false;
  }
  const timer = setTimeout(() => { try { URL.revokeObjectURL(url); } catch { /* ignore */ } }, 60000);
  if (typeof timer.unref === "function") timer.unref();
  return true;
}
