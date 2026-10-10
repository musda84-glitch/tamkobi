import { channelTr } from "./labels";

/**
 * Ürün eşleştirme formu: yalnızca şirkete eklenmiş e-ticaret kanalları.
 * Pasif (is_active === false) kanallar listeden çıkar.
 */
export function connectedMapChannels(integrations) {
  const seen = new Set();
  const out = [];
  for (const ch of integrations || []) {
    if (ch?.is_active === false) continue;
    const key = String(ch?.channel || "").toLowerCase().trim();
    if (!key || seen.has(key)) continue;
    seen.add(key);
    out.push({
      channel: key,
      label: String(ch?.channel_name || channelTr(key) || key).trim() || key,
    });
  }
  return out;
}

/** Seçili kanal listede yoksa ilk ekli kanala düş. */
export function pickMapChannel(current, channels) {
  const list = Array.isArray(channels) ? channels : [];
  if (!list.length) return "";
  const cur = String(current || "").toLowerCase().trim();
  if (cur && list.some((c) => c.channel === cur)) return cur;
  return list[0].channel;
}
