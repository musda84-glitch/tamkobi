import {
  sortTaskMoves,
  taskMoveCanDelete,
  taskMoveCanEdit,
  taskMoveDeleteConfirm,
  taskMoveLine,
  taskMovesHint,
  taskMovesPath,
  taskMoveTitle,
} from "./employeeTaskMoves";

test("taskMovesPath and edit/delete flags", () => {
  expect(taskMovesPath("e1", "t1")).toBe("/personnel/employees/e1/tasks/t1");
  expect(taskMovesPath("", "t1")).toBe("");
  expect(taskMoveCanEdit({ id: "t1" }, true)).toBe(true);
  expect(taskMoveCanDelete({ id: "t1" }, false)).toBe(false);
});

test("labels and sort open first", () => {
  expect(taskMoveTitle({ title: "Montaj" })).toBe("Montaj");
  expect(taskMoveLine({ kind: "office", done: false })).toContain("İç görev");
  expect(taskMoveLine({ kind: "field", done: true })).toContain("Tamamlandı");
  expect(taskMovesHint(0)).toMatch(/yok/i);
  expect(taskMovesHint(2)).toBe("2 atanmış görev");
  const sorted = sortTaskMoves([
    { id: "a", title: "Z", done: true, due_date: "2026-01-01" },
    { id: "b", title: "A", done: false, due_date: "2026-12-01" },
    { id: "c", title: "B", done: false, due_date: "2026-02-01" },
  ]);
  expect(sorted.map((t) => t.id)).toEqual(["c", "b", "a"]);
  const ask = taskMoveDeleteConfirm({ title: "Montaj" });
  expect(ask.title).toMatch(/silinsin/i);
  expect(ask.message).toContain("Montaj");
});
