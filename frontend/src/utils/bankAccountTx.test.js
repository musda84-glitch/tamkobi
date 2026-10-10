import { filterAccountTransactions, matchesAccount, sortBankTransactions } from "./bankAccountTx";

test("matchesAccount includes account, target and customer card pool", () => {
  expect(matchesAccount({ account_id: "a1" }, "a1")).toBe(true);
  expect(matchesAccount({ account_id: "x", target_account_id: "a1" }, "a1")).toBe(true);
  expect(matchesAccount({ customer_card_account_id: "a1" }, "a1")).toBe(true);
  expect(matchesAccount({ account_id: "x" }, "a1")).toBe(false);
});

test("sortBankTransactions newest date first", () => {
  const sorted = sortBankTransactions([
    { id: "1", date: "2026-09-01" },
    { id: "2", date: "2026-10-03" },
    { id: "3", date: "2026-10-02", created_at: "2026-10-02T12:00:00Z" },
    { id: "4", date: "2026-10-02", created_at: "2026-10-02T18:00:00Z" },
  ]);
  expect(sorted.map((t) => t.id)).toEqual(["2", "4", "3", "1"]);
});

test("filterAccountTransactions keeps matched bank_sync rows", () => {
  const txs = [
    { id: "m1", account_id: "kuveyt", date: "2026-10-02", source: "bank_sync", match_status: "matched", contact_name: "Mustafa Bal" },
    { id: "u1", account_id: "kuveyt", date: "2026-10-03", source: "bank_sync", match_status: "unmatched" },
    { id: "o1", account_id: "other", date: "2026-10-03", source: "bank_sync", match_status: "matched" },
    { id: "v1", account_id: "kasa", date: "2026-10-02", source: "bank_match", related_bank_tx_id: "m1" },
  ];
  const visible = filterAccountTransactions(txs, { accountId: "kuveyt" });
  expect(visible.map((t) => t.id)).toEqual(["u1", "m1"]);
  expect(visible.find((t) => t.id === "m1").match_status).toBe("matched");
});

test("filterAccountTransactions keeps matched when filtering by group", () => {
  const txs = [
    { id: "m1", account_id: "b1", date: "2026-10-01", match_status: "matched", source: "bank_sync" },
    { id: "u1", account_id: "b2", date: "2026-10-02", match_status: "unmatched", source: "bank_sync" },
    { id: "x1", account_id: "cash", date: "2026-10-03", match_status: "unmatched", source: "manual" },
  ];
  const visible = filterAccountTransactions(txs, { groupIds: ["b1", "b2"] });
  expect(visible.map((t) => t.id)).toEqual(["u1", "m1"]);
});

test("matched via target_account_id still appears on that account", () => {
  const txs = [
    {
      id: "m1",
      account_id: "kuveyt",
      target_account_id: "kasa1",
      date: "2026-10-02",
      source: "bank_sync",
      match_status: "matched",
    },
  ];
  expect(filterAccountTransactions(txs, { accountId: "kasa1" }).map((t) => t.id)).toEqual(["m1"]);
  expect(filterAccountTransactions(txs, { accountId: "kuveyt" }).map((t) => t.id)).toEqual(["m1"]);
});
