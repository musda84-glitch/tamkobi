import React, { useCallback, useEffect, useState } from "react";
import axios from "axios";
import { toast } from "sonner";
import { CheckCircle2, Circle, ClipboardList, Loader2, X } from "lucide-react";
import { API_URL } from "../context/AuthContext";
import { useEscape } from "../utils/useEscape";
import {
  dueDateFromDays,
  empIdOf,
  isClosedProject,
  nextTasksAfterAssign,
  parseTaskDays,
  validateEmployeeTaskAssign,
} from "../utils/employeeTaskAssign";
import { findWorkPark, normalizeWorkParks, officeTaskPayload, validateOfficeTaskAssign } from "../utils/workParks";

const inputCls = "w-full bg-slate-50 border border-slate-200 rounded-lg p-2 text-xs";

/** Personel kartından iç / dış görev ata */
export function EmployeeAssignTaskModal({ employee, companyId, onClose, onSaved }) {
  useEscape(onClose);
  const empId = empIdOf(employee);
  const [projects, setProjects] = useState([]);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [kind, setKind] = useState("field");
  const [form, setForm] = useState({ project_id: "", task_id: "", title: "", due_date: "", duration_days: "", park_id: "" });
  const [parks, setParks] = useState([]);
  const [showCompleted, setShowCompleted] = useState(false);

  const load = useCallback(async () => {
    if (!companyId) return;
    setLoading(true);
    try {
      const [r, pr] = await Promise.all([
        axios.get(`${API_URL}/projects`, { params: { company_id: companyId, light: 1 } }),
        axios.get(`${API_URL}/companies/${companyId}/work-parks`).catch(() => ({ data: { parks: [] } })),
      ]);
      const rows = r.data || [];
      setProjects(rows);
      const list = normalizeWorkParks(pr.data?.parks);
      setParks(list);
      setForm((s) => {
        const next = { ...s };
        if (!s.project_id) {
          const first = rows.find((p) => !isClosedProject(p)) || rows[0];
          next.project_id = first ? (first.id || first._id) : "";
        }
        if (!s.park_id && list[0]) next.park_id = list[0].id;
        return next;
      });
    } catch {
      toast.error("Projeler yüklenemedi.");
    } finally {
      setLoading(false);
    }
  }, [companyId]);

  useEffect(() => { load(); }, [load]);

  const myTasks = projects.flatMap((p) =>
    (p.tasks || [])
      .filter((t) => String(t.assignee_id || "") === empId)
      .map((t) => ({
        ...t,
        project_name: p.name,
        project_number: p.project_number,
      })),
  );
  const openTasks = myTasks.filter((t) => !(t.done || t.status === "done" || t.status === "completed"));
  const closed = projects.filter((p) => isClosedProject(p));
  const assignable = projects.filter((p) => !isClosedProject(p));
  const projectOptions = showCompleted ? [...assignable, ...closed] : assignable;
  const selected = projects.find((p) => (p.id || p._id) === form.project_id);
  const selectedHasLoc = selected && selected.latitude != null && selected.longitude != null;
  const projectTasks = (selected?.tasks || []).map((t, i) => ({
    id: t.id || `t_${i}`,
    title: t.title || t.name || "",
    done: !!(t.done || t.status === "done" || t.status === "completed"),
    assignee_name: t.assignee_name || "",
  })).filter((t) => t.title && !t.done);
  const days = kind === "field" ? parseTaskDays(form.duration_days) : null;

  const pickProject = async (projectId) => {
    setForm((s) => ({ ...s, project_id: projectId, task_id: "", title: "" }));
    if (!projectId) return;
    try {
      const r = await axios.get(`${API_URL}/projects/${projectId}`);
      if (r.data) {
        setProjects((prev) => prev.map((p) => ((p.id || p._id) === projectId ? { ...p, ...r.data, tasks: r.data.tasks || p.tasks } : p)));
      }
    } catch { /* list already has light row */ }
  };

  const save = async (e) => {
    e.preventDefault();
    if (kind === "office") {
      const invalid = validateOfficeTaskAssign(form.park_id);
      if (invalid) { toast.error(invalid); return; }
      const park = findWorkPark(parks, form.park_id);
      setBusy(true);
      try {
        await axios.post(`${API_URL}/personnel/employees/${empId}/office-tasks`, officeTaskPayload(park, form.title));
        toast.success(`${employee.full_name} · ${park?.name || "iç görev"}`);
        onSaved?.();
        onClose();
      } catch (err) {
        toast.error(err.response?.data?.detail || "Görev kaydedilemedi.");
      } finally {
        setBusy(false);
      }
      return;
    }
    const invalid = validateEmployeeTaskAssign(form.project_id, form.task_id, form.title);
    if (invalid) { toast.error(invalid); return; }
    const project = projects.find((p) => (p.id || p._id) === form.project_id);
    if (!project) { toast.error("Proje seçin."); return; }
    const due = days ? dueDateFromDays(new Date().toISOString().slice(0, 10), days) : (form.due_date || undefined);
    const next = nextTasksAfterAssign(project.tasks, employee, {
      taskId: form.task_id,
      title: form.title,
      durationDays: days || undefined,
      dueDate: due,
      kind,
    });
    if (next.error) { toast.error(next.error); return; }
    setBusy(true);
    try {
      await axios.put(`${API_URL}/projects/${project.id || project._id}`, { tasks: next.tasks });
      const work = (next.tasks.find((t) => t.id === form.task_id)?.title || form.title || "iş").trim();
      toast.success(`${employee.full_name} · ${work} · dış görev`);
      onSaved?.();
      onClose();
    } catch (err) {
      toast.error(err.response?.data?.detail || "Görev kaydedilemedi.");
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="fixed inset-0 z-[70] bg-slate-900/60 backdrop-blur-sm flex items-center justify-center p-4" onClick={onClose} data-testid="emp-task-modal">
      <form
        onSubmit={save}
        onClick={(e) => e.stopPropagation()}
        className="bg-white rounded-2xl w-full max-w-md p-5 space-y-3 text-xs shadow-2xl max-h-[92vh] overflow-y-auto"
        data-testid="emp-card-task-modal"
      >
        <div className="flex items-center justify-between border-b pb-2">
          <h3 className="text-sm font-bold text-slate-900 flex items-center gap-2">
            <ClipboardList className="w-4 h-4 text-indigo-600" /> Görev ata — {employee.full_name}
          </h3>
          <button type="button" onClick={onClose} className="text-slate-400"><X className="w-5 h-5" /></button>
        </div>

        {loading ? (
          <div className="py-8 text-center text-slate-400 flex items-center justify-center gap-2">
            <Loader2 className="w-4 h-4 animate-spin" /> Projeler yükleniyor…
          </div>
        ) : (
          <>
            <div className="grid grid-cols-2 gap-1.5" data-testid="emp-task-kind">
              {[["office", "İç görev"], ["field", "Dış görev"]].map(([k, label]) => (
                <button
                  type="button"
                  key={k}
                  onClick={() => {
                    setKind(k);
                    if (k === "office") setForm((s) => ({ ...s, duration_days: "", due_date: "" }));
                  }}
                  className={`py-2 rounded-lg border text-[12px] font-semibold ${kind === k ? (k === "field" ? "bg-indigo-50 text-indigo-800 border-indigo-200" : "bg-slate-100 text-slate-800 border-slate-300") : "bg-white text-slate-500 border-slate-200"}`}
                  data-testid={`emp-task-kind-${k}`}
                >
                  {label}
                </button>
              ))}
            </div>

            <div className="rounded-xl border border-slate-100 bg-slate-50/70 p-2.5 space-y-1.5" data-testid="emp-task-existing">
              <div className="text-[10px] font-bold uppercase text-slate-500">
                Mevcut görevler ({openTasks.length} açık / {myTasks.length} toplam)
              </div>
              {myTasks.length === 0 ? (
                <div className="text-slate-400">Bu personele atanmış proje görevi yok.</div>
              ) : (
                <ul className="space-y-1 max-h-28 overflow-y-auto">
                  {myTasks.slice(0, 8).map((t, i) => (
                    <li key={t.id || i} className={`flex items-start gap-1.5 ${t.done ? "opacity-50" : ""}`}>
                      {t.done ? <CheckCircle2 className="w-3.5 h-3.5 text-emerald-600 shrink-0 mt-0.5" /> : <Circle className="w-3.5 h-3.5 text-slate-300 shrink-0 mt-0.5" />}
                      <span className={t.done ? "line-through text-slate-500" : "text-slate-800 font-semibold"}>{t.title}</span>
                      <span className="ml-auto text-slate-400 font-mono shrink-0">{t.project_number || t.project_name}</span>
                    </li>
                  ))}
                </ul>
              )}
            </div>

            {kind === "office" ? (
              parks.length === 0 ? (
                <p className="text-amber-800 bg-amber-50 border border-amber-100 rounded-lg p-2" data-testid="emp-task-no-parks">
                  Henüz parkur yok. Firma Ayarları → İç görev parkurları’ndan ekleyin (ör. Makina parkuru).
                </p>
              ) : (
                <>
                  <p className="text-[11px] text-slate-500" data-testid="emp-task-office-hint">İç görev ofiste / parkurda yapılır; konum kontrolü ücreti etkilemez.</p>
                  <div>
                    <label className="block font-semibold mb-1">Parkur</label>
                    <select
                      value={form.park_id}
                      onChange={(e) => setForm({ ...form, park_id: e.target.value })}
                      className={inputCls}
                      data-testid="emp-task-park"
                    >
                      <option value="">Parkur seçin</option>
                      {parks.map((p) => (
                        <option key={p.id} value={p.id}>{p.name}</option>
                      ))}
                    </select>
                  </div>
                  <div>
                    <label className="block font-semibold mb-1">Yapacağı iş (opsiyonel)</label>
                    <input
                      value={form.title}
                      onChange={(e) => setForm({ ...form, title: e.target.value })}
                      placeholder="Boş bırakılırsa parkur adı yazılır"
                      className={inputCls}
                      data-testid="emp-task-title"
                    />
                  </div>
                  <p className="text-[11px] text-indigo-800 bg-indigo-50 border border-indigo-100 rounded-lg p-2" data-testid="emp-task-field-hint">
                    İç görev: giriş/çıkış ofisten; gün içi konum kontrolü ücreti etkilemez.
                  </p>
                </>
              )
            ) : projectOptions.length === 0 && !form.project_id ? (
              <p className="text-amber-800 bg-amber-50 border border-amber-100 rounded-lg p-2">
                Görev atamak için önce Projeler modülünden bir proje oluşturun.
              </p>
            ) : (
              <>
                <div>
                  <label className="block font-semibold mb-1">Dış görev kaç gün?</label>
                  <input
                    type="number"
                    min="1"
                    max="366"
                    value={form.duration_days}
                    onChange={(e) => {
                      const duration_days = e.target.value;
                      const n = parseTaskDays(duration_days);
                      setForm({
                        ...form,
                        duration_days,
                        due_date: n ? dueDateFromDays(new Date().toISOString().slice(0, 10), n) : form.due_date,
                      });
                    }}
                    placeholder="Örn: 3"
                    className={inputCls}
                    data-testid="emp-task-days"
                  />
                  <p className="mt-1 text-[11px] text-slate-500" data-testid="emp-task-days-hint">
                    {days ? `${days} gün · bitiş ${form.due_date || dueDateFromDays(new Date().toISOString().slice(0, 10), days)}` : "Dış görevde kaç gün çalışacağını yazın; bitiş tarihi hesaplanır."}
                  </p>
                </div>
                <div>
                  <label className="block font-semibold mb-1">Proje</label>
                  <select
                    value={form.project_id}
                    onChange={(e) => pickProject(e.target.value)}
                    className={inputCls}
                    data-testid="emp-task-project"
                  >
                    <option value="">Proje seçin</option>
                    {projectOptions.map((p) => (
                      <option key={p.id || p._id} value={p.id || p._id}>
                        {isClosedProject(p) ? "Tamamlandı · " : ""}{p.project_number ? `${p.project_number} · ` : ""}{p.name}
                      </option>
                    ))}
                  </select>
                  {closed.length ? (
                    <button
                      type="button"
                      onClick={() => setShowCompleted((v) => !v)}
                      className="mt-1 text-[11px] font-medium text-slate-500 hover:text-slate-700"
                      data-testid="emp-task-show-completed"
                    >
                      {showCompleted ? "Tamamlananları gizle" : `Tamamlananları göster (${closed.length})`}
                    </button>
                  ) : null}
                </div>
                <div>
                  <label className="block font-semibold mb-1">Yapacağı iş</label>
                  <select
                    value={form.task_id}
                    onChange={(e) => setForm({ ...form, task_id: e.target.value, title: e.target.value ? "" : form.title })}
                    className={inputCls}
                    disabled={!form.project_id}
                    data-testid="emp-task-job"
                  >
                    <option value="">{form.project_id ? "Yapılacak iş seçin" : "Önce proje seçin"}</option>
                    {projectTasks.map((t) => (
                      <option key={t.id} value={t.id}>
                        {t.title}
                      </option>
                    ))}
                  </select>
                </div>
                {!form.task_id ? (
                  <div>
                    <label className="block font-semibold mb-1">Yeni iş adı</label>
                    <input
                      value={form.title}
                      onChange={(e) => setForm({ ...form, title: e.target.value })}
                      placeholder="Listede yoksa yazın: keşif, montaj"
                      className={inputCls}
                      data-testid="emp-task-title"
                    />
                  </div>
                ) : (
                  <p className="text-[11px] text-slate-500" data-testid="emp-task-who">
                    {employee.full_name} bu işe atanacak
                    {projectTasks.find((t) => t.id === form.task_id)?.title ? ` · ${projectTasks.find((t) => t.id === form.task_id).title}` : ""}
                  </p>
                )}
                <p className="text-[11px] text-indigo-800 bg-indigo-50 border border-indigo-100 rounded-lg p-2" data-testid="emp-task-field-hint">
                  Dış görevde işe giriş/çıkış görev yerinden yapılır
                  {selectedHasLoc ? ` — ${selected.name || "proje"} konumu iş yeri sayılır.` : selected ? " — bu projenin konumu yoksa giriş konumsuz (firma ofisi zorunlu değil)." : "."}
                  {days ? ` · ${days} gün.` : ""}
                </p>
              </>
            )}
          </>
        )}

        <div className="flex justify-end gap-2 pt-2 border-t">
          <button type="button" onClick={onClose} className="px-3 py-1.5 border rounded-lg">İptal</button>
          <button
            type="submit"
            disabled={busy || loading || (kind === "office" ? !parks.length : (!projectOptions.length && !form.project_id))}
            className="px-4 py-1.5 bg-indigo-600 hover:bg-indigo-700 text-white rounded-lg font-semibold disabled:opacity-50"
            data-testid="emp-task-save"
          >
            {busy ? "Kaydediliyor…" : `${employee.full_name} bu işe ata`}
          </button>
        </div>
      </form>
    </div>
  );
}

export default EmployeeAssignTaskModal;
