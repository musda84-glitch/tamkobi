import { toast } from "sonner";

/** Ürün/miktar senkronu atlandığında API'nin döndürdüğü uyarı. */
export function orderSyncWarningText(payload) {
  if (!payload || typeof payload !== "object") return "";
  const text = payload.order_sync_warning;
  return typeof text === "string" ? text.trim() : "";
}

export function notifyOrderSyncWarning(payload) {
  const text = orderSyncWarningText(payload);
  if (text) toast.warning(text);
  return text;
}
