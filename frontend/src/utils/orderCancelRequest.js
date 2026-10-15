/** Firma paneli B2B iptal talebi rozeti / onay-red. */

import { bulkApiErrorDetail } from "./orderBulkActions";

export const CANCEL_REQUEST_ACCEPT_CONFIRM =
  "Sipariş ve bağlı taslak fatura çöp kutusuna taşınacak.";

export const CANCEL_REQUEST_BADGE_LABEL = "İptal talebi";

export function hasPendingCancelRequest(ord) {
  return String(ord?.cancel_request?.status || "") === "pending";
}

export function cancelRequestReason(ord) {
  return String(ord?.cancel_request?.reason || "").trim();
}

export function cancelRequestBadgeTitle(ord) {
  const reason = cancelRequestReason(ord);
  return reason ? `${CANCEL_REQUEST_BADGE_LABEL}: ${reason}` : CANCEL_REQUEST_BADGE_LABEL;
}

export function pendingCancelRequestOrders(list) {
  return (list || []).filter(hasPendingCancelRequest);
}

export function resolveCancelRequestError(err) {
  return bulkApiErrorDetail(err) || "İşlem yapılamadı.";
}

export async function postResolveCancelRequest(axiosClient, apiUrl, ord, action, note = "") {
  const id = ord?.id || ord?._id;
  const r = await axiosClient.post(`${apiUrl}/orders/${id}/resolve-cancel-request`, {
    action,
    note: note || "",
  });
  return r.data;
}

/** Çoklu onay/red: satır bazlı BulkResultModal öğeleri. */
export async function resolveCancelRequestsBulk(axiosClient, apiUrl, orders, action, note = "") {
  const items = [];
  for (const ord of orders || []) {
    const id = ord?.id || ord?._id;
    const label = ord?.order_number || id || "Sipariş";
    if (!hasPendingCancelRequest(ord)) {
      items.push({ id, label, outcome: "skipped", reason: "Bekleyen iptal talebi yok." });
      continue;
    }
    try {
      await postResolveCancelRequest(axiosClient, apiUrl, ord, action, note);
      items.push({ id, label, outcome: "ok" });
    } catch (err) {
      items.push({ id, label, outcome: "error", reason: resolveCancelRequestError(err) });
    }
  }
  return items;
}
