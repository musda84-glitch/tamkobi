import { formatIssueStamp, nowIssueDateTime, showEfaturaStampNow } from "./invoiceIssueNow";

test("nowIssueDateTime uses local clock", () => {
  const now = new Date(2026, 9, 5, 16, 23, 7);
  expect(nowIssueDateTime(now)).toEqual({ issue_date: "2026-10-05", issue_time: "16:23:07" });
});

test("formatIssueStamp is TR display", () => {
  expect(formatIssueStamp("2026-10-02", "14:20:00")).toBe("02.10.2026 14:20");
  expect(formatIssueStamp("2026-10-02", "")).toBe("02.10.2026");
});

test("stamp-now only for single send", () => {
  expect(showEfaturaStampNow({ isBulk: false, isPrint: false, mode: "send" })).toBe(true);
  expect(showEfaturaStampNow({ isBulk: true, isPrint: false, mode: "send" })).toBe(false);
  expect(showEfaturaStampNow({ isBulk: false, isPrint: true, mode: "print" })).toBe(false);
});
