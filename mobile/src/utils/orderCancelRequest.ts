import type { Order } from "../types";

export const CANCEL_REQUEST_ACCEPT_CONFIRM =
  "Sipariş ve bağlı taslak fatura çöp kutusuna taşınacak.";

export const CANCEL_REQUEST_BADGE_LABEL = "İptal talebi";

export type CancelRequestOrder = Pick<Order, "cancel_request" | "order_number"> | null | undefined;

export function hasPendingCancelRequest(o: CancelRequestOrder): boolean {
  return String(o?.cancel_request?.status || "") === "pending";
}

export function cancelRequestBadgeVisible(o: CancelRequestOrder): boolean {
  return hasPendingCancelRequest(o);
}

export function cancelRequestActionsVisible(o: CancelRequestOrder): boolean {
  return hasPendingCancelRequest(o);
}

export function cancelRequestReason(o: CancelRequestOrder): string {
  return String(o?.cancel_request?.reason || "").trim();
}
