import { canMergeOutgoingDispatches, outgoingMergeIds } from "./dispatchMerge";

const rows = [
  { id: "d1", invoice_type: "dispatch", e_type: "e_dispatch" },
  { id: "d2", invoice_type: "dispatch" },
  { id: "in1", invoice_type: "dispatch", source: "edoc_inbox", direction: "incoming" },
  { id: "sf", invoice_type: "sales" },
];

describe("outgoingMergeIds", () => {
  it("keeps visible order and skips incoming invoices", () => {
    expect(outgoingMergeIds(rows, ["d2", "in1", "sf", "d1"])).toEqual(["d1", "d2"]);
  });

  it("needs two outgoing dispatches", () => {
    expect(canMergeOutgoingDispatches(outgoingMergeIds(rows, ["d1"]))).toBe(false);
    expect(canMergeOutgoingDispatches(outgoingMergeIds(rows, ["d1", "d2"]))).toBe(true);
    expect(canMergeOutgoingDispatches(outgoingMergeIds(rows, ["in1", "sf"]))).toBe(false);
  });
});