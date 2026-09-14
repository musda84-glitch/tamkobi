/**
 * Tarayıcıda görseli küçültüp JPEG/WebP üretir (sunucu image_opt ile birlikte çalışır).
 * GIF / PDF / HEIC olduğu gibi bırakılır (canvas HEIC desteklemez).
 */
export async function compressImageFile(file, opts = {}) {
  const maxEdge = opts.maxEdge ?? 1920;
  const quality = opts.quality ?? 0.82;
  if (!file || typeof file.type !== "string") return file;
  if (!file.type.startsWith("image/")) return file;
  if (file.type === "image/gif" || file.type === "image/heic" || file.type === "image/heif") return file;
  // Zaten küçükse dokunma
  if (file.size < 48 * 1024) return file;

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

    const preferWebp = typeof canvas.toBlob === "function";
    const blob = await _canvasToBlob(canvas, preferWebp ? "image/webp" : "image/jpeg", quality);
    if (!blob || blob.size >= file.size * 0.95) {
      // WebP kazanç sağlamadıysa JPEG dene
      const jpeg = await _canvasToBlob(canvas, "image/jpeg", quality);
      if (!jpeg || jpeg.size >= file.size * 0.95) return file;
      return _asFile(jpeg, file.name, "image/jpeg");
    }
    return _asFile(blob, file.name, blob.type || "image/webp");
  } finally {
    if (typeof bitmap.close === "function") bitmap.close();
  }
}

function _asFile(blob, originalName, type) {
  const base = (originalName || "image").replace(/\.[^.]+$/, "");
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
