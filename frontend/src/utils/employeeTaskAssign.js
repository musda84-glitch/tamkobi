export function empIdOf(emp) {
  return emp?.id || emp?._id || "";
}

export function nextTasksAfterAssign(tasks, employee, { taskId, title, newId, durationDays, dueDate } = {}) {
  const empId = empIdOf(employee);
  const empName = employee?.full_name || "Personel";
  const existing = (tasks || []).map((t, i) => ({
    id: t.id || `t_${i}`,
    title: (t.title || t.name || "").trim(),
    done: !!(t.done || t.status === "done" || t.status === "completed"),
    assignee_id: t.assignee_id || null,
    assignee_name: t.assignee_name || null,
    due_date: t.due_date || null,
    duration_days: t.duration_days || null,
  })).filter((t) => t.title);
  const stamp = (t) => {
    const next = { ...t, assignee_id: empId, assignee_name: empName };
    if (durationDays) next.duration_days = durationDays;
    if (dueDate) next.due_date = dueDate;
    return next;
  };

  if (taskId) {
    const idx = existing.findIndex((t) => t.id === taskId);
    if (idx < 0) return { error: "Görev bulunamadı." };
    return {
      tasks: existing.map((t, i) => (i === idx ? stamp(t) : t)),
      error: null,
    };
  }
  const name = (title || "").trim();
  if (!name) return { error: "Görev adı girin." };
  return {
    tasks: [...existing, stamp({
      id: newId || `t_${Date.now()}`,
      title: name,
      done: false,
    })],
    error: null,
  };
}

export function validateEmployeeTaskAssign(projectId, taskId, title) {
  if (!projectId) return "Proje seçin.";
  if (!taskId && !(title || "").trim()) return "Görev seçin veya yeni görev adı girin.";
  return null;
}
