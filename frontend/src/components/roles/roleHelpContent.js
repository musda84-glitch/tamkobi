/** Roller ve yetkiler yardım metinleri. Görseller public/help/roller altında. */

const HELP = "/help/roller";

function shot(id, file, width, height, alt, caption) {
  return { id, src: `${HELP}/${file}`, width, height, alt, caption };
}

const LEVELS = [
  { key: "none", label: "Kapalı", text: "Modül menüde görünmez ve ekranları açılmaz." },
  { key: "view", label: "Görür", text: "Liste ve detayları okur, PDF açar. Yeni kayıt, düzenleme ve silme yapamaz." },
  { key: "edit", label: "Ekler/Düzenler", text: "Yeni kayıt açar ve mevcut kaydı günceller. Silemez." },
  { key: "delete", label: "Siler", text: "Ekleme ve düzenlemenin yanında kayıt silebilir ve toplu silme yapabilir. Silinen kayıtlar Çöp Kutusu'na gider." },
];

function item(id, title, paragraphs, extra = {}) {
  return { id, title, paragraphs, ...extra };
}

export const ROLE_HELP_SECTIONS = [
  {
    id: "seviyeler",
    kicker: "Her modülde aynı",
    title: "Yetki seviyeleri",
    paragraphs: ["Aynı dört seviye her modülde geçerlidir. Soldan sağa yetki artar; bir üst seviye, alttakinin yapabildiklerini de kapsar."],
    levels: LEVELS,
    image: shot(
      "yetki-seviyeleri",
      "yetki-seviyeleri.png",
      1452,
      912,
      "Aynı fatura satırının Kapalı, Görür, Ekler/Düzenler ve Siler seviyelerinde nasıl göründüğü: butonlar seviyeye göre kaybolur.",
      "Aynı satırın dört seviyede nasıl göründüğü",
    ),
    notes: [{
      kind: "warn",
      text: "Bugün \"Kapalı\" seviyesi okuma isteklerini sunucuda varsayılan olarak yalnızca kayda geçirir, engellemez (RBAC_GET_ENFORCE=shadow). Menü gizlenir, ama API okumaları açık kalabilir.",
    }],
  },
  {
    id: "finans",
    kicker: "Grup",
    title: "Finans",
    paragraphs: ["Para ile ilgili tüm ekranlar bu gruptadır. Bu yetkileri yalnızca güvendiğiniz kişilere verin. Fatura ve banka işlemleri vergi kayıtlarınızı doğrudan etkiler."],
    items: [
      item("faturalar", "Faturalar & e-Belge", [
        "Satış ve alış faturaları, e-Fatura ve e-Arşiv gönderimi, gelen e-belge kutusu ve irsaliyeler bu yetkiye bağlıdır. e-Fatura gönderimi kontör harcar ve GİB'e iletilir. Gönderilen belge silinerek geri alınamaz, yalnızca iptal veya itiraz süreciyle düzeltilir. Satış personeline genelde \"Ekler/Düzenler\" yeterlidir; silme yetkisini muhasebeye bırakın.",
      ], {
        image: shot(
          "fatura-gorur",
          "fatura-gorur.png",
          1440,
          900,
          "Görür seviyesinde fatura listesi: Yeni Fatura butonu gizli, satırda yalnızca görüntüleme kalır.",
          "Görür seviyesinde Yeni Fatura butonu gizli",
        ),
        notes: [{
          kind: "warn",
          text: "Eski \"/api/e-invoice/create\" ucu modül kontrolüne bağlı değil. Düzeltilene kadar kısıtlı roller de bu uçtan e-Fatura oluşturabilir.",
        }],
      }),
      item("banka", "Banka, Kasa & POS", [
        "Banka hesapları, otomatik banka senkronu ve eşleştirme, kasa, virman ve POS tahsilatları. \"Görür\" seviyesindeki kişi bakiyeleri ve hareketleri görür ama işlem giremez. Firmanızda çift onay açıksa virman ve ortak hesabı işlemleri ikinci bir kişinin onayını bekler.",
      ], {
        image: shot(
          "banka-eslestirme",
          "banka-eslestirme.png",
          1440,
          900,
          "Banka hareketleri listesi ve eşleştirme paneli: bekleyen hareket, eşleştir ve yok say.",
          "Banka hareketleri ve eşleştirme paneli",
        ),
      }),
      item("cek", "Çek / Senet", [
        "Alınan ve verilen çek ve senetler: tahsil, ciro, karşılıksız işaretleme. Bu yetki rolde tanımlanmamışsa mobil uygulama Banka yetkisine bakar.",
      ]),
      item("masraf", "Masraflar", [
        "Masraf fişi girişi, fiş fotoğrafından bilgi okuma ve masraf bütçeleri. Personele masraf ödemesi için Personel yetkisi de \"Ekler/Düzenler\" olmalıdır.",
      ], {
        notes: [{
          kind: "warn",
          text: "Masraf bütçesi kaydetme ucu (/api/expense-budgets) bugün bu yetkiyle denetlenmiyor.",
        }],
      }),
      item("kredi", "Krediler & Taksitler", [
        "Kredi ve kredi kartı takibi, taksitli satış ve ödeme planları.",
      ]),
    ],
  },
  {
    id: "satis",
    kicker: "Grup",
    title: "Satış",
    paragraphs: ["Müşteriyle temas eden ekranlar."],
    items: [
      item("cari", "Cari Hesaplar", [
        "Müşteri ve tedarikçi kartları, ekstre, bakiye ve tahsilat. Bayilere B2B portal şifresi verme işlemi de bugün bu yetkiyle yapılır.",
      ], {
        image: shot(
          "cari-ekstre-paylas",
          "cari-ekstre-paylas.png",
          1440,
          900,
          "Cari hesap ekstresi ve ekstreyi paylaş bağlantısı.",
          "Cari ekstre ve ekstreyi paylaş",
        ),
      }),
      item("teklif", "Teklif & Sipariş", [
        "Teklif hazırlama, müşteri onayı, siparişe ve faturaya dönüştürme, iade. \"Ekler/Düzenler\" seviyesindeki kişi siparişten kargo gönderisi de oluşturabilir; ayrıca Kargo yetkisi gerekmez.",
      ]),
      item("pos", "Hızlı Satış (POS)", [
        "Perakende satış ekranı, tartı ve termal fiş.",
      ]),
      item("b2b", "B2B Bayi Portalı", [
        "Bayi portalı menüsünün görünürlüğü.",
      ], {
        notes: [{
          kind: "warn",
          text: "Bu yetki bugün yalnızca menüyü etkiler. Bayi şifreleri Cari yetkisiyle, portal ayarları Firma Ayarları yetkisiyle yönetilir.",
        }],
      }),
    ],
  },
  {
    id: "stok",
    kicker: "Grup",
    title: "Stok & Depo",
    items: [
      item("urun", "Stok & Ürünler", [
        "Ürün kartı, barkod, etiket ve fiyatlar. Ürün fiyatını değiştirmek için \"Ekler/Düzenler\" gerekir.",
      ], {
        notes: [{
          kind: "warn",
          text: "Kanal fiyat kuralları (/api/pricing/rules) ve etiket şablonları (/api/label-templates) bugün bu yetkiyle denetlenmiyor.",
        }],
      }),
      item("depo", "Depo, Sayım & Sevkiyat", [
        "Çoklu depo ve transfer, tablet stok sayımı, sipariş toplama (sevk). Personel portalındaki çalışanlar için ayrıca Gelişmiş › Personel portalı açılmalıdır.",
      ], {
        image: shot(
          "tablet-sayim",
          "tablet-sayim.png",
          640,
          900,
          "Tablet stok sayım ekranı: ürün satırı, sayılan adet ve onayla.",
          "Tablet sayım ekranı",
        ),
      }),
      item("verilen", "Verilen Siparişler", [
        "Tedarikçiye verilen siparişler. Rolde tanımlanmamışsa mobil uygulama Stok yetkisine bakar.",
      ]),
    ],
  },
  {
    id: "uretim",
    kicker: "Grup",
    title: "Üretim",
    items: [
      item("recete", "Üretim & Reçete", [
        "Reçete (ürün ağacı), üretim emirleri ve eksik malzeme planı.",
      ]),
      item("atolye", "Atölye Ekranı", [
        "Tablet atölye ekranı: operatör PIN'i, iş emri başlatma, duraklatma, bitirme, fire ve kısmi adet girişi.",
      ], {
        image: shot(
          "atolye-pin",
          "atolye-pin.png",
          1440,
          900,
          "Operatörün PIN ile giriş yaptığı atölye ekranı.",
          "Operatörün PIN ile giriş yaptığı atölye ekranı",
        ),
        notes: [{
          kind: "important",
          text: "Bu modülde \"Görür\" seviyesi de iş emri işletmeye izin verir (operatörün çalışabilmesi için). İş emri silmek için \"Siler\" gerekir.",
        }],
      }),
    ],
  },
  {
    id: "ik",
    kicker: "Grup",
    title: "İK",
    items: [
      item("personel", "Personel & Bordro", [
        "Personel kartları, ücret, avans, prim, izin ve ödemeler. Hassas kişisel veri içerdiği için yalnızca İK ve yöneticilere verin (KVKK).",
      ]),
      item("mesai", "Mesai", [
        "Puantaj, giriş-çıkış ve fazla mesai. Çalışanların kendi giriş-çıkışı bu yetkiden bağımsızdır; herkes kendi kaydını görür.",
      ]),
    ],
  },
  {
    id: "diger",
    kicker: "Grup",
    title: "Diğer",
    items: [
      item("rapor", "Raporlar", [
        "Satış, alış, stok, nakit akışı, KDV ve kârlılık raporları. Fiyat görme kapalıysa tutarlar 0 görünür.",
      ]),
      item("iletisim", "İletişim", [
        "SMS, e-posta ve WhatsApp Business gönderimleri. SMS ayarları ve bakiye Firma Ayarları yetkisindedir.",
      ]),
      item("ai", "AI Asistan", [
        "AI danışmanla sohbet ve nakit tahmini. Fatura, fiş ve çek okuma, ilgili modülün yetkisiyle çalışır. Lisans eklentisi gerekir.",
      ]),
      item("ayarlar", "Firma Ayarları · Çöp Kutusu · Mali Müşavir Paneli · Destek", [
        "Ayarlar (kullanıcı ve rol, entegrasyonlar, sanal POS) yalnızca yöneticilere verilmelidir. Çöp Kutusu'ndaki silinen kayıtlar 30 gün içinde geri alınabilir.",
      ], {
        notes: [{
          kind: "warn",
          text: "İşNet entegrasyonu kaydetme uçları bugün Ayarlar yetkisiyle denetlenmiyor.",
        }],
      }),
    ],
  },
  {
    id: "gelismis",
    kicker: "Varsayılan olarak kapalı görünür",
    title: "Gelişmiş ayarlar",
    items: [
      item("fiyat", "Fiyatları görebilir", [
        "Kapalıysa ekranlarda ve API yanıtlarında fiyat, tutar ve bakiye alanları 0 gösterilir. Personel ve Üretim rollerinde varsayılan olarak kapalıdır.",
      ], {
        image: shot(
          "fiyat-acik-kapali",
          "fiyat-acik-kapali.png",
          1184,
          852,
          "Aynı sipariş listesi fiyatlar açıkken tutarlı, kapalıyken tutarlar gizli.",
          "Fiyatlar açık ve kapalıyken aynı sipariş listesi",
        ),
        notes: [{
          kind: "warn",
          text: "Maskeleme bugün yalnızca okuma (GET) yanıtlarında yapılıyor. PDF ve Excel çıktılarında ve kayıt oluşturma yanıtlarında tutarlar görünebilir.",
        }],
      }),
      item("portal", "Personel portalı ve mobil saha", [
        "ik.tamkobi.com'daki çalışan ekranında ve mobilde hangi saha işlerinin açılacağını seçer: Atölye, Sipariş toplama, Stok sayımı, Saha siparişi, Araçlarım, Siparişler (yazdır, eksik bildir, üretime al, kargola, etiket). Varsayılan olarak hepsi kapalıdır; kapalı olan işlemde sunucu 403 döner.",
      ], {
        image: shot(
          "personel-mobil-menu",
          "personel-mobil-menu.png",
          390,
          844,
          "Çalışanın mobil menüsü: Atölye ve Sipariş toplama açık, diğer saha işleri kapalı.",
          "Çalışanın mobil menüsü, iki özellik açıkken",
        ),
      }),
      item("kisayol", "Kısayollar (yalnızca görünüm)", [
        "Üst bardaki hızlı barkod, hızlı virman, hızlı fatura ve AI asistan butonları ile kur/arama/Destek şeridi. Bunlar yetki değil, ekran tercihidir. Kapatmak işlemi yasaklamaz, yalnızca kısayolu gizler.",
      ]),
      item("sevk-buton", "Sipariş ve sevk butonları", [
        "Kargo etiketi, Diğer işlemler menüsü, mobil sevkte \"Siparişi aç\" ve \"Taslak fatura\". Bunlar yalnızca butonu gizler; asıl yetki Sipariş ve Fatura seviyesidir.",
      ]),
      item("hesap", "Hesap", [
        "\"Şirketlerim\" (şirket değiştirme, sunucuda denetlenir), \"Kişisel verilerimi indir\" (sunucuda denetlenir) ve \"İşlem geçmişini görebilir\" (sunucuda denetlenir; varsayılan kapalı).",
      ]),
    ],
  },
];

export function collectRoleHelpImages(sections = ROLE_HELP_SECTIONS) {
  const out = [];
  (sections || []).forEach((section) => {
    if (section.image) out.push(section.image);
    (section.items || []).forEach((entry) => {
      if (entry.image) out.push(entry.image);
    });
  });
  return out;
}
