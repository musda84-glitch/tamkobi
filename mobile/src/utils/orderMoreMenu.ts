/** Web OrdersB2BPage ⋮ menü düzeni: araç çubuğu + E-Belge grubu. */

export type OrderMoreKey =
  | "delete"
  | "invoice"
  | "invoiced"
  | "cargo"
  | "approve"
  | "print"
  | "more"
  | "efatura"
  | "earsiv"
  | "edit"
  | "dispatch"
  | "return"
  | "label"
  | "notify"
  | "prod";

export type OrderMoreFlags = {
  showDelete?: boolean;
  showInvoice?: boolean;
  showInvoiced?: boolean;
  showCargo?: boolean;
  showApprove?: boolean;
  showEBelge?: boolean;
  showEFatura?: boolean;
  showEdit?: boolean;
  showReturn?: boolean;
  showProduce?: boolean;
  dispatchNumber?: string | null;
  formPrinted?: boolean;
};

export function canReturnOrder(status?: string | null): boolean {
  const s = String(status || "").trim().toLowerCase();
  return s !== "returned" && s !== "iade edildi";
}

export function eBelgeMenuItems(showEFatura: boolean): Array<{
  key: "efatura" | "earsiv";
  eType: "e_invoice" | "e_archive";
  label: string;
  testIdSuffix: string;
}> {
  const earsiv = {
    key: "earsiv" as const,
    eType: "e_archive" as const,
    label: "E-Arşiv kes (GİB)",
    testIdSuffix: "earsiv",
  };
  if (showEFatura) {
    return [
      { key: "efatura", eType: "e_invoice", label: "E-Fatura kes (GİB)", testIdSuffix: "efatura" },
      earsiv,
    ];
  }
  return [earsiv];
}

/** Web satırındaki sil / faturala / kargo / onay / yazdır / ⋮ sırası. */
export function orderToolbarKeys(f: OrderMoreFlags): OrderMoreKey[] {
  const keys: OrderMoreKey[] = [];
  if (f.showDelete) keys.push("delete");
  if (f.showInvoice) keys.push("invoice");
  else if (f.showInvoiced) keys.push("invoiced");
  if (f.showCargo) keys.push("cargo");
  if (f.showApprove) keys.push("approve");
  keys.push("print", "more");
  return keys;
}

export function orderMoreMenuSections(f: OrderMoreFlags): Array<{ title?: string; keys: OrderMoreKey[] }> {
  const sections: Array<{ title?: string; keys: OrderMoreKey[] }> = [];
  if (f.showEBelge) {
    sections.push({
      title: "E-Belge (GİB)",
      keys: eBelgeMenuItems(!!f.showEFatura).map((item) => item.key),
    });
  }
  const rest: OrderMoreKey[] = [];
  if (f.showEdit) rest.push("edit");
  rest.push("dispatch");
  if (f.showReturn !== false) rest.push("return");
  rest.push("label", "print", "notify");
  if (f.showProduce) rest.push("prod");
  sections.push({ keys: rest });
  return sections;
}

export function dispatchMenuLabel(dispatchNumber?: string | null): string {
  return dispatchNumber ? `İrsaliye: ${dispatchNumber}` : "E-İrsaliye Oluştur & Yazdır";
}

export function printMenuLabel(formPrinted?: boolean): string {
  return formPrinted ? "Sipariş Formu (yazdırıldı)" : "Sipariş Formu Yazdır";
}

export function orderNotifySubject(orderNumber?: string | null): string {
  return `Siparişiniz Yola Çıktı - ${orderNumber || ""}`.replace(/\s+$/, "");
}

export function orderNotifyMessage(order: {
  customer_name?: string;
  order_number?: string;
  cargo_carrier?: string;
  cargo_carrier_name?: string;
  cargo_tracking_number?: string;
}): string {
  const carrier = order.cargo_carrier_name || order.cargo_carrier || "kargo";
  return `Sayın ${order.customer_name || "müşterimiz"}, ${order.order_number || "siparişiniz"} numaralı siparişiniz ${carrier} ile yola çıktı. Takip No: ${order.cargo_tracking_number || "-"}. İyi günler dileriz.`;
}
