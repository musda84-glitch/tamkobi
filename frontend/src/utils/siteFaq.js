/** Ana sayfa SSS — FAQPage JSON-LD ile paylaşılır. trial_days ayardan gelir. */
export function buildSiteFaq(trialDays = 14) {
  const days = Number(trialDays) > 0 ? Number(trialDays) : 14;
  return [
    {
      q: "TamKobi GİB e-Fatura ile entegre mi?",
      // Kodda birden fazla e-belge entegratörü / gelen kutusu var; belirli marka taahhüdü yok.
      a: "Evet. e-Fatura ve e-Arşiv için şirket ayarlarından bir entegratör bağlantısı yapılandırılabilir; gelen e-belgeler uygulama içi kutuda listelenir. Kontör ve entegratör anlaşması firmanıza aittir.",
    },
    {
      q: "Verilerim güvende mi?",
      // Düzenli yedekleme / erişim logları altyapı iddiası — ürün kodunda garantilenmez.
      a: "Verileriniz şirket bazında ayrılır; erişim rol ve yetki matrisine göre kısıtlanır. Kişisel veri işleme detayları KVKK aydınlatma metninde yer alır.",
    },
    {
      q: "Başka bir programdan veri aktarabilir miyim?",
      // Logo/Paraşüt’e özel geçiş sihirbazı yok; genel içe aktarma / destek süreci.
      a: "Stok ve cari gibi alanlarda içe aktarma araçları bulunur. Toplu geçiş için destek kanalından planlama isteyebilirsiniz; alan eşlemesi firmanıza göre yapılır.",
    },
    {
      q: `${days} günlük denemede kredi kartı ister misiniz?`,
      a: `Hayır. ${days} günlük denemede kredi kartı gerekmez. Süre bitiminde bir paket seçerek devam edebilir veya hesabı kullanmayı bırakabilirsiniz.`,
    },
    {
      q: "İstediğim zaman iptal edebilir miyim?",
      // “Zorunlu taahhüt yok” yasal/sözleşme iddiası — kod doğrulamaz; genel süreç.
      a: "Abonelik ve iptal koşulları mesafeli satış / ön bilgilendirme metinlerinde ve hesabınızdaki lisans durumuna göre uygulanır. İptal veya veri dışa aktarımı için destek kanalını kullanın.",
    },
    {
      q: "Destek nasıl çalışıyor?",
      a: "Tanımlıysa destek e-postası ve WhatsApp üzerinden ulaşabilirsiniz. Uygulama içinde de destek talebi açılabilir.",
    },
  ];
}

/** Geriye dönük: varsayılan deneme günü ile statik liste */
export const SITE_FAQ = buildSiteFaq(14);
