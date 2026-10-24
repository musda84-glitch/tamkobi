import { listThumbUrl } from "./imageUrl";

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

/** Kartta 600 px istenecek kapak. Liste thumb'ı (200 px) büyütülmez. */
export function productCardImageUrl(product) {
  return (
    mediaRef(product?.image_url)
    || (Array.isArray(product?.images) && mediaRef(product.images[0]))
    || mediaRef(product?.thumbnail_url)
    || ""
  );
}

/** Liste/kart küçük önizleme — thumbnail yoksa kapak. */
export function productListImageUrl(product) {
  return (
    mediaRef(product?.thumbnail_url)
    || mediaRef(product?.image_url)
    || (Array.isArray(product?.images) && mediaRef(product.images[0]))
    || ""
  );
}

/** Sipariş satırı + stok kartı birleşik liste görseli.
 * Pazaryeri/entegrasyon satır görseli (image_url) stok kartından önce gelir —
 * Gelen Siparişler ÜRÜNLER sütunu Ürünler & Fiyat listesiyle aynı kaynağı kullanır.
 */
export function orderLineListImageUrl(item, product) {
  return (
    mediaRef(item?.thumbnail_url)
    || mediaRef(item?.image_url)
    || mediaRef(product?.thumbnail_url)
    || mediaRef(product?.image_url)
    || (Array.isArray(product?.images) && mediaRef(product.images[0]))
    || ""
  );
}

export function productIdOf(product) {
  return product?.id || product?._id || "";
}

/** Sipariş listesi ve açılan satır aynı 200 px adresi kullanır. */
export function orderLineThumbSrc(item, product) {
  return listThumbUrl(orderLineListImageUrl(item, product));
}

/**
 * Görünen sipariş kalemlerinin küçük resim adresleri.
 * limit null ise siparişin bütün kalemleri; aksi halde ilk N kalem.
 * Aynı adres bir kez döner.
 */
export function collectOrderThumbSrcs(orders, resolveProduct, limit = 2) {
  const out = [];
  const seen = new Set();
  for (const ord of orders || []) {
    const items = Array.isArray(ord?.items) ? ord.items : [];
    const slice = limit == null ? items : items.slice(0, Math.max(0, limit));
    for (const it of slice) {
      const src = orderLineThumbSrc(it, resolveProduct ? resolveProduct(it) : null);
      if (!src || seen.has(src)) continue;
      seen.add(src);
      out.push(src);
    }
  }
  return out;
}

/** Adresleri bekletmeden, aynı anda Image ile başlat. */
export function preloadOrderThumbSrcs(srcs) {
  const list = Array.isArray(srcs) ? srcs : [];
  for (const src of list) {
    if (!src || typeof Image === "undefined") continue;
    const img = new Image();
    img.decoding = "async";
    img.src = src;
  }
  return list.length;
}
