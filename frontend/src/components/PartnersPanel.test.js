import { filterPartnerTxs } from "./PartnersPanel";
import { partnerLedgerBreakdown } from "../utils/partnerTx";

test("filterPartnerTxs keeps all rows when no partner is selected", () => {
  const txs = [
    { id: "1", partner_id: "a", amount: 10 },
    { id: "2", partner_id: "b", amount: 20 },
  ];
  expect(filterPartnerTxs(txs, null)).toEqual(txs);
  expect(filterPartnerTxs(txs, "")).toEqual(txs);
  expect(filterPartnerTxs(null, null)).toEqual([]);
});

test("filterPartnerTxs returns only the selected partner ledger", () => {
  const txs = [
    { id: "1", partner_id: "ali", amount: 5000 },
    { id: "2", partner_id: "veli", amount: 100 },
    { id: "3", partner_id: "ali", amount: 2120 },
  ];
  expect(filterPartnerTxs(txs, "ali").map((t) => t.id)).toEqual(["1", "3"]);
  expect(filterPartnerTxs(txs, "missing")).toEqual([]);
});

test("selected partner ledger check flags mismatch for 688189.78 card", () => {
  const txs = filterPartnerTxs([
    { partner_id: "5a7cba2b", type: "capital_in", amount: 700000 },
    { partner_id: "other", type: "salary", amount: 999999 },
    { partner_id: "5a7cba2b", type: "withdrawal", amount: 11810.22 },
  ], "5a7cba2b");
  const br = partnerLedgerBreakdown(txs, 688189.78);
  expect(br.ledger).toBeCloseTo(688189.78, 2);
  expect(br.drift).toBe(false);
  expect(br.count).toBe(2);
});
