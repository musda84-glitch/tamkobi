/** Pazaryeri (Trendyol vb.) paket kargo firması seçenekleri — entegrasyon cargoProvider eşlemesi. */
export const MARKETPLACE_CARGO_OPTIONS = [
  { carrier_code: "yurtici", carrier_name: "Yurtiçi Kargo" },
  { carrier_code: "aras", carrier_name: "Aras Kargo" },
  { carrier_code: "mng", carrier_name: "MNG Kargo" },
  { carrier_code: "ptt", carrier_name: "PTT Kargo" },
  { carrier_code: "surat", carrier_name: "Sürat Kargo" },
  { carrier_code: "trendyolexpress", carrier_name: "Trendyol Express" },
  { carrier_code: "hepsijet", carrier_name: "HepsiJet" },
  { carrier_code: "kolaygelsin", carrier_name: "Kolay Gelsin" },
  { carrier_code: "ups", carrier_name: "UPS" },
  { carrier_code: "horoz", carrier_name: "Horoz Lojistik" },
  { carrier_code: "ceva", carrier_name: "CEVA" },
];

export function marketplaceCargoOptions(order) {
  const cur = String(order?.cargo_carrier || "").trim().toLowerCase().replace(/\s+/g, "_");
  const name = String(order?.cargo_carrier_name || "").trim();
  const list = MARKETPLACE_CARGO_OPTIONS.map((o) => ({ ...o }));
  if (cur && !list.some((o) => o.carrier_code === cur)) {
    list.unshift({
      carrier_code: cur,
      carrier_name: name || order.cargo_carrier || cur,
      from_marketplace: true,
    });
  }
  return list;
}

export function cargoChangeBody(code, name) {
  const out = { cargo_carrier: String(code || "").trim() };
  if (name) out.cargo_carrier_name = String(name).trim();
  return out;
}

export function cargoChangeConfirm(order, carrierName) {
  const prev = order?.cargo_carrier_name || order?.cargo_carrier || "—";
  return `${order?.order_number || "Sipariş"} kargo firması değiştirilsin mi?\n${prev} → ${carrierName}\nDeğişiklik pazaryeri entegrasyonuna iletilir.`;
}
