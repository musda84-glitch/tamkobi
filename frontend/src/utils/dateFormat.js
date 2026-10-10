/** Tarih gösterimi: gün.ay.yıl (22.09.2026). ISO ve karışık girdileri normalize eder. */

const ISO_DAY = /^(\d{4})-(\d{2})-(\d{2})/;
const DMY_DOT = /^(\d{1,2})\.(\d{1,2})\.(\d{4})$/;
const DMY_SLASH = /^(\d{1,2})\/(\d{1,2})\/(\d{4})$/;

function _pad2(n) {
  return String(n).padStart(2, "0");
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
