/** Sipariş satırı aksiyon butonları: yazdırıldı / sevk edildi görünümü */

export function orderIsShipped(ord = {}) {
  if (ord.cargo_tracking_number) return true;
  const s = String(ord.order_status || "").toLowerCase();
  return ["shipped", "completed", "delivered", "in_transit"].includes(s);
}

export function orderFormPrinted(ord = {}) {
  return Boolean(ord.form_printed_at);
}

export function cargoActionButtonClass(ord = {}) {
  if (orderIsShipped(ord)) {
    return "p-1.5 bg-sky-600 hover:bg-sky-700 text-white rounded-lg shadow-sm ring-1 ring-sky-700/30";
  }
  return "p-1.5 bg-sky-50 hover:bg-sky-100 text-sky-800 rounded-lg";
}

export function printOrderButtonClass(ord = {}) {
  if (orderFormPrinted(ord)) {
    return "p-1.5 text-white bg-violet-600 hover:bg-violet-700 border border-violet-700 rounded-lg shadow-sm";
  }
  return "p-1.5 text-violet-700 bg-violet-50 hover:bg-violet-100 border border-violet-200 rounded-lg";
}

export function cargoActionTitle(ord = {}) {
  if (ord.cargo_tracking_number) {
    return `Sevk edildi · ${ord.cargo_tracking_number}${ord.label_printed_at ? " · etiket yazdırıldı" : ""}`;
  }
  if (orderIsShipped(ord)) return "Sevk edildi";
  return "Kargola";
}

export function printOrderTitle(ord = {}) {
  if (orderFormPrinted(ord)) {
    return `Sipariş formu yazdırıldı${ord.form_printed_at ? ` · ${String(ord.form_printed_at).slice(0, 16).replace("T", " ")}` : ""}`;
  }
  return "Sipariş Formu Yazdır";
}
