/** Kayıtta link yoksa koordinat, o da yoksa adres araması. Mobil `mapsLink` ile aynı sıra. */
export function workMapsLink(row) {
  if (!row) return null;
  if (row.location_url) return String(row.location_url);
  if (row.latitude != null && row.latitude !== "" && row.longitude != null && row.longitude !== "") {
    return `https://www.google.com/maps?q=${row.latitude},${row.longitude}`;
  }
  const addr = String(row.address || "").trim();
  return addr ? `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(addr)}` : null;
}
