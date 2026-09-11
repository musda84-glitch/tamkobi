/**
 * Firma Ayarları iki yerden açılıyor: kendi adresinden (/settings) ve Hesabım
 * sayfasının "Firma ayarları" sekmesinin içinden.
 *
 * Hesabım kendi sekmesini `?tab=` ile taşıyor. Gömülü ayarlar sayfası da aynı
 * parametreyi okursa bölüm adı `ayarlar` olur; bu hiçbir ayar bölümüne
 * karşılık gelmediği için içerik boş kalır. Bu yüzden gömülü hâlde bölüm adı
 * ayrı bir parametrede (`?ayar=`) durur ve `tab=ayarlar` olduğu gibi korunur.
 */

export const SETTINGS_PARAM = "tab";
export const EMBEDDED_SETTINGS_PARAM = "ayar";
export const DEFAULT_SETTINGS_TAB = "company";

/** Bölüm adının hangi sorgu parametresinde durduğu. */
export function settingsParamFor(embedded) {
  return embedded ? EMBEDDED_SETTINGS_PARAM : SETTINGS_PARAM;
}

/** Adresten açık olan ayar bölümünü okur. */
export function readSettingsTab(search, embedded = false) {
  const value = new URLSearchParams(search).get(settingsParamFor(embedded));
  return value || DEFAULT_SETTINGS_TAB;
}

/**
 * Bölümü değiştirirken adresteki diğer parametreleri korur — gömülü hâlde
 * `tab=ayarlar` düşerse Hesabım başka bir sekmeye atlar.
 */
export function writeSettingsTab(search, embedded, key) {
  const next = new URLSearchParams(search);
  next.set(settingsParamFor(embedded), key);
  return next;
}
