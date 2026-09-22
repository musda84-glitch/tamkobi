export function empIdOf(emp) {
  return emp?.id || emp?._id || "";
}

export function normalizeTaskKind(raw) {
  const s = String(raw || "").toLocaleLowerCase("tr-TR").replace(/ı/g, "i").replace(/ç/g, "c").replace(/ş/g, "s");
  if (s === "office" || s === "ic" || s === "internal" || s === "iceride") return "office";
  return "field";
}

export function isFieldTask(task) {
  return normalizeTaskKind(task?.kind || task?.task_kind) === "field";
}

export function taskKindLabel(kind) {
  return normalizeTaskKind(kind) === "office" ? "İç görev" : "Dış görev";
}

export function isClosedProject(p) {
  const s = String(p?.status || "").toLocaleLowerCase("tr-TR");
  return s === "completed" || s === "tamamlandı" || s === "tamamlandi" || s === "done";
}

export function parseTaskDays(raw) {
  const n = Math.trunc(Number(String(raw || "").trim().replace(",", ".")));
  if (!Number.isFinite(n) || n < 1 || n > 366) return null;
  return n;
}

export function dueDateFromDays(start, days) {
  const parts = String(start || "").slice(0, 10).split("-").map(Number);
  if (parts.length !== 3 || parts.some((x) => !Number.isFinite(x))) return String(start || "").slice(0, 10);
  const d = new Date(parts[0], parts[1] - 1, parts[2]);
  d.setDate(d.getDate() + Math.max(1, Math.trunc(days)) - 1);
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}

export function nextTasksAfterAssign(tasks, employee, { taskId, title, newId, durationDays, dueDate, kind } = {}) {
  const empId = empIdOf(employee);
  const empName = employee?.full_name || "Personel";
  const existing = (tasks || []).map((t, i) => ({
    id: t.id || `t_${i}`,
    title: (t.title || t.name || "").trim(),
    done: !!(t.done || ["done", "completed", "tamamlandı", "tamamlandi"].includes(String(t.status || "").toLocaleLowerCase("tr-TR"))),
    assignee_id: t.assignee_id || null,
    assignee_name: t.assignee_name || null,
    due_date: t.due_date || null,
    duration_days: t.duration_days || null,
    kind: normalizeTaskKind(t.kind || t.task_kind),
  })).filter((t) => t.title);
  const stamp = (t) => {
    const nextKind = normalizeTaskKind(kind || t.kind);
    const next = { ...t, assignee_id: empId, assignee_name: empName, kind: nextKind };
    if (nextKind === "office") {
      next.duration_days = null;
      return next;
    }
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
  if (!taskId && !(title || "").trim()) return "Yapacağı işi seçin veya yeni iş adı yazın.";
  return null;
}
