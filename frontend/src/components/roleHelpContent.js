/** Rol düzenleyici yardım çekmecesi. Metinler ekrandaki yetki davranışını anlatır. */

const LEVELS = {
  none: "Menüde görünmez, ilgili ekranlar açılmaz.",
  view: "Liste ve detay okunur, PDF açılır. Yeni kayıt açılamaz.",
  edit: "Yeni kayıt açılır ve mevcut kayıt güncellenir. Silinemez.",
  delete: "Ekleme ve düzenlemenin yanında kayıt silinebilir. Silinen kayıt çöp kutusuna gider.",
};

export const ROLE_HELP = {
  "/invoices": {
    group: "Finans",
    title: "Faturalar & e-Belge",
    body: "Satış ve alış faturaları, e-Fatura ve e-Arşiv gönderimi, gelen e-belge kutusu ve irsaliyeler bu yetkiye bağlıdır. e-Fatura gönderimi kontör harcar ve GİB'e gider. Gönderilen belge silinerek geri alınamaz; iptal veya itiraz süreciyle düzeltilir.",
    levels: {
      none: "Menüde görünmez, fatura ekranları açılmaz.",
      view: "Faturaları listeler, PDF'ini açar; yeni fatura kesemez.",
      edit: "Fatura keser, taslağı düzenler, e-Fatura gönderir.",
      delete: "Taslak veya kesilmiş faturayı siler. Kayıt çöp kutusuna gider, 30 gün içinde geri alınabilir.",
    },
    shot: "Fatura listesi: Görür seviyesinde Yeni Fatura Kes butonu gizli",
    tip: "Satış personeline genelde Ekler/Düzenler yeterlidir. Silme yetkisini muhasebeye bırakın.",
    related: "İlgili: Gelişmiş › Fiyatları görebilir · Üst bar › Hızlı fatura",
  },
  "/banking": {
    group: "Finans",
    title: "Banka, Kasa & POS",
    body: "Banka hesapları, otomatik banka senkronu ve eşleştirme, kasa, virman ve POS tahsilatları. Görür seviyesindeki kişi bakiyeleri ve hareketleri görür ama işlem giremez. Çift onay açıksa virman ikinci bir kişinin onayını bekler.",
    levels: LEVELS,
    shot: "Banka hareketleri ve eşleştirme paneli",
    tip: "Kasa ve banka işlemlerini yalnızca güvendiğiniz kişilere açın.",
  },
  "/cheques": {
    group: "Finans",
    title: "Çek / Senet",
    body: "Alınan ve verilen çek ve senetler: tahsil, ciro, karşılıksız işaretleme. Mobil uygulama, rolde çek yetkisi yoksa banka yetkisine bakar.",
    levels: LEVELS,
  },
  "/expenses": {
    group: "Finans",
    title: "Masraflar",
    body: "Masraf fişi, fiş fotoğrafından bilgi okuma ve masraf bütçeleri. Personele masraf ödemesi için Personel yetkisi de Ekler/Düzenler olmalıdır.",
    levels: LEVELS,
  },
  "/loans": {
    group: "Finans",
    title: "Krediler & Taksitler",
    body: "Kredi ve kredi kartı takibi, taksitli satış ve ödeme planları.",
    levels: LEVELS,
  },
  "/kontor": {
    group: "Finans",
    title: "Kontör",
    body: "GİB e-belge kontör bakiyesi ve hareketleri. e-Fatura gönderimi kontör harcar. Bu yetki Firma Ayarları'ndan ayrıdır; eski rollerde ayar seviyesi okuma anında devralınır.",
    levels: LEVELS,
    tip: "Kontör bakiyesini görmesi gereken kişilere en az Görür verin.",
  },
  "/contacts": {
    group: "Satış",
    title: "Cari Hesaplar",
    body: "Müşteri ve tedarikçi kartları, ekstre, bakiye ve tahsilat.",
    levels: LEVELS,
    shot: "Cari ekstre ve paylaşım bağlantısı",
  },
  "/orders": {
    group: "Satış",
    title: "Teklif & Sipariş",
    body: "Teklif, müşteri onayı, sipariş, iade ve siparişten kargo gönderisi. Ekler/Düzenler seviyesindeki kişi kargo gönderisini ayrıca Kargo yetkisi olmadan oluşturabilir. Proje, keşif, e-ticaret ve saha siparişi bu satırla birlikte tutulur.",
    levels: LEVELS,
  },
  "/hizli-satis": {
    group: "Satış",
    title: "Hızlı Satış (POS)",
    body: "Perakende satış ekranı, tartı ve termal fiş.",
    levels: LEVELS,
  },
  "/b2b-yonetim": {
    group: "Satış",
    title: "B2B Bayi Portalı",
    body: "Bayi portalı ayarları, bayi erişimi ve portal menüsü. Eski rollerde cari seviyesi okuma anında devralınır.",
    levels: LEVELS,
  },
  "/stock": {
    group: "Stok & Depo",
    title: "Stok & Ürünler",
    body: "Ürün kartı, barkod, etiket ve fiyatlar. Ürün fiyatını değiştirmek için Ekler/Düzenler gerekir.",
    levels: LEVELS,
  },
  "/warehouses": {
    group: "Stok & Depo",
    title: "Depo, Sayım & Sevkiyat",
    body: "Çoklu depo ve transfer, tablet stok sayımı, sipariş toplama. Personel portalındaki çalışanlar için Gelişmiş › Personel portalı da açılmalıdır.",
    levels: LEVELS,
    shot: "Tablet sayım ekranı",
  },
  "/purchase-orders": {
    group: "Stok & Depo",
    title: "Verilen Siparişler",
    body: "Tedarikçiye verilen siparişler. Mobil uygulama, rolde bu yetki yoksa stok yetkisine bakar.",
    levels: LEVELS,
  },
  "/production": {
    group: "Üretim",
    title: "Üretim & Reçete",
    body: "Reçete (ürün ağacı), üretim emirleri ve eksik malzeme planı.",
    levels: LEVELS,
  },
  "/atolye": {
    group: "Üretim",
    title: "Atölye Ekranı",
    body: "Tablet atölye ekranı: operatör PIN'i, iş emri, fire ve kısmi adet. Başlat, duraklat ve bitir Ekler/Düzenler ister. Silmek için Siler gerekir. Eski üretim rolleri bu yetkiyi üretim seviyesinden devralır.",
    levels: {
      none: "Atölye ekranı açılmaz.",
      view: "İş emri listelenir ve PIN ekranı açılır. Başlat, duraklat ve bitir kapalıdır.",
      edit: "İş emri başlatılır, duraklatılır ve bitirilir.",
      delete: "İş emri silinebilir.",
    },
    shot: "Operatörün PIN ile giriş yaptığı atölye ekranı",
  },
  "/personnel": {
    group: "İK",
    title: "Personel & Bordro",
    body: "Personel kartları, ücret, avans, prim, izin ve ödemeler. Hassas kişisel veri içerir; yalnızca İK ve yöneticilere verin.",
    levels: LEVELS,
  },
  "/mesai": {
    group: "İK",
    title: "Mesai",
    body: "Puantaj, giriş-çıkış ve fazla mesai. Çalışanın kendi giriş-çıkışı bu yetkiden bağımsızdır; herkes kendi kaydını görür.",
    levels: LEVELS,
  },
  "/reports": {
    group: "Diğer",
    title: "Raporlar",
    body: "Satış, alış, stok, nakit akışı, KDV ve kârlılık raporları ile dışa aktarım. Fiyat görme kapalıysa tutarlar 0 görünür.",
    levels: LEVELS,
  },
  "/communication": {
    group: "Diğer",
    title: "İletişim",
    body: "SMS, e-posta ve WhatsApp Business gönderimleri ile destek talepleri. SMS ayarları ve bakiye Firma Ayarları yetkisindedir.",
    levels: LEVELS,
  },
  "/ai-advisor": {
    group: "Diğer",
    title: "AI Asistan",
    body: "AI danışmanla sohbet ve nakit tahmini. Fatura, fiş ve çek okuma, ilgili modülün yetkisiyle çalışır. Lisans eklentisi gerekir.",
    levels: LEVELS,
  },
  "/company-share": {
    group: "Diğer",
    title: "Şirketler arası paylaşım",
    body: "Aynı lisans altındaki şirketler arasında cari, stok, fiyat ve fatura okuma bağlantısı. Bağlantı kurma ve kapsam değiştirme bu yetkiye bağlıdır. Eski rollerde Firma Ayarları seviyesi okuma anında devralınır.",
    levels: LEVELS,
  },
  "/settings": {
    group: "Diğer",
    title: "Firma Ayarları",
    body: "Kullanıcı ve rol, entegrasyonlar ve sanal POS. Yalnızca yöneticilere verilmelidir.",
    levels: LEVELS,
  },
  "/accountant": {
    group: "Diğer",
    title: "Mali Müşavir Paneli",
    body: "KDV özeti, beyanname evrakı ve mali müşavir ekranı.",
    levels: LEVELS,
  },
  "/trash": {
    group: "Diğer",
    title: "Çöp Kutusu",
    body: "Silinen kayıtlar 30 gün içinde geri alınabilir.",
    levels: LEVELS,
  },
  "/": {
    group: "Diğer",
    title: "Genel Bakış",
    body: "Özet pano, KPI kartları ve hızlı işlemler.",
    levels: LEVELS,
  },
};

export function helpFor(key) {
  return ROLE_HELP[key] || {
    group: "Yetki",
    title: key,
    body: "Bu satır bağlı modüllerin ekranlarını açar.",
    levels: LEVELS,
  };
}
