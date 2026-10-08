/**
 * Tarayıcıda görseli küçültüp JPEG/WebP üretir (sunucu image_opt ile birlikte çalışır).
 * GIF / HEIC olduğu gibi bırakılır (canvas HEIC desteklemez).
 *
 * opts:
 *  - maxEdge (default 1600)
 *  - quality (default 0.78)
 *  - targetBytes — mümkünse bu boyutun altına in (kalite basamakları)
 *  - force — küçük dosyalarda da yeniden kodla (kırpma sonrası)
 *  - preferWebp — WebP varsa onu tercih et (ürün galerisi)
 *  - preferJpeg — yalnızca JPEG dene
 */
export async function compressImageFile(file, opts = {}) {
  const maxEdge = opts.maxEdge ?? 1600;
  const quality = opts.quality ?? 0.78;
  const targetBytes = opts.targetBytes ?? 220 * 1024;
  const force = !!opts.force;
  const preferJpeg = !!opts.preferJpeg;
  const preferWebp = !!opts.preferWebp && !preferJpeg;
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

    const qualities = [
      quality,
      Math.max(0.42, quality - 0.12),
      Math.max(0.38, quality - 0.22),
      Math.max(0.35, quality - 0.32),
    ];
    let best = null;
    let bestWebp = null;
    for (const q of qualities) {
      const webp = preferJpeg ? null : await _canvasToBlob(canvas, "image/webp", q);
      const jpeg = preferWebp ? null : await _canvasToBlob(canvas, "image/jpeg", q);
      // preferWebp: önce WebP; yoksa JPEG yedek
      if (preferWebp) {
        if (webp && webp.type === "image/webp") {
          if (!bestWebp || webp.size < bestWebp.size) bestWebp = webp;
          if (!best || webp.size < best.size) best = webp;
        } else if (jpeg && (!best || jpeg.size < best.size)) {
          best = jpeg;
        }
      } else {
        for (const blob of [jpeg, webp]) {
          if (!blob) continue;
          if (!best || blob.size < best.size) best = blob;
        }
      }
      const hit = preferWebp ? bestWebp || best : best;
      if (hit && hit.size <= targetBytes) break;
    }
    if (preferWebp && bestWebp) best = bestWebp;
    // preferWebp iken tarayıcı WebP üretmediyse JPEG ile bir kez daha dene
    if (preferWebp && !bestWebp && !best) {
      for (const q of qualities) {
        const jpeg = await _canvasToBlob(canvas, "image/jpeg", q);
        if (jpeg && (!best || jpeg.size < best.size)) best = jpeg;
        if (best && best.size <= targetBytes) break;
      }
    }
    if (!best) return file;
    // Kırpma sonrası (force) her zaman yeni format; aksi halde yalnızca anlamlı kazançta değiştir
    if (!force && best.size >= file.size * 0.95) return file;
    return _asFile(best, file.name, best.type || "image/webp");
  } finally {
    if (typeof bitmap.close === "function") bitmap.close();
  }
}

/** Ürün galerisi: WebP öncelikli agresif sıkıştırma (kart/etiket için yeterli). */
export function compressProductImageFile(file) {
  return compressImageFile(file, {
    maxEdge: 1200,
    quality: 0.66,
    targetBytes: 100 * 1024,
    force: true,
    preferWebp: true,
  });
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
