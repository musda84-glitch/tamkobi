/** String veya {url,image_url,...} galeri öğesini URL'ye çevir. */
export function mediaRef(v) {
  if (v == null || v === "") return "";
  if (typeof v === "string") return v.trim();
  if (typeof v === "object") {
    const u = v.url ?? v.image_url ?? v.thumbnail_url ?? v.src ?? v.path ?? v.file;
    return u == null ? "" : String(u).trim();
  }
  return String(v).trim();
}

/** Stok kartı galerisi: dizi yoksa kapak resmi. Nesne öğeleri URL'ye indirgenir. */
export function productGalleryUrls(product) {
  const raw = product?.images;
  const fromList = Array.isArray(raw) ? raw.map(mediaRef).filter(Boolean) : [];
  if (fromList.length) return fromList;
  const cover = mediaRef(product?.image_url);
  return cover ? [cover] : [];
}

/** Etiket / barkod yazdırmada kullanılacak görsel (seçili etiket görseli veya kapak). */
export function productLabelImageUrl(product) {
  return mediaRef(product?.label_image_url) || mediaRef(product?.image_url) || "";
}

export function productIdOf(product) {
  return product?.id || product?._id || "";
}
