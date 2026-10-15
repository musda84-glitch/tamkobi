import {
  CANCEL_REQUEST_ACCEPT_CONFIRM,
  CANCEL_REQUEST_BADGE_LABEL,
  hasPendingCancelRequest,
  cancelRequestReason,
  cancelRequestBadgeTitle,
  pendingCancelRequestOrders,
  resolveCancelRequestError,
  resolveCancelRequestsBulk,
} from "./orderCancelRequest";

test("pending badge and tooltip use reason when present", () => {
  expect(hasPendingCancelRequest({ cancel_request: { status: "pending", reason: "yanlış" } })).toBe(true);
  expect(hasPendingCancelRequest({ cancel_request: { status: "rejected" } })).toBe(false);
  expect(hasPendingCancelRequest({})).toBe(false);
  expect(cancelRequestReason({ cancel_request: { reason: "  yanlış sipariş  " } })).toBe("yanlış sipariş");
  expect(cancelRequestBadgeTitle({ cancel_request: { status: "pending", reason: "yanlış" } })).toBe("İptal talebi: yanlış");
  expect(CANCEL_REQUEST_BADGE_LABEL).toBe("İptal talebi");
  expect(CANCEL_REQUEST_ACCEPT_CONFIRM).toContain("çöp kutusuna taşınacak");
});

test("pending filter keeps only cancel_request=pending rows", () => {
  const rows = [
    { id: "1", cancel_request: { status: "pending" } },
    { id: "2", cancel_request: { status: "rejected" } },
    { id: "3" },
  ];
  expect(pendingCancelRequestOrders(rows).map((o) => o.id)).toEqual(["1"]);
});

test("409/400/403 detail is kept for toasts", () => {
  expect(resolveCancelRequestError({ response: { status: 409, data: { detail: "Fatura faturalaştırılmış veya e-belge kesilmiş; önce Faturalar'dan faturayı İptal Et, sonra talebi onaylayın." } } }))
    .toBe("Fatura faturalaştırılmış veya e-belge kesilmiş; önce Faturalar'dan faturayı İptal Et, sonra talebi onaylayın.");
  expect(resolveCancelRequestError({ response: { status: 403, data: { detail: "Bu işlem için yetkiniz yok." } } })).toBe("Bu işlem için yetkiniz yok.");
  expect(resolveCancelRequestError({ response: { status: 400, data: { detail: "Bekleyen iptal talebi yok." } } })).toBe("Bekleyen iptal talebi yok.");
});

test("bulk resolve posts per pending row and records BulkResultModal outcomes", async () => {
  const axiosClient = {
    post: jest.fn()
      .mockResolvedValueOnce({ data: { status: "success" } })
      .mockRejectedValueOnce({ response: { status: 409, data: { detail: "Talep zaten işleniyor/işlendi" } } }),
  };
  const rows = [
    { id: "a", order_number: "B2B-1", cancel_request: { status: "pending" } },
    { id: "b", order_number: "B2B-2", cancel_request: { status: "rejected" } },
    { id: "c", order_number: "B2B-3", cancel_request: { status: "pending" } },
  ];
  const items = await resolveCancelRequestsBulk(axiosClient, "/api", rows, "accept");
  expect(axiosClient.post).toHaveBeenCalledTimes(2);
  expect(items).toEqual([
    { id: "a", label: "B2B-1", outcome: "ok" },
    { id: "b", label: "B2B-2", outcome: "skipped", reason: "Bekleyen iptal talebi yok." },
    { id: "c", label: "B2B-3", outcome: "error", reason: "Talep zaten işleniyor/işlendi" },
  ]);
});
