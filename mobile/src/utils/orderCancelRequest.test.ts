import {
  CANCEL_REQUEST_ACCEPT_CONFIRM,
  CANCEL_REQUEST_BADGE_LABEL,
  hasPendingCancelRequest,
  cancelRequestBadgeVisible,
  cancelRequestActionsVisible,
  cancelRequestReason,
} from "./orderCancelRequest";

describe("orderCancelRequest", () => {
  it("shows amber badge only for pending cancel requests", () => {
    expect(cancelRequestBadgeVisible({ cancel_request: { status: "pending", reason: "yanlış" } })).toBe(true);
    expect(CANCEL_REQUEST_BADGE_LABEL).toBe("İptal talebi");
    expect(hasPendingCancelRequest({ cancel_request: { status: "rejected" } })).toBe(false);
    expect(cancelRequestBadgeVisible({ cancel_request: { status: "accepted" } })).toBe(false);
    expect(cancelRequestBadgeVisible({})).toBe(false);
    expect(cancelRequestReason({ cancel_request: { status: "pending", reason: "  yanlış  " } })).toBe("yanlış");
  });

  it("shows approve/reject buttons only when the request is pending", () => {
    expect(cancelRequestActionsVisible({ cancel_request: { status: "pending" } })).toBe(true);
    expect(cancelRequestActionsVisible({ cancel_request: { status: "rejected" } })).toBe(false);
    expect(cancelRequestActionsVisible(null)).toBe(false);
    expect(CANCEL_REQUEST_ACCEPT_CONFIRM).toContain("çöp kutusuna taşınacak");
  });
});
