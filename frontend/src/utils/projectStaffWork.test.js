import { PROJECT_STAFF_WORK_TITLE, projectStaffWork } from "./projectStaffWork";

describe("projectStaffWork", () => {
  it("groups assigned tasks and employee photos by person", () => {
    expect(PROJECT_STAFF_WORK_TITLE).toBe("Görevli işler");
    const staff = projectStaffWork(
      [
        { id: "t1", title: "Keşif", done: true, assignee_id: "e1", assignee_name: "Ali" },
        { id: "t2", title: "Montaj", assignee_id: "e1", assignee_name: "Ali" },
        { id: "t3", title: "Tesisat", assignee_name: "Ayşe" },
      ],
      [
        { url: "/api/files/a.jpg", task_id: "t1", source: "employee", uploaded_by: "e1", visibility: "pending" },
        { url: "/api/files/b.jpg", task_id: "t2", source: "employee", uploaded_by: "e1" },
        { url: "/api/files/mgr.jpg", source: "manager" },
      ],
    );
    expect(staff.map((p) => ({ name: p.name, label: p.label }))).toEqual([
      { name: "Ali", label: "1/2 görev · 2 foto" },
      { name: "Ayşe", label: "0/1 görev" },
    ]);
    expect(staff[0].tasks[0]).toMatchObject({ title: "Keşif", done: true, photos: [{ url: "/api/files/a.jpg" }] });
  });
});
