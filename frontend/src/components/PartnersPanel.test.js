import { filterPartnerTxs } from "./PartnersPanel";

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
