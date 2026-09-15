import React, { useEffect, useState } from "react";
import axios from "axios";
import { toast } from "sonner";
import { Receipt, Users, Plus, Trash2, X } from "lucide-react";
import { API_URL } from "../context/AuthContext";
import { useEscape } from "../utils/useEscape";

const inputCls = "w-full bg-slate-50 border border-slate-200 rounded-lg p-2 text-xs";

const empLabel = (e) => e.full_name || e.name || e.email || e.id;
const empId = (e) => e.id || e._id;

/** Proje kartından hızlı masraf girişi */
export function ProjectExpenseModal({ project, companyId, onClose, onSaved }) {
  useEscape(onClose);
  const [categories, setCategories] = useState(["Diğer"]);
  const [f, setF] = useState({
    date: new Date().toISOString().slice(0, 10),
    category: "Diğer",
    description: "",
    amount: "",
    vat_rate: 20,
    vat_included: true,
    notes: "",
  });
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    axios
      .get(`${API_URL}/expenses/categories`, { params: { company_id: companyId } })
      .then((r) => {
        const names = (r.data || []).map((c) => (typeof c === "string" ? c : c.name)).filter(Boolean);
        if (names.length) setCategories(names);
      })
      .catch(() => {});
  }, [companyId]);

  const save = async (e) => {
    e.preventDefault();
    if (!f.description.trim()) { toast.error("Açıklama zorunlu."); return; }
    if (!(Number(f.amount) > 0)) { toast.error("Tutar girin."); return; }
    setBusy(true);
    try {
      await axios.post(`${API_URL}/expenses`, {
        company_id: companyId,
        project_id: project.id,
        date: f.date,
        category: f.category || "Diğer",
        description: f.description.trim(),
        amount: Number(f.amount),
        vat_rate: Number(f.vat_rate) || 0,
        vat_included: !!f.vat_included,
        notes: f.notes || "",
      });
      toast.success("Masraf projeye kaydedildi.");
      onSaved?.();
      onClose();
    } catch (err) {
      toast.error(err.response?.data?.detail || "Masraf kaydedilemedi.");
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="fixed inset-0 z-[60] bg-slate-900/60 backdrop-blur-sm flex items-end sm:items-center justify-center p-0 sm:p-4" onClick={onClose}>
      <form
        onSubmit={save}
        onClick={(e) => e.stopPropagation()}
        className="bg-white rounded-t-2xl sm:rounded-2xl w-full max-w-md p-4 sm:p-5 space-y-3 text-xs shadow-2xl max-h-[92vh] overflow-y-auto"
        data-testid="project-expense-modal"
      >
        <div className="flex items-center justify-between border-b pb-2">
          <h3 className="text-sm font-bold flex items-center gap-2">
            <Receipt className="w-4 h-4 text-rose-600" /> Masraf Ekle
          </h3>
          <button type="button" onClick={onClose} className="text-slate-400"><X className="w-5 h-5" /></button>
        </div>
        <div className="text-[11px] text-slate-500">
          Proje: <b className="text-slate-800">{project.name}</b>
          <span className="font-mono text-slate-400"> · {project.project_number}</span>
        </div>
        <div className="grid grid-cols-2 gap-2">
          <div>
            <label className="block font-semibold mb-1">Tarih</label>
            <input type="date" required value={f.date} onChange={(e) => setF({ ...f, date: e.target.value })} className={inputCls} data-testid="proj-exp-date" />
          </div>
          <div>
            <label className="block font-semibold mb-1">Kategori</label>
            <select value={f.category} onChange={(e) => setF({ ...f, category: e.target.value })} className={inputCls} data-testid="proj-exp-category">
              {categories.map((c) => <option key={c} value={c}>{c}</option>)}
            </select>
          </div>
          <div className="col-span-2">
            <label className="block font-semibold mb-1">Açıklama *</label>
            <input required value={f.description} onChange={(e) => setF({ ...f, description: e.target.value })} placeholder="Örn: Şantiye malzemesi" className={inputCls} data-testid="proj-exp-description" />
          </div>
          <div>
            <label className="block font-semibold mb-1">Tutar (₺)</label>
            <input type="number" step="0.01" min="0.01" required value={f.amount} onChange={(e) => setF({ ...f, amount: e.target.value })} className={`${inputCls} font-bold`} data-testid="proj-exp-amount" />
          </div>
          <div>
            <label className="block font-semibold mb-1">KDV %</label>
            <select value={f.vat_rate} onChange={(e) => setF({ ...f, vat_rate: e.target.value })} className={inputCls} data-testid="proj-exp-vat">
              {[0, 1, 10, 20].map((v) => <option key={v} value={v}>%{v}</option>)}
            </select>
          </div>
          <label className="col-span-2 flex items-center gap-2 bg-slate-50 border rounded-lg p-2 cursor-pointer">
            <input type="checkbox" checked={f.vat_included} onChange={(e) => setF({ ...f, vat_included: e.target.checked })} data-testid="proj-exp-vat-included" />
            Tutar KDV dahil
          </label>
          <div className="col-span-2">
            <label className="block font-semibold mb-1">Not</label>
            <input value={f.notes} onChange={(e) => setF({ ...f, notes: e.target.value })} className={inputCls} data-testid="proj-exp-notes" />
          </div>
        </div>
        <div className="flex justify-end gap-2 pt-2 border-t">
          <button type="button" onClick={onClose} className="px-3 py-1.5 border rounded-lg">İptal</button>
          <button type="submit" disabled={busy} className="px-4 py-1.5 bg-rose-600 hover:bg-rose-700 text-white rounded-lg font-semibold" data-testid="proj-exp-save">
            {busy ? "Kaydediliyor…" : "Masrafı Kaydet"}
          </button>
        </div>
      </form>
    </div>
  );
}

const emptyTask = () => ({
  id: `t_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`,
  title: "",
  done: false,
  assignee_id: "",
  assignee_name: "",
});

/** Proje kartından personel atama + görev dağılımı */
export function ProjectTeamTasksModal({ project, companyId, onClose, onSaved }) {
  useEscape(onClose);
  const [employees, setEmployees] = useState([]);
  const [tasks, setTasks] = useState([]);
  const [busy, setBusy] = useState(false);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      setLoading(true);
      try {
        const emps = await axios.get(`${API_URL}/personnel/employees`, { params: { company_id: companyId } });
        if (cancelled) return;
        setEmployees(emps.data || []);
        const existing = (project.tasks || []).map((t, i) => ({
          id: t.id || `t_${i}_${Date.now()}`,
          title: t.title || t.name || "",
          done: !!(t.done || t.status === "done" || t.status === "completed"),
          assignee_id: t.assignee_id || "",
          assignee_name: t.assignee_name || "",
        }));
        setTasks(existing.length ? existing : [emptyTask()]);
      } catch {
        if (!cancelled) {
          toast.error("Personel listesi yüklenemedi.");
          setTasks([emptyTask()]);
        }
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => { cancelled = true; };
  }, [companyId, project]);

  const setAssignee = (idx, id) => {
    const emp = employees.find((e) => empId(e) === id);
    setTasks((rows) => rows.map((t, i) => (i === idx ? {
      ...t,
      assignee_id: id || "",
      assignee_name: emp ? empLabel(emp) : "",
    } : t)));
  };

  const save = async (e) => {
    e.preventDefault();
    const cleaned = tasks
      .map((t) => ({
        id: t.id,
        title: (t.title || "").trim(),
        done: !!t.done,
        assignee_id: t.assignee_id || null,
        assignee_name: t.assignee_name || null,
      }))
      .filter((t) => t.title);
    setBusy(true);
    try {
      await axios.put(`${API_URL}/projects/${project.id}`, { tasks: cleaned });
      toast.success("Personel ve görev dağılımı kaydedildi.");
      onSaved?.();
      onClose();
    } catch (err) {
      toast.error(err.response?.data?.detail || "Kaydedilemedi.");
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="fixed inset-0 z-[60] bg-slate-900/60 backdrop-blur-sm flex items-end sm:items-center justify-center p-0 sm:p-4" onClick={onClose}>
      <form
        onSubmit={save}
        onClick={(e) => e.stopPropagation()}
        className="bg-white rounded-t-2xl sm:rounded-2xl w-full max-w-lg p-4 sm:p-5 space-y-3 text-xs shadow-2xl max-h-[92vh] overflow-y-auto"
        data-testid="project-team-modal"
      >
        <div className="flex items-center justify-between border-b pb-2">
          <h3 className="text-sm font-bold flex items-center gap-2">
            <Users className="w-4 h-4 text-indigo-600" /> Personel & Görev Dağılımı
          </h3>
          <button type="button" onClick={onClose} className="text-slate-400"><X className="w-5 h-5" /></button>
        </div>
        <div className="text-[11px] text-slate-500">
          Proje: <b className="text-slate-800">{project.name}</b>
          <span className="font-mono text-slate-400"> · {project.project_number}</span>
        </div>
        {loading ? (
          <div className="py-8 text-center text-slate-400">Yükleniyor…</div>
        ) : (
          <div className="space-y-2" data-testid="project-team-tasks">
            {tasks.map((t, i) => (
              <div key={t.id} className="border border-slate-200 rounded-xl p-2.5 space-y-1.5 bg-slate-50/50" data-testid={`project-task-row-${i}`}>
                <div className="flex gap-1.5 items-center">
                  <input
                    type="checkbox"
                    checked={!!t.done}
                    onChange={(e) => setTasks((rows) => rows.map((x, j) => (j === i ? { ...x, done: e.target.checked } : x)))}
                    title="Tamamlandı"
                    data-testid={`project-task-done-${i}`}
                  />
                  <input
                    value={t.title}
                    onChange={(e) => setTasks((rows) => rows.map((x, j) => (j === i ? { ...x, title: e.target.value } : x)))}
                    placeholder="Görev / iş adımı"
                    className={`${inputCls} flex-1`}
                    data-testid={`project-task-title-${i}`}
                  />
                  <button type="button" onClick={() => setTasks((rows) => rows.filter((_, j) => j !== i))} className="p-1.5 text-slate-300 hover:text-rose-600" data-testid={`project-task-del-${i}`}>
                    <Trash2 className="w-3.5 h-3.5" />
                  </button>
                </div>
                <select
                  value={t.assignee_id || ""}
                  onChange={(e) => setAssignee(i, e.target.value)}
                  className={inputCls}
                  data-testid={`project-task-assignee-${i}`}
                >
                  <option value="">Personel seçin…</option>
                  {employees.map((emp) => (
                    <option key={empId(emp)} value={empId(emp)}>{empLabel(emp)}</option>
                  ))}
                </select>
              </div>
            ))}
            <button
              type="button"
              onClick={() => setTasks((rows) => [...rows, emptyTask()])}
              className="flex items-center gap-1 text-indigo-700 font-semibold"
              data-testid="project-task-add"
            >
              <Plus className="w-3.5 h-3.5" /> Görev ekle
            </button>
            {employees.length === 0 && (
              <p className="text-[11px] text-amber-700 bg-amber-50 border border-amber-100 rounded-lg p-2">
                Personel listesi boş. Önce Personel modülünden kart oluşturun.
              </p>
            )}
          </div>
        )}
        <div className="flex justify-end gap-2 pt-2 border-t">
          <button type="button" onClick={onClose} className="px-3 py-1.5 border rounded-lg">İptal</button>
          <button type="submit" disabled={busy || loading} className="px-4 py-1.5 bg-indigo-600 hover:bg-indigo-700 text-white rounded-lg font-semibold" data-testid="project-team-save">
            {busy ? "Kaydediliyor…" : "Dağılımı Kaydet"}
          </button>
        </div>
      </form>
    </div>
  );
}
