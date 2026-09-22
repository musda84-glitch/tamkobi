import {
  dueDateFromDays,
  isClosedProject,
  isFieldTask,
  nextTasksAfterAssign,
  normalizeTaskKind,
  parseTaskDays,
  taskKindLabel,
  validateEmployeeTaskAssign,
} from "./employeeTaskAssign";

describe("employee task assign", () => {
  it("assigns an existing task or appends a new one", () => {
    const tasks = [{ id: "t1", title: "Montaj", done: false }];
    const assigned = nextTasksAfterAssign(tasks, { id: "e1", full_name: "Ali" }, { taskId: "t1" });
    expect(assigned.error).toBeNull();
    expect(assigned.tasks[0]).toMatchObject({ assignee_id: "e1", assignee_name: "Ali", kind: "field" });
    expect(nextTasksAfterAssign(tasks, { id: "e1" }, { taskId: "missing" }).error).toBe("Görev bulunamadı.");

    const created = nextTasksAfterAssign(tasks, { id: "e1", full_name: "Ali" }, { title: "Keşif", newId: "t_new" });
    expect(created.tasks).toHaveLength(2);
    expect(created.tasks[1]).toMatchObject({ id: "t_new", title: "Keşif", assignee_id: "e1", done: false, kind: "field" });
    const withDays = nextTasksAfterAssign(tasks, { id: "e1", full_name: "Ali" }, { title: "Saha", newId: "t_d", durationDays: 4, dueDate: "2026-09-25" });
    expect(withDays.tasks[1]).toMatchObject({ duration_days: 4, due_date: "2026-09-25", kind: "field" });
    const office = nextTasksAfterAssign(tasks, { id: "e1", full_name: "Ali" }, { title: "Ofis", newId: "t_o", kind: "office", durationDays: 3 });
    expect(office.tasks[1]).toMatchObject({ kind: "office", title: "Ofis" });
    expect(office.tasks[1].duration_days).toBeFalsy();
    expect(normalizeTaskKind("iç")).toBe("office");
    expect(isFieldTask({ kind: "office" })).toBe(false);
    expect(taskKindLabel("office")).toBe("İç görev");
    expect(parseTaskDays("3")).toBe(3);
    expect(dueDateFromDays("2026-09-22", 3)).toBe("2026-09-24");
    expect(isClosedProject({ status: "completed" })).toBe(true);
  });

  it("requires a project and a task or title", () => {
    expect(validateEmployeeTaskAssign("", "", "")).toBe("Proje seçin.");
    expect(validateEmployeeTaskAssign("p1", "", "")).toBe("Yapacağı işi seçin veya yeni iş adı yazın.");
    expect(validateEmployeeTaskAssign("p1", "t1", "")).toBeNull();
  });
});
