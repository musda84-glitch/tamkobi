/** Seçili sunucu listede yoksa (silinmiş / eski id) ilk kayıtlı sunucuya düş; yoksa boş. */
export function pickMailServerId(current, servers) {
  const list = Array.isArray(servers) ? servers : [];
  const cur = current == null ? "" : String(current);
  if (cur && list.some((s) => s && s.id === cur)) return cur;
  return (list[0] && list[0].id) || "";
}
