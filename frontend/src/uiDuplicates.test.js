/**
 * Aynı arayüz parçasının iki kez çizilmesine karşı koruma.
 *
 * PR'lar birleştirilirken çakışan satırların iki tarafı da korunmuş; sonuçta cari
 * kartındaki sekmeler, hesap menüsündeki "Firma ayarları" ve kayıt sayfasındaki
 * paket seçimi ekranda çift göründü. Kod derlendiği için hiçbir test bunu yakalamadı.
 *
 * Buradaki dört kural o izi arar:
 *   1. Bir dosyada aynı data-testid iki kez üretilmemeli — testid'ler zaten tekil
 *      olmalı, çift olması genelde bloğun iki kez çizildiği anlamına gelir.
 *   2. Yan yana (en fazla 4 satır arayla) birebir aynı JSX satırı bulunmamalı.
 *   3. Bir olay işleyicisi e.preventDefault()'u iki kez çağırmamalı. Çizim değil
 *      mantık tarafındaki aynı hata bu izi bırakıyor: birleştirme iki gönderim
 *      gövdesini art arda eklediğinde form iki kez POST edilir.
 *   4. Yan yana iki satır aynı yapıyı çizip aynı değişkeni içerik olarak
 *      basmamalı. Birinci kural yalnızca birebir aynı satırları görüyor; oysa
 *      çakışmanın iki tarafı genelde biraz ayrışır (cari kartı sekmelerinde bir
 *      taraf `projects`, öteki `cheques` dalını taşıyordu) ve satır artık
 *      birebir aynı olmadığı için gözden kaçar.
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

/**
 * Satırın JSX iskeleti: dizeler ve süslü parantez içindeki ifadeler silinir,
 * geriye etiket yapısı kalır. İki satır aynı şeyi çiziyorsa iskeletleri eşleşir.
 */
function skeleton(line) {
  const flat = line.replace(/"[^"]*"/g, '""').replace(/'[^']*'/g, "''").replace(/`[^`]*`/g, "``");
  let depth = 0;
  let out = "";
  for (const ch of flat) {
    if (ch === "{") {
      depth += 1;
      if (depth === 1) out += "{";
    } else if (ch === "}") {
      if (depth === 1) out += "}";
      depth = Math.max(0, depth - 1);
    } else if (depth === 0) {
      out += ch;
    }
  }
  return out.trim();
}

/**
 * İçerik olarak basılan ifadeler: `{l}` gibi çocuk ifadeler alınır, `opts={opts}`
 * gibi nitelik değerleri alınmaz. Ayrım gerekli, çünkü kardeş satırların aynı
 * yardımcıyı veya aynı state'i nitelik olarak paylaşması normaldir; aynı
 * değişkeni ekrana iki kez basmaları değildir.
 */
function childExpressions(line) {
  const out = [];
  let depth = 0;
  let buf = "";
  let start = -1;
  for (let i = 0; i < line.length; i += 1) {
    const ch = line[i];
    if (ch === "{") {
      depth += 1;
      if (depth === 1) {
        buf = "";
        start = i;
        continue;
      }
    } else if (ch === "}") {
      if (depth === 1 && line[start - 1] !== "=") out.push(buf.trim());
      depth = Math.max(0, depth - 1);
      continue;
    }
    if (depth >= 1) buf += ch;
  }
  return out.filter(Boolean);
}

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

  test("yan yana iki satır aynı içeriği çizmiyor", () => {
    const offenders = [];
    for (const { rel, text } of FILES) {
      const lines = text.split("\n").map((l) => l.trim());
      for (let i = 0; i < lines.length - 1; i += 1) {
        const a = lines[i];
        const b = lines[i + 1];
        if (!a.includes("<") || a.startsWith("//") || a.startsWith("*")) continue;
        const shape = skeleton(a);
        if (shape.length <= 25 || shape !== skeleton(b)) continue;
        const shared = childExpressions(a).filter((x) => childExpressions(b).includes(x));
        if (shared.length) offenders.push(`${rel}:${i + 1} ile ${i + 2} aynı {${shared[0]}} içeriğini çiziyor`);
      }
    }
    expect(offenders).toEqual([]);
  });

  test("bir olay işleyicisi formu iki kez göndermiyor", () => {
    // İki preventDefault arasında yeni bir fonksiyon ya da else dalı varsa
    // ayrı işleyicilerdir; aksi halde aynı gövde iki kez yazılmış demektir.
    const boundary = /=>|\bfunction\b|\belse\b/;
    const offenders = [];
    for (const { rel, text } of FILES) {
      const lines = text.split("\n");
      const marks = lines.map((l, i) => (/\.preventDefault\s*\(\s*\)/.test(l) ? i : -1)).filter((i) => i >= 0);
      for (let k = 0; k < marks.length - 1; k += 1) {
        if (!boundary.test(lines.slice(marks[k], marks[k + 1]).join("\n"))) {
          offenders.push(`${rel}: ${marks[k] + 1} ve ${marks[k + 1] + 1}`);
        }
      }
    }
    expect(offenders).toEqual([]);
  });
});
