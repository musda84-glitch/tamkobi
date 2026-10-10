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

/**
 * ISO datetime / epoch → "23.09.2026 15:38" (yerel saat).
 * Yalnızca gün varsa saat yok: "23.09.2026".
 */
export function fmtDmyTime(value) {
  const raw = String(value || "").trim();
  if (!raw) return "";
  // Düz gün: saat yok
  if (/^\d{4}-\d{2}-\d{2}$/.test(raw) || DMY_DOT.test(raw) || DMY_SLASH.test(raw)) {
    return fmtDmy(raw);
  }
  const t = Date.parse(raw);
  if (Number.isNaN(t)) return fmtDmy(raw);
  const d = new Date(t);
  const day = `${_pad2(d.getDate())}.${_pad2(d.getMonth() + 1)}.${d.getFullYear()}`;
  const hm = `${_pad2(d.getHours())}:${_pad2(d.getMinutes())}`;
  return `${day} ${hm}`;
}

/** Masraf listesi: belge tarihi (gg.aa.yyyy) + işlem anı (created_at). */
export function expenseListDateLines(exp) {
  const date = fmtDmy(exp?.date);
  const txn = fmtDmyTime(exp?.created_at);
  const sameDay = txn && date !== "—" && txn.startsWith(date);
  return {
    date,
    /** İşlem satırı: saat varsa her zaman; yoksa belge tarihinden farklıysa */
    txn: txn && txn !== date ? txn : (sameDay && txn.includes(" ") ? txn : ""),
    txnLabel: "İşlem",
  };
}
