import {
  focusJob,
  normalizeScrapReasons,
  partialForecast,
  personnelCode,
  shopfloorInitials,
  shopfloorMayOperate,
  takeoverDetail,
  takeoverTitle,
  undoCountdown,
} from "./shopFloorScreen";

test("görüntüleme yetkisi iş başlatamaz, yönetici ve haritasız kullanıcı başlatır", () => {
  expect(shopfloorMayOperate(null)).toBe(false);
  expect(shopfloorMayOperate({ role: "admin" })).toBe(true);
  expect(shopfloorMayOperate({ role: "production" })).toBe(true);
  expect(shopfloorMayOperate({ role: "user", permissions: { "/atolye": "view" } })).toBe(false);
  expect(shopfloorMayOperate({ role: "user", permissions: { "/atolye": "edit" } })).toBe(true);
  expect(shopfloorMayOperate({ role: "user", permissions: { "/stok": "view" } })).toBe(true);
});

test("ara sayım planı aşınca işaretler, geri alma süresini m:ss yazar", () => {
  expect(partialForecast(4, 2, 10)).toEqual({ next: 6, left: 4, over: false });
  expect(partialForecast(8, 3, 10).over).toBe(true);
  const start = new Date("2026-10-22T10:00:00.000Z");
  expect(undoCountdown(start.toISOString(), 5, new Date(start.getTime() + 4 * 60000 + 1000))).toBe("0:59");
  expect(undoCountdown(start.toISOString(), 5, new Date(start.getTime() + 5 * 60000))).toBeNull();
});

test("devralma yalnız 409 takeover_confirm_required cevabını açar", () => {
  const detail = { code: "takeover_confirm_required", previous_operator: "Ayşe Usta" };
  expect(takeoverDetail({ response: { status: 409, data: { detail } } })).toEqual(detail);
  expect(takeoverDetail({ response: { status: 400, data: { detail } } })).toBeNull();
  expect(takeoverTitle(detail)).toBe("Bu iş Ayşe Usta tarafından başlatıldı, devralınsın mı?");
});

test("sıradaki iş önce kendi çalışan işine, yoksa hazır işe bakar", () => {
  const ready = { id: "r", status: "ready" };
  const mine = { id: "m", status: "in_progress", operator_name: "Ali" };
  const other = { id: "o", status: "in_progress", operator_name: "Veli" };
  expect(focusJob([ready], "Ali")).toEqual({ mode: "next", job: ready });
  expect(focusJob([ready, other, mine], "Ali").job).toBe(mine);
  expect(focusJob([other], "Ali").mode).toBe("running");
  expect(focusJob([], "Ali")).toBeNull();
});

test("personel kodu yoksa boş, fire nedenleri varsayılana düşer", () => {
  expect(personnelCode({ name: "Ali" })).toBe("");
  expect(personnelCode({ personnel_no: "P-0007" })).toBe("P-0007");
  expect(shopfloorInitials("Ayşe Usta")).toBe("AU");
  const reasons = normalizeScrapReasons([]);
  expect(reasons.map((row) => row.code)).toEqual(["cut_error", "material", "machine", "other"]);
  expect(normalizeScrapReasons([{ code: "x", label: "X", active: false }])[0].code).toBe("cut_error");
});
