export const PROJECT_STAFF_WORK_TITLE = "Görevli işler";
export const PROJECT_STAFF_WORK_EMPTY = "Bu projede görevli iş yok.";

function taskDone(task) {
  if (!task) return false;
  if (task.done) return true;
  const s = String(task.status || "").toLocaleLowerCase("tr-TR");
  return s === "done" || s === "completed" || s === "tamamlandı" || s === "tamamlandi";
}

function normalizeTasks(tasks) {
  return (tasks || [])
    .map((t, i) => ({
      id: t.id || `t_${i}`,
      title: String(t.title || t.name || "").trim(),
      done: taskDone(t),
      assignee_id: t.assignee_id || "",
      assignee_name: t.assignee_name || "",
      due_date: t.due_date || null,
    }))
    .filter((t) => t.title);
}

function staffWorkPhoto(row) {
  const visibility = String(row.visibility || "").trim()
    || (row.customer_visible === true ? "show" : row.customer_visible === false ? "pending" : "");
  return {
    url: String(row.url || ""),
    visibility,
    visibility_label: String(row.visibility_label || "").trim() || undefined,
  };
}

function staffWorkLabel(done, total, photos) {
  const parts = [`${done}/${total} görev`];
  if (photos) parts.push(`${photos} foto`);
  return parts.join(" · ");
}

/** Görevli personel + yükledikleri iş fotoğrafları. */
export function projectStaffWork(tasks, photos) {
  const rows = normalizeTasks(tasks);
  const pics = (photos || []).filter((p) => String(p.url || "").startsWith("/api/files/"));
  const groups = new Map();

  const person = (employeeId, name) => {
    const key = employeeId || name || "unassigned";
    const existing = groups.get(key);
    if (existing) return existing;
    const next = {
      key,
      name: name || (employeeId ? "Personel" : "Atanmamış"),
      employeeId,
      done: 0,
      total: 0,
      photoCount: 0,
      label: "",
      tasks: [],
    };
    groups.set(key, next);
    return next;
  };

  const photosFor = (taskId) => pics
    .filter((p) => String(p.task_id || "").trim() === taskId)
    .map(staffWorkPhoto);

  for (const t of rows) {
    const row = person(String(t.assignee_id || "").trim(), String(t.assignee_name || "").trim());
    const taskPhotos = photosFor(String(t.id || "").trim());
    row.tasks.push({
      id: String(t.id || ""),
      title: t.title || "Görev",
      done: !!t.done,
      due_date: t.due_date || null,
      photos: taskPhotos,
    });
    row.total += 1;
    if (t.done) row.done += 1;
    row.photoCount += taskPhotos.length;
  }

  const knownTasks = new Set(rows.map((t) => String(t.id || "").trim()).filter(Boolean));
  for (const p of pics) {
    if (String(p.source || "") !== "employee") continue;
    const tid = String(p.task_id || "").trim();
    if (tid && knownTasks.has(tid)) continue;
    const uploader = String(p.uploaded_by || "").trim();
    const row = [...groups.values()].find((g) => g.employeeId && g.employeeId === uploader)
      || person(uploader, "Görevli");
    let extra = row.tasks.find((t) => t.id === "__photos__");
    if (!extra) {
      extra = { id: "__photos__", title: "İş fotoğrafları", done: false, photos: [] };
      row.tasks.push(extra);
      row.total += 1;
    }
    extra.photos.push(staffWorkPhoto(p));
    row.photoCount += 1;
  }

  return [...groups.values()].map((row) => ({
    ...row,
    label: staffWorkLabel(row.done, row.total, row.photoCount),
  }));
}
