export type MovesTask = {
  id?: string;
  title?: string;
  kind?: string;
  done?: boolean;
  due_date?: string | null;
  duration_days?: number | null;
  project_name?: string;
  project_number?: string;
  park_name?: string;
};

export function taskMovesPath(empId?: string | null, taskId?: string | null): string {
  if (!empId || !taskId) return "";
  return `/personnel/employees/${empId}/tasks/${taskId}`;
}

export function taskMoveCanMutate(task?: Pick<MovesTask, "id"> | null, canEdit = true): boolean {
  return Boolean(canEdit && task?.id);
}

export function taskMoveDeleteConfirm(task?: Pick<MovesTask, "title"> | null): { title: string; message: string } {
  const name = String(task?.title || "Görev").trim() || "Görev";
  return {
    title: "Görev silinsin mi?",
    message: `"${name}" çöp kutusuna taşınır. 30 gün içinde geri getirilebilir.`,
  };
}

export function taskMoveLine(task?: MovesTask | null): string {
  if (!task) return "";
  const kind = task.kind === "office" ? "İç görev" : "Dış görev";
  return `${kind} · ${task.done ? "Tamamlandı" : "Açık"}`;
}

export function taskMoveDetail(task?: MovesTask | null): string {
  if (!task) return "";
  return [task.project_number, task.project_name || task.park_name, task.due_date ? `son ${task.due_date}` : ""]
    .filter(Boolean)
    .join(" · ");
}

export function sortTaskMoves(tasks?: MovesTask[] | null): MovesTask[] {
  return [...(tasks || [])].sort((a, b) => {
    const ad = a?.done ? 1 : 0;
    const bd = b?.done ? 1 : 0;
    if (ad !== bd) return ad - bd;
    return String(a?.due_date || "9999").localeCompare(String(b?.due_date || "9999"));
  });
}

export function taskMovesHint(count: number): string {
  if (!count) return "Atanmış görev yok.";
  return `${count} atanmış görev`;
}
