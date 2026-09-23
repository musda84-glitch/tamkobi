/**
 * Tarayıcıda görseli küçültüp JPEG/WebP üretir (sunucu image_opt ile birlikte çalışır).
 * GIF / HEIC olduğu gibi bırakılır (canvas HEIC desteklemez).
 *
 * opts:
 *  - maxEdge (default 1600)
 *  - quality (default 0.78)
 *  - targetBytes — mümkünse bu boyutun altına in (kalite basamakları)
 *  - force — küçük dosyalarda da yeniden kodla (kırpma sonrası)
 */
export async function compressImageFile(file, opts = {}) {
  const maxEdge = opts.maxEdge ?? 1600;
  const quality = opts.quality ?? 0.78;
  const targetBytes = opts.targetBytes ?? 220 * 1024;
  const force = !!opts.force;
  if (!file || typeof file.type !== "string") return file;
  if (!file.type.startsWith("image/")) return file;
  if (file.type === "image/gif" || file.type === "image/heic" || file.type === "image/heif") return file;
  if (!force && file.size < 48 * 1024) return file;

  const bitmap = await _loadBitmap(file);
  if (!bitmap) return file;
  try {
    let { width, height } = bitmap;
    const edge = Math.max(width, height);
    if (edge > maxEdge) {
      const scale = maxEdge / edge;
      width = Math.round(width * scale);
      height = Math.round(height * scale);
    }
    const canvas = document.createElement("canvas");
    canvas.width = width;
    canvas.height = height;
    const ctx = canvas.getContext("2d");
    if (!ctx) return file;
    ctx.drawImage(bitmap, 0, 0, width, height);

    const qualities = [quality, Math.max(0.45, quality - 0.12), Math.max(0.4, quality - 0.22)];
    let best = null;
    for (const q of qualities) {
      const webp = await _canvasToBlob(canvas, "image/webp", q);
      const jpeg = await _canvasToBlob(canvas, "image/jpeg", q);
      for (const blob of [webp, jpeg]) {
        if (!blob) continue;
        if (!best || blob.size < best.size) best = blob;
      }
      if (best && best.size <= targetBytes) break;
    }
    if (!best) return file;
    // Kırpma sonrası (force) her zaman yeni format; aksi halde yalnızca anlamlı kazançta değiştir
    if (!force && best.size >= file.size * 0.95) return file;
    return _asFile(best, file.name, best.type || "image/webp");
  } finally {
    if (typeof bitmap.close === "function") bitmap.close();
  }
}

/** Ürün galerisi: daha agresif sıkıştırma (etiket/kart için yeterli). */
export function compressProductImageFile(file) {
  return compressImageFile(file, { maxEdge: 1280, quality: 0.72, targetBytes: 160 * 1024, force: true });
}

function _asFile(blob, originalName, type) {
  const base = (originalName || "image").replace(/\.[^.]+$/, "").replace(/-crop$/i, "");
  const ext = type === "image/webp" ? "webp" : type === "image/png" ? "png" : "jpg";
  return new File([blob], `${base}.${ext}`, { type, lastModified: Date.now() });
}

async function _loadBitmap(file) {
  try {
    if (typeof createImageBitmap === "function") {
      return await createImageBitmap(file);
    }
  } catch {
    /* fall through */
  }
  return new Promise((resolve) => {
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
  });
}

function _canvasToBlob(canvas, type, quality) {
  return new Promise((resolve) => {
    if (!canvas.toBlob) {
      try {
        const dataUrl = canvas.toDataURL(type, quality);
        const bin = atob(dataUrl.split(",")[1] || "");
        const arr = new Uint8Array(bin.length);
        for (let i = 0; i < bin.length; i++) arr[i] = bin.charCodeAt(i);
        resolve(new Blob([arr], { type }));
      } catch {
        resolve(null);
      }
      return;
    }
    canvas.toBlob((b) => resolve(b), type, quality);
  });
}
