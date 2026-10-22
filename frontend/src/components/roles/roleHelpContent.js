/**
 * Rol ve yetki yardım metinleri (bugünkü ekran davranışı).
 * "note" / "important" kutuları sunucu düzeltmesi bekleyen noktalardır;
 * düzeltme yapılınca ilgili kutu metinden çıkarılmalıdır.
 */

export const ROLE_HELP_IMAGE_DIR = "/help/roller";

export function roleHelpImageSrc(file) {
  if (!file) return "";
  const base = String(process.env.PUBLIC_URL || "").replace(/\/$/, "");
  return `${base}${ROLE_HELP_IMAGE_DIR}/${file}`;
}

function shot(file, width, height, alt) {
  return { file, width, height, alt };
}

export const ROLE_HELP_LEVELS = [
  { key: "none", title: "Kapalı", body: "Modül menüde görünmez ve ekranları açılmaz." },
  { key: "view", title: "Görür", body: "Liste ve detayları okur, PDF açar. Yeni kayıt, düzenleme ve silme yapamaz." },
  { key: "edit", title: "Ekler/Düzenler", body: "Yeni kayıt açar ve mevcut kaydı günceller. Silemez." },
  { key: "delete", title: "Siler", body: "Ekleme ve düzenlemenin yanında kayıt silebilir ve toplu silme yapabilir. Silinen kayıtlar Çöp Kutusu'na gider." },
];

export const ROLE_HELP_SECTIONS = [
  {
    id: "seviyeler",
    eyebrow: "Yetki seviyeleri",
    title: "Her modülde aynı",
    lead: "Kapalı, Görür, Ekler/Düzenler ve Siler seviyeleri tüm modüllerde aynı anlama gelir.",
    showLevels: true,
    image: shot(
      "yetki-seviyeleri.png",
      1452,
      912,
      "Aynı Teklif ve Sipariş satırının Kapalı, Görür, Ekler/Düzenler ve Siler seviyelerinde görünümü. Kapalıda menü gizli, Görürde salt okunur, Ekler/Düzenlerde Yeni Teklif açık ve Sil gizli, Silerde Sil ve Toplu Sil açık.",
    ),
    note: "Bugün \"Kapalı\" seviyesi okuma isteklerini sunucuda varsayılan olarak yalnızca kayda geçirir, engellemez (RBAC_GET_ENFORCE=shadow). Menü gizlenir, ama API okumaları açık kalabilir.",
  },
  {
    id: "finans",
    eyebrow: "Grup",
    title: "Finans",
    lead: "Para ile ilgili tüm ekranlar bu gruptadır. Bu yetkileri yalnızca güvendiğiniz kişilere verin. Fatura ve banka işlemleri vergi kayıtlarınızı doğrudan etkiler.",
    modules: [
      {
        id: "faturalar",
        title: "Faturalar & e-Belge",
        body: "Satış ve alış faturaları, e-Fatura ve e-Arşiv gönderimi, gelen e-belge kutusu ve irsaliyeler bu yetkiye bağlıdır. e-Fatura gönderimi kontör harcar ve GİB'e iletilir. Gönderilen belge silinerek geri alınamaz, yalnızca iptal veya itiraz süreciyle düzeltilir. Satış personeline genelde \"Ekler/Düzenler\" yeterlidir; silme yetkisini muhasebeye bırakın.",
        image: shot(
          "fatura-gorur.png",
          1440,
          900,
          "Görür seviyesindeki fatura listesi. Yeni Fatura butonu gizli; satış ve alış faturaları ile PDF bağlantıları görünür.",
        ),
        note: "Eski \"/api/e-invoice/create\" ucu modül kontrolüne bağlı değil. Düzeltilene kadar kısıtlı roller de bu uçtan e-Fatura oluşturabilir.",
      },
      {
        id: "banka",
        title: "Banka, Kasa & POS",
        body: "Banka hesapları, otomatik banka senkronu ve eşleştirme, kasa, virman ve POS tahsilatları. \"Görür\" seviyesindeki kişi bakiyeleri ve hareketleri görür ama işlem giremez. Firmanızda çift onay açıksa virman ve ortak hesabı işlemleri ikinci bir kişinin onayını bekler.",
        image: shot(
          "banka-eslestirme.png",
          1440,
          900,
          "Banka hareketleri listesi ve eşleştirme paneli. Eşleşmemiş hareket, cari ve fatura adayları görünür; Görür seviyesinde Eşleştir kapalıdır.",
        ),
      },
      {
        id: "cek",
        title: "Çek / Senet",
        body: "Alınan ve verilen çek ve senetler: tahsil, ciro, karşılıksız işaretleme. Bu yetki rolde tanımlanmamışsa mobil uygulama Banka yetkisine bakar.",
      },
      {
        id: "masraf",
        title: "Masraflar",
        body: "Masraf fişi girişi, fiş fotoğrafından bilgi okuma ve masraf bütçeleri. Personele masraf ödemesi için Personel yetkisi de \"Ekler/Düzenler\" olmalıdır.",
        note: "Masraf bütçesi kaydetme ucu (/api/expense-budgets) bugün bu yetkiyle denetlenmiyor.",
      },
      {
        id: "kredi",
        title: "Krediler & Taksitler",
        body: "Kredi ve kredi kartı takibi, taksitli satış ve ödeme planları.",
      },
    ],
  },
  {
    id: "satis",
    eyebrow: "Grup",
    title: "Satış",
    lead: "Müşteriyle temas eden ekranlar.",
    modules: [
      {
        id: "cari",
        title: "Cari Hesaplar",
        body: "Müşteri ve tedarikçi kartları, ekstre, bakiye ve tahsilat. Bayilere B2B portal şifresi verme işlemi de bugün bu yetkiyle yapılır.",
        image: shot(
          "cari-ekstre-paylas.png",
          1440,
          900,
          "Cari ekstre tablosu ve ekstreyi paylaş bağlantısı. Paylaşım bağlantısı 7 gün geçerlidir.",
        ),
      },
      {
        id: "teklif",
        title: "Teklif & Sipariş",
        body: "Teklif hazırlama, müşteri onayı, siparişe ve faturaya dönüştürme, iade. \"Ekler/Düzenler\" seviyesindeki kişi siparişten kargo gönderisi de oluşturabilir; ayrıca Kargo yetkisi gerekmez.",
      },
      {
        id: "hizli-satis",
        title: "Hızlı Satış (POS)",
        body: "Perakende satış ekranı, tartı ve termal fiş.",
      },
      {
        id: "b2b",
        title: "B2B Bayi Portalı",
        body: "Bayi portalı menüsünün görünürlüğü.",
        note: "Bu yetki bugün yalnızca menüyü etkiler. Bayi şifreleri Cari yetkisiyle, portal ayarları Firma Ayarları yetkisiyle yönetilir.",
      },
    ],
  },
  {
    id: "stok",
    eyebrow: "Grup",
    title: "Stok & Depo",
    modules: [
      {
        id: "stok",
        title: "Stok & Ürünler",
        body: "Ürün kartı, barkod, etiket ve fiyatlar. Ürün fiyatını değiştirmek için \"Ekler/Düzenler\" gerekir.",
        note: "Kanal fiyat kuralları (/api/pricing/rules) ve etiket şablonları (/api/label-templates) bugün bu yetkiyle denetlenmiyor.",
      },
      {
        id: "depo",
        title: "Depo, Sayım & Sevkiyat",
        body: "Çoklu depo ve transfer, tablet stok sayımı, sipariş toplama (sevk). Personel portalındaki çalışanlar için ayrıca Gelişmiş › Personel portalı açılmalıdır.",
        image: shot(
          "tablet-sayim.png",
          640,
          900,
          "Tablet stok sayım ekranı: barkod alanı, sayılan ürün satırı ve sayımı bitir butonu.",
        ),
      },
      {
        id: "verilen",
        title: "Verilen Siparişler",
        body: "Tedarikçiye verilen siparişler. Rolde tanımlanmamışsa mobil uygulama Stok yetkisine bakar.",
      },
    ],
  },
  {
    id: "uretim",
    eyebrow: "Grup",
    title: "Üretim",
    modules: [
      {
        id: "uretim",
        title: "Üretim & Reçete",
        body: "Reçete (ürün ağacı), üretim emirleri ve eksik malzeme planı.",
      },
      {
        id: "atolye",
        title: "Atölye Ekranı",
        body: "Tablet atölye ekranı: operatör PIN'i, iş emri başlatma, duraklatma, bitirme, fire ve kısmi adet girişi.",
        note: "Bu modülde \"Görür\" seviyesi de iş emri işletmeye izin verir (operatörün çalışabilmesi için). İş emri silmek için \"Siler\" gerekir.",
        noteKind: "important",
        image: shot(
          "atolye-pin.png",
          1440,
          900,
          "Atölye ekranında operatörün PIN ile giriş yaptığı kilit ekranı ile başlat, duraklat, bitir, fire ve kısmi adet alanları.",
        ),
      },
    ],
  },
  {
    id: "ik",
    eyebrow: "Grup",
    title: "İK",
    modules: [
      {
        id: "personel",
        title: "Personel & Bordro",
        body: "Personel kartları, ücret, avans, prim, izin ve ödemeler. Hassas kişisel veri içerdiği için yalnızca İK ve yöneticilere verin (KVKK).",
      },
      {
        id: "mesai",
        title: "Mesai",
        body: "Puantaj, giriş-çıkış ve fazla mesai. Çalışanların kendi giriş-çıkışı bu yetkiden bağımsızdır; herkes kendi kaydını görür.",
      },
    ],
  },
  {
    id: "diger",
    eyebrow: "Grup",
    title: "Diğer",
    modules: [
      {
        id: "raporlar",
        title: "Raporlar",
        body: "Satış, alış, stok, nakit akışı, KDV ve kârlılık raporları. Fiyat görme kapalıysa tutarlar 0 görünür.",
      },
      {
        id: "iletisim",
        title: "İletişim",
        body: "SMS, e-posta ve WhatsApp Business gönderimleri. SMS ayarları ve bakiye Firma Ayarları yetkisindedir.",
      },
      {
        id: "ai",
        title: "AI Asistan",
        body: "AI danışmanla sohbet ve nakit tahmini. Fatura, fiş ve çek okuma, ilgili modülün yetkisiyle çalışır. Lisans eklentisi gerekir.",
      },
      {
        id: "firma",
        title: "Firma Ayarları · Çöp Kutusu · Mali Müşavir Paneli · Destek",
        body: "Ayarlar (kullanıcı ve rol, entegrasyonlar, sanal POS) yalnızca yöneticilere verilmelidir. Çöp Kutusu'ndaki silinen kayıtlar 30 gün içinde geri alınabilir.",
        note: "İşNet entegrasyonu kaydetme uçları bugün Ayarlar yetkisiyle denetlenmiyor.",
      },
    ],
  },
  {
    id: "gelismis",
    eyebrow: "Gelişmiş",
    title: "Gelişmiş ayarlar",
    lead: "Varsayılan olarak kapalı görünür.",
    modules: [
      {
        id: "fiyat",
        title: "Fiyatları görebilir",
        body: "Kapalıysa ekranlarda ve API yanıtlarında fiyat, tutar ve bakiye alanları 0 gösterilir. Personel ve Üretim rollerinde varsayılan olarak kapalıdır.",
        note: "Maskeleme bugün yalnızca okuma (GET) yanıtlarında yapılıyor. PDF ve Excel çıktılarında ve kayıt oluşturma yanıtlarında tutarlar görünebilir.",
        image: shot(
          "fiyat-acik-kapali.png",
          1184,
          852,
          "Aynı sipariş listesi fiyatlar açıkken tutarlarla, kapalıyken tutarlar 0 olarak.",
        ),
      },
      {
        id: "portal",
        title: "Personel portalı ve mobil saha",
        body: "ik.tamkobi.com'daki çalışan ekranında ve mobilde hangi saha işlerinin açılacağını seçer: Atölye, Sipariş toplama, Stok sayımı, Saha siparişi, Araçlarım, Siparişler (yazdır, eksik bildir, üretime al, kargola, etiket). Varsayılan olarak hepsi kapalıdır; kapalı olan işlemde sunucu 403 döner.",
        image: shot(
          "personel-mobil-menu.png",
          390,
          844,
          "Personel mobil menüsü: Atölye ve Stok Sayımı açık, diğer saha işleri kapalı.",
        ),
      },
      {
        id: "kisayol",
        title: "Kısayollar (yalnızca görünüm)",
        body: "Üst bardaki hızlı barkod, hızlı virman, hızlı fatura ve AI asistan butonları ile kur/arama/Destek şeridi. Bunlar yetki değil, ekran tercihidir. Kapatmak işlemi yasaklamaz, yalnızca kısayolu gizler.",
      },
      {
        id: "siparis-buton",
        title: "Sipariş ve sevk butonları",
        body: "Kargo etiketi, Diğer işlemler menüsü, mobil sevkte \"Siparişi aç\" ve \"Taslak fatura\". Bunlar yalnızca butonu gizler; asıl yetki Sipariş ve Fatura seviyesidir.",
      },
      {
        id: "hesap",
        title: "Hesap",
        body: "\"Şirketlerim\" (şirket değiştirme, sunucuda denetlenir), \"Kişisel verilerimi indir\" (sunucuda denetlenir) ve \"İşlem geçmişini görebilir\" (sunucuda denetlenir; varsayılan kapalı).",
      },
    ],
  },
];

export function roleHelpImages(sections = ROLE_HELP_SECTIONS) {
  const out = [];
  for (const section of sections) {
    if (section.image) out.push(section.image);
    for (const mod of section.modules || []) {
      if (mod.image) out.push(mod.image);
    }
  }
  return out;
}
