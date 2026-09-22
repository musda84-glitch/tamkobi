import React, { useCallback, useEffect, useState } from "react";
import axios from "axios";
import { toast } from "sonner";
import { CheckCircle2, Circle, ClipboardList, Loader2, X } from "lucide-react";
import { API_URL } from "../context/AuthContext";
import { useEscape } from "../utils/useEscape";

const inputCls = "w-full bg-slate-50 border border-slate-200 rounded-lg p-2 text-xs";
const empIdOf = (e) => String(e?.id || e?._id || "");

/** Personel kartından proje görevi ata */
export function EmployeeAssignTaskModal({ employee, companyId, onClose, onSaved }) {
  useEscape(onClose);
  const empId = empIdOf(employee);
  const [projects, setProjects] = useState([]);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [form, setForm] = useState({ project_id: "", title: "", due_date: "", duration_days: "" });

  const load = useCallback(async () => {
    if (!companyId) return;
    setLoading(true);
    try {
      const r = await axios.get(`${API_URL}/projects`, { params: { company_id: companyId, light: 1 } });
      const rows = r.data || [];
      setProjects(rows);
      setForm((s) => {
        if (s.project_id) return s;
        const first = rows.find((p) => p.status !== "completed") || rows[0];
        return { ...s, project_id: first ? (first.id || first._id) : "" };
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
  const assignable = projects.filter((p) => p.status !== "completed");
  const projectOptions = assignable.length ? assignable : projects;
  const selected = projects.find((p) => (p.id || p._id) === form.project_id);
  const selectedHasLoc = selected && selected.latitude != null && selected.longitude != null;

  const save = async (e) => {
    e.preventDefault();
    const title = (form.title || "").trim();
    if (!title) { toast.error("Görev başlığı girin."); return; }
    const project = projects.find((p) => (p.id || p._id) === form.project_id);
    if (!project) { toast.error("Proje seçin."); return; }
    setBusy(true);
    try {
      const next = [
        ...(project.tasks || []),
        {
          id: `t_${Date.now()}`,
          title,
          done: false,
          assignee_id: empId,
          assignee_name: employee.full_name,
          due_date: form.due_date || null,
          duration_days: (() => {
            const n = Math.trunc(Number(form.duration_days));
            return n > 0 ? n : null;
          })(),
        },
      ];
      await axios.put(`${API_URL}/projects/${project.id || project._id}`, { tasks: next });
      toast.success(`${employee.full_name} için görev atandı.`);
      onSaved?.();
      onClose();
    } catch (err) {
      toast.error(err.response?.data?.detail || "Görev kaydedilemedi.");
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="fixed inset-0 z-[60] bg-slate-900/60 backdrop-blur-sm flex items-center justify-center p-4" onClick={onClose} data-testid="emp-task-modal">
      <form
        onSubmit={save}
        onClick={(e) => e.stopPropagation()}
        className="bg-white rounded-2xl w-full max-w-md p-5 space-y-3 text-xs shadow-2xl max-h-[92vh] overflow-y-auto"
      >
        <div className="flex items-center justify-between border-b pb-2">
          <h3 className="text-sm font-bold text-slate-900 flex items-center gap-2">
            <ClipboardList className="w-4 h-4 text-indigo-600" /> Görev Ata — {employee.full_name}
          </h3>
          <button type="button" onClick={onClose} className="text-slate-400"><X className="w-5 h-5" /></button>
        </div>

        {loading ? (
          <div className="py-8 text-center text-slate-400 flex items-center justify-center gap-2">
            <Loader2 className="w-4 h-4 animate-spin" /> Projeler yükleniyor…
          </div>
        ) : (
          <>
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

            {projectOptions.length === 0 ? (
              <p className="text-amber-800 bg-amber-50 border border-amber-100 rounded-lg p-2">
                Görev atamak için önce Projeler modülünden bir proje oluşturun.
              </p>
            ) : (
              <>
                <div>
                  <label className="block font-semibold mb-1">Proje</label>
                  <select
                    value={form.project_id}
                    onChange={(e) => setForm({ ...form, project_id: e.target.value })}
                    className={inputCls}
                    data-testid="emp-task-project"
                  >
                    {projectOptions.map((p) => (
                      <option key={p.id || p._id} value={p.id || p._id}>
                        {p.project_number ? `${p.project_number} · ` : ""}{p.name}
                      </option>
                    ))}
                  </select>
                </div>
                <div>
                  <label className="block font-semibold mb-1">Görev</label>
                  <input
                    value={form.title}
                    onChange={(e) => setForm({ ...form, title: e.target.value })}
                    placeholder="Örn: Montaj, keşif, teslimat"
                    className={inputCls}
                    autoFocus
                    data-testid="emp-task-title"
                  />
                </div>
                <p className="text-[11px] text-indigo-800 bg-indigo-50 border border-indigo-100 rounded-lg p-2" data-testid="emp-task-field-hint">
                  Dış görevde işe giriş/çıkış görev yerinden yapılır
                  {selectedHasLoc ? ` — ${selected.name || "proje"} konumu iş yeri sayılır.` : selected ? " — bu projenin konumu yoksa giriş konumsuz (firma ofisi zorunlu değil)." : "."}
                </p>
                <div>
                  <label className="block font-semibold mb-1">Kaç gün (dış görev)</label>
                  <input
                    type="number"
                    min="1"
                    max="366"
                    value={form.duration_days}
                    onChange={(e) => {
                      const duration_days = e.target.value;
                      const n = Math.trunc(Number(duration_days));
                      let due_date = form.due_date;
                      if (n > 0) {
                        const d = new Date();
                        d.setDate(d.getDate() + n - 1);
                        due_date = d.toISOString().slice(0, 10);
                      }
                      setForm({ ...form, duration_days, due_date });
                    }}
                    placeholder="Örn: 3"
                    className={inputCls}
                    data-testid="emp-task-days"
                  />
                </div>
                <div>
                  <label className="block font-semibold mb-1">Son tarih (opsiyonel)</label>
                  <input
                    type="date"
                    value={form.due_date}
                    onChange={(e) => setForm({ ...form, due_date: e.target.value })}
                    className={inputCls}
                    data-testid="emp-task-due"
                  />
                </div>
              </>
            )}
          </>
        )}

        <div className="flex justify-end gap-2 pt-2 border-t">
          <button type="button" onClick={onClose} className="px-3 py-1.5 border rounded-lg">İptal</button>
          <button
            type="submit"
            disabled={busy || loading || projectOptions.length === 0}
            className="px-4 py-1.5 bg-indigo-600 hover:bg-indigo-700 text-white rounded-lg font-semibold disabled:opacity-50"
            data-testid="emp-task-save"
          >
            {busy ? "Kaydediliyor…" : "Görevi Ata"}
          </button>
        </div>
      </form>
    </div>
  );
}

export default EmployeeAssignTaskModal;
