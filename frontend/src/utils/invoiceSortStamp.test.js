import { invoiceActivityStamp, compareInvoiceActivity } from "./invoiceSortStamp";

test("invoiceActivityStamp prefers latest activity and includes issue time", () => {
  expect(invoiceActivityStamp({
    issue_date: "2026-10-01",
    issue_time: "09:30:00",
    created_at: "2026-09-01T10:00:00",
  })).toBe("2026-10-01T09:30:00");

  expect(invoiceActivityStamp({
    issue_date: "2026-09-01",
    issue_time: "08:00:00",
    created_at: "2026-10-01T12:00:00.000Z",
  })).toBe("2026-10-01T12:00:00.000Z");

  expect(invoiceActivityStamp({
    issue_date: "2026-10-01",
    issue_time: "14:05",
  })).toBe("2026-10-01T14:05:00");
});

test("compareInvoiceActivity sorts newest first by default", () => {
  const a = { issue_date: "2026-10-01", issue_time: "10:00:00" };
  const b = { issue_date: "2026-10-01", issue_time: "18:00:00" };
  expect(compareInvoiceActivity(a, b, "desc")).toBeGreaterThan(0);
  expect(compareInvoiceActivity(a, b, "asc")).toBeLessThan(0);
});
