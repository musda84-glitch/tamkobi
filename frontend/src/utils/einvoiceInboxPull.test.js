import { EINVOICE_INBOX_BACKFILL_DAYS, einvoiceInboxSyncParams } from "./einvoiceInboxPull";

test("default backfill is 30 days and never auto-processes", () => {
  expect(EINVOICE_INBOX_BACKFILL_DAYS).toBe(30);
  expect(einvoiceInboxSyncParams("c1")).toEqual({
    company_id: "c1",
    days: 30,
    auto_process: false,
  });
});

test("clamps days to 1–90", () => {
  expect(einvoiceInboxSyncParams("c1", { days: 0 }).days).toBe(1);
  expect(einvoiceInboxSyncParams("c1", { days: 120 }).days).toBe(90);
  expect(einvoiceInboxSyncParams("c1", { days: 14 }).days).toBe(14);
});
