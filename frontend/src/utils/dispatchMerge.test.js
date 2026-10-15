import { selectedOutgoingDispatchIds } from "./dispatchMerge";

const rows = [
  { id: "d1", invoice_number: "IRS-1", invoice_type: "dispatch", e_type: "e_dispatch" },
  { id: "d2", invoice_number: "IRS-2", invoice_type: "dispatch", status: "draft" },
  { id: "in1", invoice_number: "IRS-IN", invoice_type: "dispatch", source: "edoc_inbox", direction: "incoming" },
  { id: "sf1", invoice_number: "SF-1", invoice_type: "sales" },
];

test("seçili giden irsaliyeleri liste sırasıyla döner", () => {
  expect(selectedOutgoingDispatchIds(rows, ["d2", "in1", "sf1", "d1"])).toEqual(["d1", "d2"]);
});

test("iki giden irsaliye yoksa birleştirme listesi kısa kalır", () => {
  expect(selectedOutgoingDispatchIds(rows, ["d1"])).toEqual(["d1"]);
  expect(selectedOutgoingDispatchIds(rows, ["in1"])).toEqual([]);
});
