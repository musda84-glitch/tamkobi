/** Sol menü grupları — Platform → Paketler / Web vitrinindeki kategorilerle aynı.
 * Grup yalnızca görünüm içindir; RBAC ve lisans anahtarları değişmez.
 * backend/saas.py CATEGORIES ile etiketleri senkron tutun.
 */
export const NAV_GROUPS = [
  { id: "overview", label: null },
  { id: "muhasebe", label: "Muhasebe" },
  { id: "finans", label: "Finans" },
  { id: "raporlama", label: "Raporlama" },
  { id: "satis", label: "Satış" },
  { id: "stok", label: "Stok & Depo" },
  { id: "uretim", label: "Üretim" },
  { id: "eticaret", label: "E-Ticaret" },
  { id: "ik", label: "İK" },
  { id: "iletisim", label: "İletişim" },
  { id: "ai", label: "Yapay Zeka" },
  { id: "sistem", label: "Sistem" },
];

const PATH_GROUP = {
  "/": "overview",
  "/invoices": "muhasebe",
  "/edoc-inbox": "muhasebe",
  "/dispatches": "muhasebe",
  "/contacts": "muhasebe",
  "/installments": "muhasebe",
  "/dis-ticaret": "muhasebe",
  "/banking": "finans",
  "/expenses": "finans",
  "/loans": "finans",
  "/cheques": "finans",
  "/reports": "raporlama",
  "/accountant": "raporlama",
  "/projects": "satis",
  "/quotes": "satis",
  "/surveys": "satis",
  "/orders": "satis",
  "/b2b-yonetim": "satis",
  "/saha": "satis",
  "/stock": "stok",
  "/warehouses": "stok",
  "/sayim": "stok",
  "/sevk": "stok",
  "/production": "uretim",
  "/atolye": "uretim",
  "/ecommerce": "eticaret",
  "/cargo": "eticaret",
  "/personnel": "ik",
  "/mesai": "ik",
  "/communication": "iletisim",
  "/ai-advisor": "ai",
  "/settings": "sistem",
  "/trash": "sistem",
  "/sistem": "sistem",
};

export function groupIdOf(path) {
  return PATH_GROUP[path] || "sistem";
}

export function groupMenuItems(items) {
  const buckets = Object.fromEntries(NAV_GROUPS.map((g) => [g.id, []]));
  for (const item of items || []) {
    const id = groupIdOf(item.path);
    (buckets[id] || buckets.sistem).push(item);
  }
  return NAV_GROUPS.map((g) => ({ ...g, items: buckets[g.id] || [] })).filter((g) => g.items.length);
}

/** Platform paneli: Web, Paketler, Kurallar — vitrin paketleri gibi klasörler.
 * `SYSTEM_NAV`'de olmayan path'ler sessizce atlanır (canlıdaki Posta / AI gibi ekler).
 */
export const SYSTEM_NAV_GROUPS = [
  { id: "overview", label: null, paths: ["/sistem"] },
  { id: "web", label: "Web", paths: ["/sistem/web"] },
  { id: "paketler", label: "Paketler", paths: ["/sistem/paketler", "/sistem/moduller"] },
  { id: "musteriler", label: "Müşteriler", paths: ["/sistem/sirketler", "/sistem/kotalar", "/sistem/kullanicilar"] },
  { id: "musteriler", label: "Müşteriler", paths: ["/sistem/sirketler", "/sistem/kullanicilar"] },
  { id: "operasyon", label: "Operasyon", paths: ["/sistem/talepler", "/sistem/odemeler", "/sistem/hatirlatmalar"] },
  { id: "entegrasyon", label: "Entegrasyon", paths: ["/sistem/posta", "/sistem/ai"] },
  { id: "kurallar", label: "Kurallar", paths: ["/sistem/ayarlar"] },
];

/** Firma Ayarları sekmeleri — aynı paket klasörleri. */
export const SETTINGS_TAB_GROUPS = [
  { id: "firma", label: "Firma", tabs: ["company"] },
  { id: "paketler", label: "Paketler", tabs: ["plan", "modules"] },
  { id: "belgeler", label: "Belgeler", tabs: ["print", "einvoice"] },
  { id: "web", label: "Web & Entegrasyon", tabs: ["sms", "mail", "bank", "fx", "channels", "whatsapp"] },
  { id: "web", label: "Web & Entegrasyon", tabs: ["sms", "mail", "bank", "channels", "whatsapp"] },
  { id: "kurallar", label: "Kurallar", tabs: ["units", "users"] },
  { id: "veri", label: "Veri", tabs: ["migration", "summary"] },
];
