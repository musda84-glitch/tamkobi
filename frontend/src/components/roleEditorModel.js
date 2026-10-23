/** Rol düzenleyici satırları. Bir satır birden fazla modül anahtarını birlikte tutar. */

export const LEVELS = [
  ["none", "Kapalı"],
  ["view", "Görür"],
  ["edit", "Ekler/Düzenler"],
  ["delete", "Siler"],
];

export const LEVEL_RANK = { none: 0, view: 1, edit: 2, delete: 3 };

export const ROLE_TEMPLATES = [
  { code: "admin", label: "Yönetici" },
  { code: "accountant", label: "Muhasebe" },
  { code: "sales", label: "Satış" },
  { code: "warehouse", label: "Depo" },
  { code: "production", label: "Atölye personeli" },
  { code: "personel", label: "Saha personeli" },
  { code: "advisor", label: "Mali Müşavir" },
];

export const EDITOR_GROUPS = [
  {
    id: "finans",
    label: "Finans",
    icon: "💰",
    rows: [
      { key: "/invoices", title: "Faturalar & e-Belge", help: "Satış/alış faturası, e-Fatura, e-Arşiv, gelen e-belgeler, irsaliye", keys: ["/invoices", "/edoc-inbox", "/dispatches", "/dis-ticaret"] },
      { key: "/banking", title: "Banka, Kasa & POS", help: "Hesaplar, banka senkronu, virman, POS", keys: ["/banking"] },
      { key: "/cheques", title: "Çek / Senet", help: "Portföy, tahsil, ciro", keys: ["/cheques"] },
      { key: "/expenses", title: "Masraflar", help: "Masraf fişi ve bütçe", keys: ["/expenses"] },
      { key: "/loans", title: "Krediler & Taksitler", help: "Kredi, kredi kartı, taksit planları", keys: ["/loans", "/installments"] },
      { key: "/kontor", title: "Kontör", help: "GİB e-belge kontör bakiyesi ve hareketleri", keys: ["/kontor"] },
    ],
  },
  {
    id: "satis",
    label: "Satış",
    icon: "🛒",
    rows: [
      { key: "/contacts", title: "Cari Hesaplar", help: "Müşteri/tedarikçi, ekstre, bakiye", keys: ["/contacts"] },
      { key: "/orders", title: "Teklif & Sipariş", help: "Teklif, onay, sipariş, iade, kargo", keys: ["/quotes", "/orders", "/projects", "/surveys", "/cargo", "/ecommerce", "/saha"] },
      { key: "/hizli-satis", title: "Hızlı Satış (POS)", help: "Perakende satış ekranı", keys: ["/hizli-satis"] },
      { key: "/b2b-yonetim", title: "B2B Bayi Portalı", help: "Bayi erişimi ve portal ayarları", keys: ["/b2b-yonetim"] },
    ],
  },
  {
    id: "stok",
    label: "Stok & Depo",
    icon: "📦",
    rows: [
      { key: "/stock", title: "Stok & Ürünler", help: "Ürün kartı, barkod, etiket", keys: ["/stock"] },
      { key: "/warehouses", title: "Depo, Sayım & Sevkiyat", help: "Transfer, sayım, sipariş toplama", keys: ["/warehouses", "/sayim", "/sevk", "/vehicles"] },
      { key: "/purchase-orders", title: "Verilen Siparişler", help: "Tedarikçi siparişleri", keys: ["/purchase-orders"] },
    ],
  },
  {
    id: "uretim",
    label: "Üretim",
    icon: "🏭",
    rows: [
      { key: "/production", title: "Üretim & Reçete", help: "Reçete, üretim emri, eksik malzeme", keys: ["/production"] },
      { key: "/atolye", title: "Atölye Ekranı", help: "Tablet iş emri, operatör PIN", keys: ["/atolye"] },
    ],
  },
  {
    id: "ik",
    label: "İK",
    icon: "🧑‍💼",
    rows: [
      { key: "/personnel", title: "Personel & Bordro", help: "Personel kartı, ücret, izin", keys: ["/personnel"] },
      { key: "/mesai", title: "Mesai", help: "Giriş-çıkış ve puantaj", keys: ["/mesai"] },
    ],
  },
  {
    id: "diger",
    label: "Diğer",
    icon: "⚙️",
    rows: [
      { key: "/reports", title: "Raporlar", help: "Satış, stok, nakit, KDV raporları ve dışa aktarım", keys: ["/reports"] },
      { key: "/communication", title: "İletişim", help: "SMS, e-posta, WhatsApp", keys: ["/communication", "/support"] },
      { key: "/ai-advisor", title: "AI Asistan", help: "Sohbet ve belge okuma", keys: ["/ai-advisor"] },
      { key: "/company-share", title: "Şirketler arası paylaşım", help: "Cari, stok, fiyat ve fatura okuma bağlantısı", keys: ["/company-share"] },
      { key: "/settings", title: "Firma Ayarları", help: "Kullanıcı, rol, entegrasyon ve sanal POS", keys: ["/settings"] },
      { key: "/accountant", title: "Mali Müşavir Paneli", help: "KDV özeti, beyanname evrakı", keys: ["/accountant"] },
      { key: "/trash", title: "Çöp Kutusu", help: "Silinen kayıtlar, 30 gün içinde geri alma", keys: ["/trash"] },
      { key: "/", title: "Genel Bakış", help: "Özet pano ve hızlı işlemler", keys: ["/"] },
    ],
  },
];

export const FEATURE_GROUPS = [
  { id: "price", title: "Fiyatları görebilir", keys: ["view_prices"] },
  { id: "portal", title: "Personel portalı ve mobil saha", keys: ["portal_atolye", "portal_pick", "portal_sayim", "portal_saha", "portal_vehicles", "portal_orders"] },
  { id: "shortcuts", title: "Kısayollar (yalnızca görünüm)", keys: ["header_barcode", "header_virman", "header_invoice", "header_ai", "production_ai", "support_bar"] },
  { id: "orders", title: "Sipariş ve sevk butonları", keys: ["order_cargo_label", "order_more_actions", "sevk_open_order", "sevk_draft_invoice"] },
  { id: "account", title: "Hesap", keys: ["account_companies", "export_personal_data", "company_audit"] },
];

export function rowLevel(perms, keys) {
  const levels = (keys || []).map((key) => perms?.[key] || "none");
  if (!levels.length) return { level: "none", mixed: false };
  const unique = [...new Set(levels)];
  if (unique.length === 1) return { level: unique[0], mixed: false };
  const level = levels.reduce((min, cur) => (LEVEL_RANK[cur] < LEVEL_RANK[min] ? cur : min));
  return { level, mixed: true };
}

export function applyRowLevel(perms, keys, level) {
  const next = { ...(perms || {}) };
  (keys || []).forEach((key) => { next[key] = level; });
  return next;
}

export function visibleRows(group, { query = "", openOnly = false, perms = {}, unwired = new Set() } = {}) {
  const q = query.trim().toLocaleLowerCase("tr");
  return group.rows.filter((row) => {
    const keys = row.keys.filter((key) => !unwired.has(key));
    if (!keys.length) return false;
    const { level } = rowLevel(perms, keys);
    if (openOnly && level === "none") return false;
    if (!q) return true;
    const blob = `${row.title} ${row.help} ${group.label}`.toLocaleLowerCase("tr");
    return blob.includes(q);
  }).map((row) => ({ ...row, keys: row.keys.filter((key) => !unwired.has(key)) }));
}

export function roleSummary(perms, features) {
  const can = [];
  const cannot = [];
  const allow = (key, level) => LEVEL_RANK[perms?.[key] || "none"] >= LEVEL_RANK[level];
  if (allow("/invoices", "edit")) can.push("Fatura kesebilir, e-Fatura gönderebilir");
  else if (allow("/invoices", "view")) can.push("Faturaları görür; yeni fatura kesemez");
  if (allow("/contacts", "edit") || allow("/orders", "edit") || allow("/quotes", "edit")) {
    can.push("Cari, teklif ve sipariş ekler/düzenler");
  } else if (allow("/contacts", "view") || allow("/orders", "view") || allow("/quotes", "view")) {
    can.push("Cari ve siparişleri görür");
  }
  const sees = [];
  if (allow("/banking", "view")) sees.push("Banka");
  if (allow("/cheques", "view")) sees.push("çek");
  if (allow("/stock", "view")) sees.push("stok");
  if (allow("/reports", "view")) sees.push("raporları");
  if (sees.length) {
    const head = sees[0] === "Banka" ? "Banka" : sees[0];
    const rest = sees.slice(sees[0] === "Banka" ? 1 : 0);
    can.push(`${[head, ...rest].join(", ")} görür`);
  }
  if (allow("/mesai", "edit")) can.push("Mesai kayıtlarını düzenler");
  else if (allow("/mesai", "view")) can.push("Mobilde mesai giriş-çıkışı yapar");
  const anyDelete = Object.values(perms || {}).some((level) => level === "delete");
  if (!anyDelete) cannot.push("Kayıt silemez");
  const closed = [];
  if (!allow("/production", "view") && !allow("/atolye", "view")) closed.push("Üretim");
  if (!allow("/personnel", "view")) closed.push("personel");
  if (!allow("/settings", "view")) closed.push("ayarlar");
  if (closed.length) cannot.push(`${closed.join(", ")} kapalı`);
  if (features?.view_prices === false) cannot.push("Fiyatlar gizli");
  else cannot.push("Fiyatları görür (gizlemek için Gelişmiş)");
  return { can, cannot };
}

const SUMMARY_CHIP = {
  "Fatura kesebilir, e-Fatura gönderebilir": "Fatura keser",
  "Faturaları görür; yeni fatura kesemez": "Faturaları görür",
  "Cari, teklif ve sipariş ekler/düzenler": "Cari/teklif/sipariş düzenler",
  "Cari ve siparişleri görür": "Cari/sipariş görür",
  "Mesai kayıtlarını düzenler": "Mesai düzenler",
  "Mobilde mesai giriş-çıkışı yapar": "Mesai girişi",
  "Kayıt silemez": "Silemez",
  "Fiyatlar gizli": "Fiyat gizli",
  "Fiyatları görür (gizlemek için Gelişmiş)": "Fiyat gizli değil",
};

/** Özet cümlesinin şerit etiketi. Bilinmeyen cümle aynı mantığın metninden kısaltılır. */
export function summaryChipText(line) {
  if (SUMMARY_CHIP[line]) return SUMMARY_CHIP[line];
  const plain = String(line || "").replace(/\s*\([^)]*\)/g, "");
  if (plain.endsWith(" görür")) return `${plain.slice(0, -" görür".length).split(", ").join("·")} görür`;
  if (plain.endsWith(" kapalı")) return plain.replace(/, /g, "·");
  return plain;
}

export function summaryChips(perms, features) {
  const { can, cannot } = roleSummary(perms, features);
  return {
    can,
    cannot,
    chips: [
      ...can.map((line) => ({ tone: "can", line, label: summaryChipText(line) })),
      ...cannot.map((line) => ({ tone: "cannot", line, label: summaryChipText(line) })),
    ],
  };
}

/**
 * Yatay şeritte kaç etiketin sığacağını sayar.
 * available <= 0 ise ölçüm yoktur; etiketlerin tümü gösterilir.
 * Sığmayan varsa +N rozetinin genişliği (moreWidth) ayrılır.
 */
export function fitChipCount(widths, available, moreWidth = 40, gap = 6) {
  const list = widths || [];
  if (!list.length) return 0;
  if (!(available > 0)) return list.length;
  let used = 0;
  let count = 0;
  for (let i = 0; i < list.length; i += 1) {
    const gapBefore = count > 0 ? gap : 0;
    const hiddenAfter = list.length - (i + 1);
    const reserve = hiddenAfter > 0 ? gap + moreWidth : 0;
    if (used + gapBefore + list[i] + reserve > available) break;
    used += gapBefore + list[i];
    count += 1;
  }
  return count;
}

export function editorOverflowGuard() {
  return "max-w-full min-w-0 max-[700px]:overflow-x-hidden";
}
