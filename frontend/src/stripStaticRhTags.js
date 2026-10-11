/**
 * index.js ile aynı seçici — Seo.test üretim boot adımını paylaşır.
 * React 19 + react-helmet-async 3 data-rh etiketlerini kaldırmıyor.
 */
export function stripStaticRhTags(root = document) {
  root.querySelectorAll('head [data-rh="true"]:not(title)').forEach((n) => n.remove());
}
