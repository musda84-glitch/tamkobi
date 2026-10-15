/** Per-route short intros + bubble-tour targets (data-testid / data-help-id). */

export const CHROME_TOUR = [
  {
    selector: '[data-testid="help-page-btn"]',
    title: "Sayfa yardımı",
    body: "Bu düğme sayfanın kısa anlatımını, baloncuklu turu ve Nasıl yapılır? aramasını açar.",
  },
  {
    selector: '[data-testid="quick-create-invoice-btn"]',
    title: "Yeni Fatura",
    body: "Satış faturası formunu hemen açar. Cari ve ürün yoksa önce kurulum sihirbazını tamamlayın.",
  },
  {
    selector: '[data-testid="quick-new-contact-btn"]',
    title: "Yeni Cari",
    body: "Müşteri veya tedarikçi kartını listeden çıkmadan açar.",
  },
  {
    selector: '[data-testid="notification-bell"]',
    title: "Bildirimler",
    body: "Gelen sipariş, e-belge ve sistem uyarıları burada toplanır.",
  },
];

const P = (title, intro, tour = [], extras = {}) => ({ title, intro, tour, ...extras });

export const PAGE_HELP = {
  "/panel": P(
    "Genel Bakış",
    "Şirketinizin KPI kartları, nakit özeti ve hızlı işlemler. İlk kurulum bitmediyse sihirbaz buradan da açılır.",
    [
      { selector: '[data-testid="quick-ai-btn"]', title: "AI Danışman", body: "Nakit tahmini ve finansal sorular için sohbet." },
    ],
  ),
  "/invoices": P(
    "Faturalar",
    "Satış/alış faturaları, e-Fatura ve e-Arşiv. Yeni Fatura ile cari ve kalem ekleyip taslak kaydedin veya onaylayın.",
    [
      { selector: '[data-testid="create-new-invoice-btn"]', title: "Yeni Fatura", body: "Satış faturası oluşturma formunu açar." },
    ],
  ),
  "/dispatches": P("İrsaliyeler", "Sevk irsaliyesi ve e-İrsaliye. Onaylı irsaliyeyi faturaya dönüştürebilirsiniz."),
  "/edoc-inbox": P("Gelen e-Belgeler", "GİB’den gelen e-Fatura / e-İrsaliye kutusu. Onay, ret ve stok eşlemesi burada."),
  "/dis-ticaret": P("İthalat / İhracat", "Gümrük dosyası, GTIP, rejim ve ticari fatura alanları."),
  "/contacts": P(
    "Cari Hesaplar",
    "Müşteri ve tedarikçi kartları, bakiye ve ekstre. Yeni Cari ile VKN/TCKN girin; GİB sorgusu unvanı doldurur.",
    [{ selector: '[data-testid="add-contact-btn"]', title: "Yeni Cari", body: "Müşteri veya tedarikçi kartı açar." }],
  ),
  "/installments": P("Taksitler", "Taksitli satış ve ödeme planları. Fatura kaydından da plan üretilebilir."),
  "/reports": P("Raporlar", "Satış, alış, stok, nakit ve KDV özetleri. Excel dışa aktarma araç çubuğundadır."),
  "/banking": P("Banka & Kasa & POS", "Hesaplar, virman, tahsilat/ödeme ve canlı banka eşleme."),
  "/expenses": P("Masraflar", "Gider fişleri ve kategoriler. Fiş fotoğrafından AI ile satır çıkarabilirsiniz."),
  "/loans": P("Krediler", "Banka kredisi ve kart takibi, taksit ve faiz."),
  "/cheques": P("Çek / Senet", "Alınan ve verilen evrak, tahsil, ciro ve karşılıksız işlemleri."),
  "/stock": P(
    "Stoklar & Ürünler",
    "Ürün kartı, barkod, fiyat ve stok miktarı. Ürün Ekle ile ilk kartı açın; etiket yazdırma araç çubuğundadır.",
    [
      { selector: '[data-testid="add-product-btn"]', title: "Ürün Ekle", body: "Yeni stok veya hizmet kartı açar." },
      { selector: '[data-testid="stock-search-input"]', title: "Stok arama", body: "Ad, SKU veya barkod ile süzün." },
    ],
  ),
  "/purchase-orders": P("Verilen Siparişler", "Tedarikçiye verilen siparişler ve yeniden sipariş önerileri."),
  "/hizli-satis": P("Hızlı Satış", "Perakende POS: barkod okut, tahsil et, fiş bas."),
  "/sayim": P("Stok Sayımı", "Tablet sayım oturumu. Barkod okutup sayılan miktarı girin."),
  "/quotes": P("Teklifler", "Satış teklifi, müşteri onayı ve faturaya çevirme."),
  "/projects": P("Projeler", "İş/saha projesi, bütçe ve aşama fotoğrafları."),
  "/surveys": P("Keşifler", "Keşif ve ölçü; teklife dönüştürme."),
  "/ecommerce": P("E-Ticaret Entegrasyon", "Trendyol ve diğer pazaryerleri: ürün eşleme, sipariş çekme."),
  "/cargo": P("Kargo Entegrasyon", "Kargo firması bağlantısı, etiket ve takip numarası."),
  "/orders": P("Siparişler", "B2B ve pazaryeri siparişleri: onay, faturalama, kargo."),
  "/saha": P("Saha Sipariş", "Tablet/mobil saha siparişi ve müşteri ziyareti."),
  "/sevk": P("Depo Sevkiyatı", "Toplama (pick) kiosk: siparişi tarayıp sevk edin."),
  "/warehouses": P("Depo & Transfer", "Çoklu depo ve stok transfer fişleri."),
  "/vehicles": P("Araçlarım", "Filo listesi: plaka, durum, zimmet."),
  "/production": P(
    "Üretim & Reçete",
    "BOM reçetesi, üretim emri ve eksik malzeme. Üretim Emri Ver ile iş emri açılır.",
    [{ selector: '[data-testid="new-production-order-btn"]', title: "Üretim Emri", body: "Reçeteden iş emri oluşturur." }],
  ),
  "/atolye": P("Atölye Ekranı", "Operatör tableti: iş emri, PIN ve istasyon."),
  "/personnel": P("Personel & Bordro", "İK kartı, bordro, vardiya ve izin onayları."),
  "/personelim": P("Benim Sayfam", "Personel self-servis: izin, mesaj, özlük özeti."),
  "/mesai": P("Mesaim", "Giriş-çıkış, puantaj ve fazla mesai."),
  "/communication": P("İletişim", "SMS, e-posta ve WhatsApp merkezleri."),
  "/ai-advisor": P("AI Danışman", "Finansal sohbet ve 30 günlük nakit tahmini. Yardım makaleleri ileride bu sohbete bağlanacak."),
  "/accountant": P("Mali Müşavir", "KDV özeti, mizan ve tahakkuk yükleme."),
  "/support": P("Destek", "Destek talebi açın, ekran görüntüsü ekleyin, yanıtları izleyin."),
  "/trash": P("Çöp Kutusu", "Silinen kayıtlar 30 gün içinde geri alınabilir."),
  "/settings": P("Firma Ayarları", "Unvan, logo, e-fatura, kullanıcılar ve entegrasyonlar. Kurulum sihirbazı bu bilgileri adım adım ister."),
  "/hesap": P("Hesabım", "Profil, şirketler, paket ve GİB kontör."),
  "/yardim": P("Yardım Merkezi", "Nasıl yapılır? makale ve videoları arayın. İçerikler ürün etiketine göre YNT’den gelir."),
  "/b2b-yonetim": P("B2B Yönetim", "Bayi portalı: fiyat listesi, erişim ve sipariş onayı."),
};

const SETTINGS_TAB_HELP = {
  company: P("Firma kartı", "Unvan, VKN, adres ve logo. Faturalarda görünen resmi bilgiler buradadır."),
  einvoice: P("e-Fatura ayarı", "Platformun atadığı entegratöre kullanıcı/şifre veya İşNet VKN-alias girin."),
  users: P("Kullanıcılar ve roller", "Davet gönderin, modül yetkisi verin."),
  notifications: P("Bildirimler", "Hangi olayda e-posta/SMS gideceğini seçin."),
  print: P("Yazdırma", "Fatura ve etiket şablonları."),
  bank: P("Banka bağlantısı", "Canlı hesap hareketi için banka API bilgileri."),
  desktop: P("Masaüstü uygulaması", "Atölye, depo ve hızlı satış ekranlarını Windows kiosk uygulamasından açın."),
};

const SYSTEM_HELP = {
  "": P("Platform genel bakış", "Kiracı sayısı, lisans ve açık talepler."),
  sirketler: P("Şirketler & lisanslar", "Müşteri firma, paket ve e-fatura entegratör ataması."),
  yardim: P("Yardım içerikleri", "Makale/video ekleyin, TamKobi veya TamEticaret etiketiyle yayınlayın."),
  duyurular: P("Duyurular", "Bakım penceresi ve şirket pop-up’ları."),
  ai: P("AI entegrasyonu", "Sağlayıcı anahtarı; yardım asistanı ileride buradaki modeli kullanır."),
};

export function pathKey(pathname = "/") {
  const p = (pathname || "/").replace(/\/+$/, "") || "/";
  if (p.startsWith("/sistem")) {
    const rest = p.replace(/^\/sistem\/?/, "");
    return rest ? `/sistem/${rest.split("/")[0]}` : "/sistem";
  }
  if (PAGE_HELP[p]) return p;
  const known = Object.keys(PAGE_HELP).filter((k) => k !== "/" && p.startsWith(k));
  known.sort((a, b) => b.length - a.length);
  return known[0] || p;
}

export function resolvePageHelp(pathname = "/", search = "") {
  const p = (pathname || "/").replace(/\/+$/, "") || "/";
  if (p === "/settings" || p.startsWith("/settings")) {
    const tab = new URLSearchParams(search || "").get("tab") || "company";
    const tabHelp = SETTINGS_TAB_HELP[tab];
    const base = PAGE_HELP["/settings"];
    return {
      key: `/settings?tab=${tab}`,
      pageKey: "/settings",
      title: tabHelp?.title || base.title,
      intro: tabHelp?.intro || base.intro,
      tour: [...(tabHelp?.tour || []), ...CHROME_TOUR],
    };
  }
  if (p === "/sistem" || p.startsWith("/sistem/")) {
    const section = p === "/sistem" ? "" : p.replace(/^\/sistem\//, "").split("/")[0];
    const spec = SYSTEM_HELP[section] || SYSTEM_HELP[""];
    return {
      key: section ? `/sistem/${section}` : "/sistem",
      pageKey: "/sistem",
      title: spec.title,
      intro: spec.intro,
      tour: [
        { selector: '[data-testid="sys-sidebar-nav"]', title: "Platform menü", body: "YNT bölümleri gruplar halinde. Yardım içerikleri Operasyon grubundadır." },
        { selector: '[data-testid="help-page-btn"]', title: "Sayfa yardımı", body: "Bu ekranın kısa anlatımı." },
      ],
    };
  }
  const key = pathKey(p);
  const spec = PAGE_HELP[key] || P("Bu sayfa", "Kısa işlemler ve listeler. Sağ üstteki ? ile tur başlatabilir, Yardım Merkezi’nde arama yapabilirsiniz.");
  const isIk = key === "/personelim" || key === "/mesai";
  const tour = isIk
    ? [
        { selector: '[data-testid="help-page-btn"]', title: "Yardım", body: "Bu ekranın kısa anlatımı ve ilgili makaleler." },
        ...(spec.tour || []),
      ]
    : [...(spec.tour || []), ...CHROME_TOUR];
  return { key, pageKey: key, title: spec.title, intro: spec.intro, tour };
}

export function tourStorageKey(pageKey) {
  return `tamkobi.help.tour.${pageKey || "page"}`;
}
