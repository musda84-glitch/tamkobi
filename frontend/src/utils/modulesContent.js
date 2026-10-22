/**
 * tamkobi.com /moduller ve /urunler vitrin metinleri.
 * Kart ve madde metinleri onaylı mockup HTML'inden gelir.
 * Görseller public/brand/screenshots/<slug>.png; dosya yoksa yer tutucu çizilir.
 * width/height dosyaların gerçek piksel ölçüsüdür; görseller yeniden boyutlandırılmaz.
 */

export const MODULE_CATEGORIES = [
  { id: "tumu", label: "Tümü" },
  { id: "finans", label: "Finans" },
  { id: "satis", label: "Satış" },
  { id: "stok", label: "Stok" },
  { id: "ik", label: "İK" },
  { id: "uretim", label: "Üretim" },
  { id: "entegrasyon", label: "Entegrasyon" },
];

const ACCENT = {
  finans: "#2d7bff",
  satis: "#7b3ff2",
  stok: "#c6f432",
  ik: "#f59e0b",
  uretim: "#4f2fd0",
  entegrasyon: "#14b8a6",
};

export const MODULES = [
  {
    slug: "e-fatura",
    category: "finans",
    icon: "🧾",
    title: "e-Fatura & e-Arşiv",
    summary: "GİB'e bağlı entegratörünüz üzerinden e-Fatura, e-Arşiv ve e-İrsaliye.",
    detail: "GİB'e bağlı bir entegratör üzerinden e-belgelerinizi düzenleyin; gelen belgeler uygulama içi kutuda sizi bekler.",
    points: [
      "e-Fatura, e-Arşiv ve e-İrsaliye gönderimi",
      "Gelen e-belge kutusu",
      "Kontör bakiyesi takibi",
      "Fatura tasarımı seçimi ve UBL dışa aktarım",
    ],
  },
  {
    slug: "banka",
    category: "finans",
    icon: "🏦",
    title: "Banka Entegrasyonu",
    summary: "Desteklenen bankalarda hareketler API ile gelir, carilerle eşleşir.",
    detail: "Desteklenen bankalarda hareketler API ile gelir, carilerle eşleşir.",
    points: [
      "Desteklenen bankalarda hesap hareketleri",
      "Hareketler API ile panele gelir",
      "Gelen hareketler carilerle eşleşir",
      "Eşleşen cari kaydı panelden izlenir",
    ],
  },
  {
    slug: "cek-senet",
    category: "finans",
    icon: "📄",
    title: "Çek / Senet",
    summary: "Portföydeki evrakları vadeleriyle izleyin.",
    detail: "Portföydeki evrakları vadeleriyle izleyin.",
    points: [
      "Portföydeki çekler",
      "Portföydeki senetler",
      "Vadeleriyle izleme",
      "Evraklar tek listede",
    ],
  },
  {
    slug: "kasa-pos",
    category: "finans",
    icon: "💳",
    title: "Kasa & Sanal POS",
    summary: "Kasa hareketleri ve kartla tahsilat tek yerde.",
    detail: "Kasa hareketleri ve kartla tahsilat tek yerde.",
    points: [
      "Kasa hareketleri",
      "Kartla tahsilat",
      "Kasa ve sanal POS aynı yerde",
      "Tahsilat kaydı panelden",
    ],
  },
  {
    slug: "cari",
    category: "satis",
    icon: "👥",
    title: "Cari Hesaplar",
    summary: "Bakiye, ekstre ve vadeleri izleyin; ekstreyi bağlantıyla paylaşın.",
    detail: "Bakiye, ekstre ve vadeleri izleyin; ekstreyi bağlantıyla paylaşın.",
    points: [
      "Bakiye takibi",
      "Ekstre görüntüleme",
      "Vadeleri izleme",
      "Ekstreyi bağlantıyla paylaşma",
    ],
  },
  {
    slug: "teklif-siparis",
    category: "satis",
    icon: "🛒",
    title: "Teklif & Sipariş",
    summary: "Teklif hazırlayın, müşteri onaylasın, siparişe dönüştürün.",
    detail: "Teklif hazırlayın, müşteri onaylasın, siparişe dönüştürün.",
    points: [
      "Teklif hazırlama",
      "Müşteri onayı",
      "Siparişe dönüştürme",
      "Teklif ve sipariş aynı akışta",
    ],
  },
  {
    slug: "b2b-portal",
    category: "satis",
    icon: "🤝",
    title: "B2B Bayi Portalı",
    summary: "Bayileriniz özel fiyatlarla katalogdan sipariş versin.",
    detail: "Bayileriniz özel fiyatlarla katalogdan sipariş versin.",
    points: [
      "Bayi kataloğu",
      "Bayiye özel fiyatlar",
      "Katalogdan sipariş",
      "Bayi siparişi panele düşer",
    ],
  },
  {
    slug: "stok",
    category: "stok",
    icon: "📦",
    title: "Stok & Barkod",
    summary: "Barkodla sayım, kritik stok uyarısı ve sevkiyat toplama.",
    detail: "Barkodla sayım, kritik stok uyarısı ve sevkiyat toplama.",
    points: [
      "Barkodla sayım",
      "Kritik stok uyarısı",
      "Sevkiyat toplama",
      "Stok hareketi panelden",
    ],
  },
  {
    slug: "kargo",
    category: "stok",
    icon: "🚚",
    title: "Kargo",
    summary: "Gönderi oluşturun, etiket basın, takip edin.",
    detail: "Gönderi oluşturun, etiket basın, takip edin.",
    points: [
      "Gönderi oluşturma",
      "Etiket basma",
      "Gönderi takibi",
      "Kargo durumu siparişte",
    ],
  },
  {
    slug: "personel",
    category: "ik",
    icon: "🕒",
    title: "Personel & Mesai",
    summary: "Konum doğrulamalı mobil giriş-çıkış, ücret ve ödemeler.",
    detail: "Konum doğrulamalı mobil giriş-çıkış, ücret ve ödemeler.",
    points: [
      "Mobil giriş-çıkış",
      "Konum doğrulama",
      "Ücret takibi",
      "Personel ödemeleri",
    ],
  },
  {
    slug: "atolye-is-emirleri",
    category: "uretim",
    icon: "🏭",
    title: "Atölye & İş Emirleri",
    summary: "Reçete, iş emri ve operatör ekranıyla üretim takibi.",
    detail: "Reçete, iş emri ve operatör ekranıyla üretim takibi.",
    points: [
      "Ürün reçetesi",
      "İş emri",
      "Operatör ekranı",
      "Üretim takibi",
    ],
  },
  {
    slug: "projeler",
    category: "uretim",
    icon: "📐",
    title: "Projeler",
    summary: "Projeleri aşama ve fotoğraflarla takip edin.",
    detail: "Projeleri aşama ve fotoğraflarla takip edin.",
    points: [
      "Proje aşamaları",
      "Aşama fotoğrafları",
      "Proje ilerlemesi",
      "Aşamaları panelden izleme",
    ],
  },
  {
    slug: "pazaryerleri",
    category: "entegrasyon",
    icon: "🛍️",
    title: "Pazaryerleri",
    summary: "Trendyol, Hepsiburada, n11, Amazon, Çiçeksepeti siparişleri.",
    detail: "Trendyol, Hepsiburada, n11, Amazon, Çiçeksepeti siparişleri.",
    points: [
      "Trendyol siparişleri",
      "Hepsiburada siparişleri",
      "n11 siparişleri",
      "Amazon ve Çiçeksepeti siparişleri",
    ],
  },
  {
    slug: "whatsapp-eposta",
    category: "entegrasyon",
    icon: "💬",
    title: "WhatsApp & E-posta",
    summary: "Belge ve bildirimleri müşterilerinize gönderin.",
    detail: "Belge ve bildirimleri müşterilerinize gönderin.",
    points: [
      "Belge gönderimi",
      "Bildirim gönderimi",
      "WhatsApp ile iletim",
      "E-posta ile iletim",
    ],
  },
  {
    slug: "ai-asistan",
    category: "entegrasyon",
    icon: "✨",
    title: "AI Asistan",
    summary: "Verilerinize soru sorun; fiş ve çek görsellerini okutun.",
    detail: "Verilerinize soru sorun; fiş ve çek görsellerini okutun.",
    points: [
      "Verilerinize soru sorma",
      "Fiş görseli okuma",
      "Çek görseli okuma",
      "Yanıt panelde",
    ],
  },
].map((row) => ({ ...row, accent: ACCENT[row.category], width: 1440, height: 900 }));

export const PRODUCTS = [
  {
    slug: "web-paneli",
    icon: "🖥️",
    accent: "#2d7bff",
    domain: "app.tamkobi.com",
    title: "Web Paneli",
    summary: "Tüm modülleri tarayıcıdan yönettiğiniz ana uygulama.",
    points: [
      "Fatura, e-belge, cari, stok, sipariş ve raporlar tek panelde",
      "Rol ve yetkiyle kullanıcı bazında erişim",
      "Birden fazla şirketi aynı hesaptan yönetme",
      "Modül bazında paket: kullandığınız kadar ödeyin",
    ],
    reverse: false,
  },
  {
    slug: "mobil",
    icon: "📱",
    accent: "#7b3ff2",
    domain: "iOS · Android",
    title: "Mobil Uygulama",
    summary: "Ofis dışındayken de işletmeniz cebinizde.",
    points: [
      "Fatura, teklif, sipariş ve cari ekstre",
      "Barkodla stok sayımı ve sevkiyat toplama",
      "Banka, kasa, çek ve masraf takibi",
      "Mesai, saha satış ve bildirimler",
    ],
    reverse: true,
  },
  {
    slug: "b2b",
    icon: "🤝",
    accent: "#c6f432",
    domain: "b2b.tamkobi.com",
    title: "B2B Bayi Portalı",
    summary: "Bayi ve kurumsal müşterileriniz için kendi sipariş kanalınız.",
    points: [
      "Bayiye özel fiyatlarla katalog ve sepet",
      "Sipariş ve üretim durumunu takip",
      "Kartla ödeme (sanal POS)",
      "Çok tedarikçili bayiler için tedarikçi seçimi",
    ],
    reverse: false,
  },
  {
    slug: "ik",
    icon: "🧑‍💼",
    accent: "#f59e0b",
    domain: "ik.tamkobi.com",
    title: "İK & Personel Portalı",
    summary: "Çalışanlarınız ve İK süreçleriniz için sade bir ekran.",
    points: [
      "Personel kartları, ücret, avans ve ödemeler",
      "Konum doğrulamalı mobil mesai (açık rıza ile)",
      "Çalışanın kendi mesai bilgilerini görmesi",
      "Personel ödeme makbuzu",
    ],
    reverse: true,
  },
  {
    slug: "atolye",
    icon: "🏭",
    accent: "#4f2fd0",
    domain: "Atölye ekranı",
    title: "Atölye & Üretim Ekranı",
    summary: "Üretim sahası için dokunmatik dostu ekran.",
    points: [
      "İş emirleri ve ürün reçeteleri",
      "Operatör PIN'i ile başlat, duraklat, fire kaydı",
      "Teknik çizimleri ekranda görüntüleme",
      "Malzeme eksiklerinin otomatik listelenmesi",
    ],
    reverse: false,
  },
].map((row) => ({
  ...row,
  ...(row.slug === "mobil" ? { width: 390, height: 844 } : { width: 1440, height: 900 }),
}));

export const MODULES_HERO = {
  eyebrow: "TamKobi · Modüller",
  titleLead: "İhtiyacınız olan her modül,",
  titleEm: "tek panelde",
  titleTail: ".",
  lead: "Fatura, cari, stok, banka, personel ve üretim. Modülleri inceleyin, yalnızca kullandıklarınızla kendi paketinizi oluşturun.",
  note: "Ekran görüntüleri örnek verilerle hazırlanmıştır.",
};

export const PRODUCTS_HERO = {
  eyebrow: "TamKobi · Ürünler",
  titleLead: "Tek altyapı,",
  titleEm: "beş ürün",
  titleTail: ".",
  lead: "Web paneli, mobil uygulama, bayi portalı, İK ekranı ve atölye ekranı aynı veriyi kullanır; bir yerde girdiğiniz bilgi her yerde günceldir.",
  note: "Ekran görüntüleri örnek verilerle hazırlanmıştır.",
};

export function screenshotSrc(slug) {
  return `/brand/screenshots/${slug}.png`;
}

export function categoryLabel(id) {
  return MODULE_CATEGORIES.find((c) => c.id === id)?.label || "";
}

/** ?kategori= değerini kategori kimliğine çevirir. Boş ve bilinmeyen değer Tümü'dür. */
export function normalizeCategory(raw) {
  const s = String(raw || "").trim().toLocaleLowerCase("tr-TR");
  if (!s || s === "tumu" || s === "tümü") return "tumu";
  const hit = MODULE_CATEGORIES.find((c) => c.id === s || c.label.toLocaleLowerCase("tr-TR") === s);
  return hit ? hit.id : "tumu";
}

export function filterModules(category) {
  const id = normalizeCategory(category);
  if (id === "tumu") return MODULES;
  return MODULES.filter((row) => row.category === id);
}
