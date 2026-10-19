import { channelTr } from "./labels";

/** Sipariş kaynağı olup pazaryeri olmayan kanallar eşleştirme listesine girmez. */
export const NON_MARKETPLACE_CHANNELS = new Set(["b2b", "manual", "saha"]);

/** Kanal kodu: küçük harf ve kırpılmış. Nesne ve boş değer boş anahtar döner. */
export function mapChannelKey(code) {
  if (typeof code === "number" && Number.isFinite(code)) return String(code).trim();
  if (typeof code !== "string") return "";
  return code.toLowerCase().trim();
}

/** Pazaryeri eşleştirmesine girebilen kanal (b2b, manual, saha ve boş hariç). */
export function isMappableChannel(code) {
  const key = mapChannelKey(code);
  return Boolean(key) && !NON_MARKETPLACE_CHANNELS.has(key);
}

/**
 * Ürün eşleştirme formu: şirkete eklenmiş tüm e-ticaret kanalları.
 * is_active false olanlar da listelenir — Kanal Ekle kanalı pasif oluşturur;
 * is_active yalnız Kaydet & Bağlan veya başarılı bağlantı testinden sonra true olur.
 * İkinci argüman, eşleşmemiş ürün ve mevcut eşleştirmelerden gelen ek kanal kodlarını
 * (ör. Excel/AI ile yüklenen siparişler) ekler. b2b, manual, saha ve boş kodlar alınmaz.
 */
export function connectedMapChannels(integrations, extraChannels) {
  const seen = new Set();
  const out = [];
  const push = (key, label) => {
    if (!key || seen.has(key)) return;
    seen.add(key);
    out.push({
      channel: key,
      label: String(label || channelTr(key) || key).trim() || key,
    });
  };
  for (const ch of integrations || []) {
    const key = mapChannelKey(ch?.channel);
    if (!key) continue;
    push(key, ch?.channel_name || channelTr(key) || key);
  }
  for (const code of extraChannels || []) {
    if (!isMappableChannel(code)) continue;
    const key = mapChannelKey(code);
    push(key, channelTr(key) || key);
  }
  return out;
}

/** Seçili kanal listede yoksa ilk ekli kanala düş. */
export function pickMapChannel(current, channels) {
  const list = Array.isArray(channels) ? channels : [];
  if (!list.length) return "";
  const cur = mapChannelKey(current);
  if (cur && list.some((c) => c.channel === cur)) return cur;
  return list[0].channel;
}
