import { dutyKindLabel, dutySubtitle } from "./assignedDuty";

export function taskMovesPath(empId, taskId) {
  if (!empId || !taskId) return "";
  return `/personnel/employees/${empId}/tasks/${taskId}`;
}

export function taskMoveCanEdit(task, canEdit = true) {
  return Boolean(canEdit && task?.id);
}

export function taskMoveCanDelete(task, canEdit = true) {
  return Boolean(canEdit && task?.id);
}

export function taskMoveDeleteConfirm(task) {
  const title = String(task?.title || "Görev").trim() || "Görev";
  return {
    title: "Görev silinsin mi?",
    message: `"${title}" çöp kutusuna taşınır. 30 gün içinde geri getirilebilir.`,
  };
}

export function taskMoveLine(task) {
  if (!task) return "";
  const kind = dutyKindLabel(task) || (task.kind === "office" ? "İç görev" : "Dış görev");
  const status = task.done ? "Tamamlandı" : "Açık";
  return `${kind} · ${status}`;
}

export function taskMoveTitle(task) {
  return String(task?.title || "Görev").trim() || "Görev";
}

export function taskMoveDetail(task) {
  return dutySubtitle(task) || "";
}

export function sortTaskMoves(tasks) {
  return [...(tasks || [])].sort((a, b) => {
    const ad = a?.done ? 1 : 0;
    const bd = b?.done ? 1 : 0;
    if (ad !== bd) return ad - bd;
    const aa = String(a?.due_date || "9999");
    const bb = String(b?.due_date || "9999");
    if (aa !== bb) return aa.localeCompare(bb);
    return String(a?.title || "").localeCompare(String(b?.title || ""), "tr");
  });
}

export function taskMovesHint(count) {
  if (!count) return "Atanmış görev yok.";
  return `${count} atanmış görev`;
}
