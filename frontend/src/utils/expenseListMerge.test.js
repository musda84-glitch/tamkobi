import { expenseMatchesList, mergeSavedExpense, savedExpenseCaughtUp } from "./expenseListMerge";

const filters = { q: "", category: "all", status: "all", from: "2026-10-01", to: "2026-10-31" };

test("saved row stays when the list has not caught up", () => {
  const saved = { id: "e1", description: "Kira", date: "2026-10-05", category: "Kira", payment_status: "unpaid", created_at: "2026-10-05T10:00:00" };
  const merged = mergeSavedExpense([{ id: "old", date: "2026-10-02", description: "Eski" }], saved, filters);
  expect(merged.map((row) => row.id)).toEqual(["e1", "old"]);
  expect(savedExpenseCaughtUp([{ id: "old" }], saved)).toBe(false);
});

test("server row replaces the pin once its stamp catches up", () => {
  const saved = { id: "e1", description: "Kira", date: "2026-10-05", created_at: "2026-10-05T10:00:00" };
  const server = [{ id: "e1", description: "Kira sunucu", date: "2026-10-05", created_at: "2026-10-05T10:00:00" }];
  expect(mergeSavedExpense(server, saved, filters)).toEqual(server);
  expect(savedExpenseCaughtUp(server, saved)).toBe(true);
});

test("older server stamp keeps the saved edit", () => {
  const saved = { id: "e1", description: "Yeni", date: "2026-10-05", updated_at: "2026-10-05T12:00:00", created_at: "2026-10-05T10:00:00" };
  const server = [{ id: "e1", description: "Eski", date: "2026-10-05", updated_at: "2026-10-05T09:00:00" }];
  expect(mergeSavedExpense(server, saved, filters)[0].description).toBe("Yeni");
});

test("row outside the date filter is not pinned", () => {
  const saved = { id: "e1", description: "Eski ay", date: "2026-09-01", created_at: "2026-09-01T10:00:00" };
  expect(expenseMatchesList(saved, filters)).toBe(false);
  expect(mergeSavedExpense([], saved, filters)).toEqual([]);
});

test("status category and query filters match the list endpoint", () => {
  const row = { id: "e1", description: "Ofis kirası", date: "2026-10-05", category: "Kira", payment_status: "unpaid", contact_name: "Şişli Ltd" };
  expect(expenseMatchesList(row, { ...filters, category: "Kira", status: "unpaid", q: "şişli" })).toBe(true);
  expect(expenseMatchesList(row, { ...filters, status: "paid" })).toBe(false);
  expect(expenseMatchesList(row, { ...filters, category: "Yakıt" })).toBe(false);
  expect(expenseMatchesList(row, { ...filters, q: "yok" })).toBe(false);
});
