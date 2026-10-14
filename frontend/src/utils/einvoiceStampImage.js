/**
 * Kaşe / imza görseli: yüklemede en fazla 400 px genişlik, ~150 KB altı.
 * Beyaz zemin, istemci canvas'ında şeffafa çevrilebilir. Harici URL yok.
 */

export const STAMP_MAX_WIDTH_PX = 400;
export const STAMP_MAX_BYTES = 150 * 1024;
export const STAMP_WHITE_THRESHOLD = 245;

const SAFE_DATA_URI = /^data:image\/(jpeg|jpg|png|gif|webp);base64,[A-Za-z0-9+/=]+$/i;

export function stampOverLimitWarning() {
  return `Kaşe görseli ${Math.round(STAMP_MAX_BYTES / 1024)} KB sınırını aşıyor. Daha küçük bir PNG veya JPG seçin.`;
}

export function stampPayloadBytes(dataUrl) {
  const s = String(dataUrl || "");
  const i = s.indexOf(",");
  const b64 = (i >= 0 ? s.slice(i + 1) : s).replace(/\s+/g, "");
  if (!b64) return 0;
  const pad = b64.endsWith("==") ? 2 : b64.endsWith("=") ? 1 : 0;
  return Math.max(0, Math.floor((b64.length * 3) / 4) - pad);
}

export function isSafeStampDataUrl(value) {
  const s = String(value || "").trim().replace(/\s+/g, "");
  return SAFE_DATA_URI.test(s) ? s : "";
}

export function stampWithinLimit(dataUrl, maxBytes = STAMP_MAX_BYTES) {
  const safe = isSafeStampDataUrl(dataUrl);
  if (!safe) return false;
  return stampPayloadBytes(safe) <= maxBytes;
}

/** Genişlik tavanı; oran korunur. */
export function scaledStampSize(width, height, maxWidth = STAMP_MAX_WIDTH_PX) {
  const w = Math.max(1, Math.round(Number(width) || 1));
  const h = Math.max(1, Math.round(Number(height) || 1));
  if (w <= maxWidth) return { width: w, height: h };
  const scale = maxWidth / w;
  return { width: maxWidth, height: Math.max(1, Math.round(h * scale)) };
}

/**
 * Beyaza yakın nötr pikselleri şeffaf yapar (taranmış kaşe zemini).
 * Açık renkli mürekkep (kanal farkı büyükse) kalır.
 */
export function knockoutNearWhite(imageData, threshold = STAMP_WHITE_THRESHOLD) {
  const d = imageData?.data;
  if (!d) return imageData;
  const limit = Number(threshold) || STAMP_WHITE_THRESHOLD;
  for (let i = 0; i < d.length; i += 4) {
    if (d[i + 3] === 0) continue;
    const r = d[i];
    const g = d[i + 1];
    const b = d[i + 2];
    const max = Math.max(r, g, b);
    const min = Math.min(r, g, b);
    if (min >= limit && max - min <= 18) d[i + 3] = 0;
  }
  return imageData;
}

function isPngOrJpeg(file) {
  const type = String(file?.type || "").toLowerCase();
  const name = String(file?.name || "").toLowerCase();
  if (type === "image/png" || type === "image/jpeg" || type === "image/jpg" || type === "image/pjpeg") return true;
  if (type.startsWith("image/")) return false;
  return /\.png$/.test(name) || /\.jpe?g$/.test(name);
}

function sourceSize(src) {
  return {
    width: src?.naturalWidth || src?.width || 1,
    height: src?.naturalHeight || src?.height || 1,
  };
}

function loadStampBitmap(file) {
  return new Promise((resolve) => {
    try {
      const url = URL.createObjectURL(file);
      const img = new Image();
      img.onload = () => {
        URL.revokeObjectURL(url);
        resolve(img);
      };
      img.onerror = () => {
        URL.revokeObjectURL(url);
        resolve(null);
      };
      img.src = url;
    } catch {
      resolve(null);
    }
  });
}

async function loadStampSource(file) {
  try {
    if (typeof createImageBitmap === "function") {
      return await createImageBitmap(file);
    }
  } catch {
    /* Image() yedek */
  }
  return loadStampBitmap(file);
}

function widthSteps(start) {
  const out = [];
  let w = Math.max(1, Math.round(start) || 1);
  const floor = Math.min(48, w);
  while (w >= floor) {
    out.push(w);
    if (w === floor) break;
    const next = Math.max(floor, Math.round(w * 0.75));
    if (next === w) break;
    w = next;
  }
  return out;
}

/**
 * PNG/JPG dosyasını küçültüp data URI üretir.
 * knockoutWhite: beyaz zemini şeffaf PNG yapar.
 * Sınırın altına inemezse dataUrl boş ve warning dolu döner.
 */
export async function prepareStampFile(file, opts = {}) {
  const knockoutWhite = !!opts.knockoutWhite;
  const maxWidth = opts.maxWidth ?? STAMP_MAX_WIDTH_PX;
  const maxBytes = opts.maxBytes ?? STAMP_MAX_BYTES;
  if (!file) return { dataUrl: "", warning: "Dosya seçilmedi." };
  if (!isPngOrJpeg(file)) return { dataUrl: "", warning: "Yalnız PNG veya JPG yükleyin." };
  const source = await loadStampSource(file);
  if (!source) return { dataUrl: "", warning: "Görsel okunamadı." };
  try {
    const base = scaledStampSize(sourceSize(source).width, sourceSize(source).height, maxWidth);
    const mime = knockoutWhite ? "image/png" : "image/jpeg";
    const qualities = knockoutWhite ? [undefined] : [0.82, 0.68, 0.54, 0.42];
    let best = "";
    let bestBytes = Infinity;
    for (const width of widthSteps(base.width)) {
      const height = Math.max(1, Math.round(base.height * (width / base.width)));
      const canvas = document.createElement("canvas");
      canvas.width = width;
      canvas.height = height;
      const ctx = canvas.getContext("2d");
      if (!ctx) return { dataUrl: "", warning: "Görsel işlenemedi." };
      ctx.clearRect(0, 0, width, height);
      if (!knockoutWhite) {
        ctx.fillStyle = "#ffffff";
        ctx.fillRect(0, 0, width, height);
      }
      ctx.drawImage(source, 0, 0, width, height);
      if (knockoutWhite) {
        const image = ctx.getImageData(0, 0, width, height);
        knockoutNearWhite(image, opts.threshold);
        ctx.putImageData(image, 0, 0);
      }
      for (const q of qualities) {
        const raw = q == null ? canvas.toDataURL(mime) : canvas.toDataURL(mime, q);
        const url = isSafeStampDataUrl(raw);
        if (!url) continue;
        const bytes = stampPayloadBytes(url);
        if (bytes < bestBytes) {
          best = url;
          bestBytes = bytes;
        }
        if (bytes <= maxBytes) return { dataUrl: url, warning: "" };
      }
    }
    if (best && bestBytes <= maxBytes) return { dataUrl: best, warning: "" };
    return { dataUrl: "", warning: stampOverLimitWarning() };
  } catch {
    return { dataUrl: "", warning: "Görsel işlenemedi." };
  } finally {
    if (typeof source.close === "function") source.close();
  }
}
