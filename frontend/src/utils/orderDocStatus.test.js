import { describe, expect, it } from "vitest";
import {
  orderDocStatus,
  orderMatchesDocStatus,
  docStatusFilterActive,
  ORDER_DOC_STATUS_ALL,
} from "./orderDocStatus";

describe("orderDocStatus", () => {
  it("classifies draft / dispatched / invoiced / cancelled", () => {
    expect(orderDocStatus({ order_status: "pending" })).toBe("draft");
    expect(orderDocStatus({ dispatch_number: "IRS-1" })).toBe("dispatched");
    expect(orderDocStatus({ is_invoiced: true })).toBe("invoiced");
    expect(orderDocStatus({ is_invoiced: true, dispatch_number: "X" })).toBe("invoiced");
    expect(orderDocStatus({ order_status: "cancelled" })).toBe("cancelled");
  });

  it("filter inactive when all selected", () => {
    expect(docStatusFilterActive(ORDER_DOC_STATUS_ALL)).toBe(false);
    expect(docStatusFilterActive(["draft"])).toBe(true);
  });

  it("matches selected statuses", () => {
    const draft = { order_status: "pending" };
    expect(orderMatchesDocStatus(draft, ["draft"])).toBe(true);
    expect(orderMatchesDocStatus(draft, ["invoiced"])).toBe(false);
    expect(orderMatchesDocStatus(draft, ORDER_DOC_STATUS_ALL)).toBe(true);
  });
});
