import { formatTrAmount } from "./money";
import {
  dayBeforeIso,
  defaultOpeningDate,
  earliestAccountTxDay,
  istanbulToday,
  openingEligible,
  openingPreview,
} from "./openingBalance";

test("açılış uygun hesaplar havuzu dışlar", () => {
  expect(openingEligible({ type: "pos" })).toBe(true);
  expect(openingEligible({ type: "bank" })).toBe(true);
  expect(openingEligible({ type: "cash_box" })).toBe(true);
  expect(openingEligible({ type: "okc_pos" })).toBe(true);
  expect(openingEligible({ type: "credit_card", card_owner: "company" })).toBe(true);
  expect(openingEligible({ type: "credit_card", is_customer_card_pool: true, card_owner: "customer" })).toBe(false);
  expect(openingEligible({ type: "wallet" })).toBe(false);
  expect(openingEligible(null)).toBe(false);
});

test("varsayılan tarih ilk hareketten bir gün öncedir", () => {
  const txs = [
    { account_id: "pos", date: "2026-11-02", amount: 1 },
    { account_id: "other", date: "2026-01-01", amount: 1 },
    { target_account_id: "pos", date: "2026-10-20T21:30:00Z", amount: 2 },
  ];
  expect(earliestAccountTxDay(txs, "pos")).toBe("2026-10-20");
  expect(defaultOpeningDate(txs, "pos", "2026-12-01")).toBe("2026-10-19");
  expect(dayBeforeIso("2026-03-01")).toBe("2026-02-28");
  expect(defaultOpeningDate([], "pos", "2026-10-16")).toBe("2026-10-16");
});

test("İstanbul günü UTC gece yarısını kaydırmaz", () => {
  expect(istanbulToday(new Date("2026-10-15T21:30:00Z"))).toBe("2026-10-16");
});

test("önizleme bakiyeyi işaretli tutarla yazar", () => {
  expect(openingPreview(-11523.58, 11523.58)).toBe(
    `Bakiye ${formatTrAmount(-11523.58)} → ${formatTrAmount(0)} olur, cari etkilenmez`,
  );
  expect(openingPreview(100, -40)).toBe(
    `Bakiye ${formatTrAmount(100)} → ${formatTrAmount(60)} olur, cari etkilenmez`,
  );
  expect(openingPreview(10, 0)).toBe("");
});
