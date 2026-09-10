/**
 * Aynı arayüz parçasının iki kez çizilmesine karşı koruma.
 *
 * PR'lar birleştirilirken çakışan satırların iki tarafı da korunmuş; sonuçta cari
 * kartındaki sekmeler, hesap menüsündeki "Firma ayarları" ve kayıt sayfasındaki
 * paket seçimi ekranda çift göründü. Kod derlendiği için hiçbir test bunu yakalamadı.
 *
 * Buradaki iki kural o izi arar:
 *   1. Bir dosyada aynı data-testid iki kez üretilmemeli — testid'ler zaten tekil
 *      olmalı, çift olması genelde bloğun iki kez çizildiği anlamına gelir.
 *   2. Yan yana (en fazla 4 satır arayla) birebir aynı JSX satırı bulunmamalı.
 *
 * Meşru istisnalar ALLOWED_DUPLICATE_TESTIDS'te tek tek listelenir; dosya değil
 * (dosya, testid) çifti muaf tutulur ki aynı dosyadaki yeni bir hata gizlenmesin.
 */
const fs = require("fs");
const path = require("path");

const SRC = __dirname;

/** Aynı testid'nin birden çok kez geçmesi doğru olan yerler ve sebepleri. */
const ALLOWED_DUPLICATE_TESTIDS = {
  "components/AppSidebarNav.jsx": ["{`nav-group-${g.id}`}"], // başlıklı ve başlıksız grup dalları
  "components/ContactForm.jsx": ["{`cf-${k}`}"], // input / select / checkbox yardımcıları
  "components/LabelDesigner.jsx": ['"label-print-tpl"', '"label-print-close"', '"label-page-mode"', '"label-page-cols"', '"label-print-btn"'], // toplu ve hızlı yazdırma panelleri
  "components/PrintDocument.jsx": ["{`tpl-${k}`}"], // iki ayrı ayar grubu, anahtar bazlı
  "components/saas/AiProviderPanel.jsx": ['"ai-advisor-model"', '"ai-extract-model"'], // özel sağlayıcıda serbest metin, aksi halde liste
  "components/SupportContactBar.jsx": ['"support-contact-link"'], // Link / <a> dalları
  "pages/PaymentResultPage.jsx": ['"payment-success-title"'], // kontör ve abonelik başarı dalları
  "pages/SupportPage.jsx": ["{`support-att-${i}`}"], // görsel ve dosya eki dalları
};

function sourceFiles(dir = SRC, out = []) {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      if (entry.name !== "node_modules") sourceFiles(full, out);
    } else if (/\.jsx?$/.test(entry.name) && !/\.test\.jsx?$/.test(entry.name)) {
      out.push(full);
    }
  }
  return out;
}

const FILES = sourceFiles().map((full) => ({
  rel: path.relative(SRC, full).split(path.sep).join("/"),
  text: fs.readFileSync(full, "utf8"),
}));

const TESTID = /data-testid=(\{`[^`]*`\}|"[^"]*")/g;

describe("arayüzde çift çizilen bloklar", () => {
  test("bir dosyada aynı data-testid iki kez üretilmiyor", () => {
    const offenders = [];
    for (const { rel, text } of FILES) {
      const counts = new Map();
      for (const m of text.matchAll(TESTID)) counts.set(m[1], (counts.get(m[1]) || 0) + 1);
      const allowed = ALLOWED_DUPLICATE_TESTIDS[rel] || [];
      for (const [id, n] of counts) {
        if (n > 1 && !allowed.includes(id)) offenders.push(`${rel}: ${id} ×${n}`);
      }
    }
    expect(offenders).toEqual([]);
  });

  test("yan yana birebir aynı JSX satırı yok", () => {
    const offenders = [];
    for (const { rel, text } of FILES) {
      const lines = text.split("\n").map((l) => l.replace(/\s+/g, " ").trim());
      for (let i = 0; i < lines.length; i += 1) {
        const line = lines[i];
        // Yalnızca kendi başına bir şey çizen satırlar: açılış etiketi olan
        // sarmalayıcılar kardeş bloklarda doğal olarak tekrar eder.
        if (line.length < 60) continue;
        if (!line.startsWith("{") && !line.includes("data-testid")) continue;
        for (let j = i + 1; j < Math.min(i + 5, lines.length); j += 1) {
          if (lines[j] === line) offenders.push(`${rel}:${i + 1} ile ${j + 1} aynı`);
        }
      }
    }
    expect(offenders).toEqual([]);
  });
});
