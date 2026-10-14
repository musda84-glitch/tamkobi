import { MISSING_RECORD, notificationTarget } from "./notificationTarget";

test("stored target wins", () => {
  const target = notificationTarget({
    type: "order_new",
    link: "/orders",
    target: { type: "order", id: "o1", route: "/orders?open=o1" },
  });
  expect(target).toEqual({ type: "order", id: "o1", route: "/orders?open=o1" });
});

test("legacy bank text guesses the account and pending match", () => {
  const target = notificationTarget({
    type: "bank_sync",
    title: "2 yeni banka hareketi",
    message: "Vadesiz TL Hesabı: 2 yeni hareket (1 eşleşme bekliyor).",
    link: "/banking?tab=match",
    ref_type: "bank",
    ref_id: "acc-44",
  });
  expect(target.type).toBe("bank_account");
  expect(target.id).toBe("acc-44");
  expect(target.route).toContain("pending=1");
  expect(target.route).toContain("account_id=acc-44");
});

test("legacy einvoice text keeps the ETTN", () => {
  const target = notificationTarget({
    type: "einvoice_incoming",
    message: "250,00 ₺ · ETTN abcdef12-3456",
    link: "/edoc-inbox",
    ref_type: "edoc",
  });
  expect(target.type).toBe("edoc");
  expect(target.route.startsWith("/edoc-inbox?")).toBe(true);
  expect(decodeURIComponent(target.route)).toContain("ettn=abcdef12-3456");
});

test("order, invoice, cari, payment and task detail routes", () => {
  expect(notificationTarget({ ref_type: "order", ref_id: "ord-1", link: "/orders" }).route).toBe("/orders?open=ord-1");
  expect(notificationTarget({ type: "receivable_overdue", ref_type: "invoice", ref_id: "inv-9" }).route).toBe("/invoices?open=inv-9");
  expect(notificationTarget({ ref_type: "contact", ref_id: "car-1" }).route).toBe("/contacts?contact_id=car-1");
  expect(notificationTarget({ ref_type: "payment", ref_id: "pay-3" }).route).toBe("/expenses?open=pay-3");
  const task = notificationTarget({ type: "task_assigned", ref_type: "task", ref_id: "task-7", project_id: "proj-2" });
  expect(task.route).toContain("tab=gorevler");
  expect(task.route).toContain("task=task-7");
  expect(task.route).toContain("project=proj-2");
});

test("missing record copy", () => {
  expect(MISSING_RECORD).toBe("Kayıt bulunamadı");
});
