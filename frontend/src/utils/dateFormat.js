/** Tarih gösterimi: gün.ay.yıl (22.09.2026). ISO ve karışık girdileri normalize eder. */

const ISO_DAY = /^(\d{4})-(\d{2})-(\d{2})/;
const DMY_DOT = /^(\d{1,2})\.(\d{1,2})\.(\d{4})$/;
const DMY_SLASH = /^(\d{1,2})\/(\d{1,2})\/(\d{4})$/;

function _pad2(n) {
  return String(n).padStart(2, "0");
}

/**
 * Sıralama anahtarı: YYYY-MM-DD (lexicographic = kronolojik).
 * ISO, gg.aa.yyyy, gg/aa/yyyy ve ISO datetime destekler.
 */
export function dateSortKey(value) {
  const raw = String(value || "").trim();
  if (!raw) return "";
  const iso = ISO_DAY.exec(raw);
  if (iso) return `${iso[1]}-${iso[2]}-${iso[3]}`;
  const dmy = DMY_DOT.exec(raw) || DMY_SLASH.exec(raw);
  if (dmy) return `${dmy[3]}-${_pad2(dmy[2])}-${_pad2(dmy[1])}`;
  const t = Date.parse(raw);
  if (!Number.isNaN(t)) {
    const d = new Date(t);
    return `${d.getUTCFullYear()}-${_pad2(d.getUTCMonth() + 1)}-${_pad2(d.getUTCDate())}`;
  }
  return raw.slice(0, 10);
}

/** YYYY-MM-DD / ISO / gg.aa.yyyy / gg/aa/yyyy → 23.09.2026 */
export function fmtDmy(value) {
  const raw = String(value || "").trim();
  if (!raw) return "—";
  const iso = ISO_DAY.exec(raw);
  if (iso) return `${iso[3]}.${iso[2]}.${iso[1]}`;
  const dmy = DMY_DOT.exec(raw) || DMY_SLASH.exec(raw);
  if (dmy) return `${_pad2(dmy[1])}.${_pad2(dmy[2])}.${dmy[3]}`;
  // Bilinmeyen: ilk 10 karakteri göster (eski ham değer)
  return raw.slice(0, 10);
}
