import {
  BACKOFF_MS,
  clampOfflineMinutes,
  criticalBlock,
  onlineOnlyBlock,
  remainingMs,
  setOnlineForTests,
} from "./policy";

afterEach(() => setOnlineForTests(null));

test("varsayılan çevrimdışı süre 10 dakikadır", () => {
  expect(clampOfflineMinutes(undefined)).toBe(10);
  expect(clampOfflineMinutes("nope")).toBe(10);
  expect(clampOfflineMinutes(25)).toBe(25);
  expect(remainingMs({ maxMinutes: 10, now: 0 })).toBe(10 * 60 * 1000);
});

test("süre dolunca kritik işlem durur, süre varken durmaz", () => {
  const start = 1_000_000;
  expect(criticalBlock({
    online: false, critical: true, offlineSince: start, maxMinutes: 10, now: start + 60_000,
  })).toBeNull();
  const blocked = criticalBlock({
    online: false, critical: true, offlineSince: start, maxMinutes: 10, now: start + 10 * 60 * 1000,
  });
  expect(blocked.code).toBe("OFFLINE_EXPIRED");
  expect(criticalBlock({
    online: true, critical: true, offlineSince: start, maxMinutes: 10, now: start + 99999999,
  })).toBeNull();
});

test("e-fatura, ödeme, banka ve AI çevrimdışıyken kapalıdır", () => {
  setOnlineForTests(false);
  expect(onlineOnlyBlock("/api/einvoice/send").message).toMatch(/e-Fatura/);
  expect(onlineOnlyBlock("/api/vpos/charge").message).toMatch(/sanal POS/);
  expect(onlineOnlyBlock("/api/banking/transactions").message).toMatch(/banka/);
  expect(onlineOnlyBlock("/api/ai/cart-extract").message).toMatch(/AI/);
  expect(onlineOnlyBlock("/api/pos/checkout")).toBeNull();
  expect(onlineOnlyBlock("/api/orders")).toBeNull();
  expect(onlineOnlyBlock("/api/order-picks/1/scan")).toBeNull();
  setOnlineForTests(true);
  expect(onlineOnlyBlock("/api/einvoice/send")).toBeNull();
  expect(onlineOnlyBlock("/api/isnet/outbox")).toBeNull();
});

test("yeniden deneme aralıkları 1-2-4-8 saniyedir", () => {
  expect(BACKOFF_MS).toEqual([1000, 2000, 4000, 8000]);
});
