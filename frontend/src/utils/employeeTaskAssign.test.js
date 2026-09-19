import { nextTasksAfterAssign, validateEmployeeTaskAssign } from "./employeeTaskAssign";

describe("employee task assign", () => {
  it("assigns an existing task or appends a new one", () => {
    const tasks = [{ id: "t1", title: "Montaj", done: false }];
    const assigned = nextTasksAfterAssign(tasks, { id: "e1", full_name: "Ali" }, { taskId: "t1" });
    expect(assigned.error).toBeNull();
    expect(assigned.tasks[0]).toMatchObject({ assignee_id: "e1", assignee_name: "Ali" });
    expect(nextTasksAfterAssign(tasks, { id: "e1" }, { taskId: "missing" }).error).toBe("Görev bulunamadı.");

    const created = nextTasksAfterAssign(tasks, { id: "e1", full_name: "Ali" }, { title: "Keşif", newId: "t_new" });
    expect(created.tasks).toHaveLength(2);
    expect(created.tasks[1]).toMatchObject({ id: "t_new", title: "Keşif", assignee_id: "e1", done: false });
  });

  it("requires a project and a task or title", () => {
    expect(validateEmployeeTaskAssign("", "", "")).toBe("Proje seçin.");
    expect(validateEmployeeTaskAssign("p1", "", "")).toBe("Görev seçin veya yeni görev adı girin.");
    expect(validateEmployeeTaskAssign("p1", "t1", "")).toBeNull();
  });
});
