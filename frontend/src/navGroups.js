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
  "/panel": "overview",
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
  "/hizli-satis": "satis",
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
  "/support": "iletisim",
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
 * Bölümlerin kendisi systemSections.jsx'te; burada yalnızca sıra ve etiketler var.
 */
export const SYSTEM_NAV_GROUPS = [
  { id: "overview", label: null, paths: ["/sistem"] },
  { id: "web", label: "Web", paths: ["/sistem/web"] },
  { id: "paketler", label: "Paketler", paths: ["/sistem/paketler", "/sistem/moduller"] },
  { id: "musteriler", label: "Müşteriler", paths: ["/sistem/sirketler", "/sistem/kotalar", "/sistem/depolama", "/sistem/kullanicilar", "/sistem/veri-silme"] },
  { id: "operasyon", label: "Operasyon", paths: ["/sistem/destek", "/sistem/talepler", "/sistem/odemeler", "/sistem/hatirlatmalar"] },
  { id: "entegrasyon", label: "Entegrasyon", paths: ["/sistem/posta", "/sistem/ai", "/sistem/araclar"] },
  { id: "kurallar", label: "Kurallar", paths: ["/sistem/veritabani", "/sistem/ayarlar"] },
];

/** Platform bölümlerini yukarıdaki klasörlere dağıtır.
 * Hiçbir gruba yazılmamış bir bölüm menüden düşmez, sonda "Diğer"de görünür:
 * bölüm eklerken grubu unutmak bağlantıyı kaybetmeye yetmesin.
 */
export function groupSystemSections(sections) {
  const byPath = new Map((sections || []).map((s) => [s.path, s]));
  const placed = new Set();
  const groups = SYSTEM_NAV_GROUPS.map((g) => {
    const items = g.paths.map((p) => byPath.get(p)).filter(Boolean);
    items.forEach((s) => placed.add(s.path));
    return { id: g.id, label: g.label, items };
  });
  const rest = (sections || []).filter((s) => !placed.has(s.path));
  if (rest.length) groups.push({ id: "diger", label: "Diğer", items: rest });
  return groups.filter((g) => g.items.length);
}

/** Firma Ayarları sekmeleri — aynı paket klasörleri. */
export const SETTINGS_TAB_GROUPS = [
  { id: "firma", label: "Firma", tabs: ["company"] },
  { id: "paketler", label: "Paketler", tabs: ["plan", "modules"] },
  { id: "belgeler", label: "Belgeler", tabs: ["print", "einvoice"] },
  { id: "web", label: "Web & Entegrasyon", tabs: ["sms", "mail", "bank", "fx", "channels", "whatsapp", "extension"] },
  { id: "kurallar", label: "Kurallar", tabs: ["units", "users"] },
  { id: "veri", label: "Veri", tabs: ["migration", "storage", "summary"] },
];
