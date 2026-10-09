
import React, { useEffect, useState, useCallback } from "react";
import axios from "axios";
import { toast } from "sonner";
import { Factory, Play, Pause, CheckCircle2, Clock, User, Maximize2, Minimize2, RefreshCw, MapPin, Package, KeyRound, X, Loader2, FileText, Trash2, ArrowDownUp } from "lucide-react";
import { API_URL, useAuth } from "../context/AuthContext";
import { stationNamesFromParks } from "../utils/workParks";
import { AssignedDutyCard } from "../components/AssignedDutyCard";
import { HoverImageThumb } from "../utils/HoverImageThumb";
import { openAssignedDuties } from "../utils/assignedDuty";
import { operatorStationLock, operatorStationLockMessage, shopFloorCardActions, shopFloorCardBorder, shopFloorOperators, shopFloorPausePhaseLabel, workOrderFinishPlan } from "../utils/shopFloorActions";
import { backdropDismissProps } from "../utils/modalBackdrop";
import { groupWorkOrdersByStation, shopFloorStationSections } from "../utils/recipeStationOrder";
import { ProductionAiAdvisor } from "../components/ProductionAiAdvisor";
import { formatTrQty } from "../utils/money";

const STATUS = { waiting: ["Bekliyor", "bg-slate-100 text-slate-500"], ready: ["Hazır", "bg-blue-50 text-blue-700"], in_progress: ["Devam Ediyor", "bg-amber-50 text-amber-700"], paused: ["Duraklatıldı", "bg-orange-50 text-orange-700"], done: ["Tamamlandı", "bg-emerald-50 text-emerald-700"] };

export default function ShopFloorPage() {
  const { activeCompany } = useAuth();
  const companyId = activeCompany?.id || activeCompany?._id || "comp_nexus_main_01";
  const [wos, setWos] = useState([]);
  const [employees, setEmployees] = useState([]);
  const [stations, setStations] = useState([]);
  const [operator, setOperator] = useState("");
  const [station, setStation] = useState(() => localStorage.getItem("nx_station") || "");
  const [groupSameStation, setGroupSameStation] = useState(() => localStorage.getItem("nx_group_same_station") === "1");
  const [groupBusy, setGroupBusy] = useState(false);
  const [pendingEmp, setPendingEmp] = useState(null);
  const [pin, setPin] = useState("");
  const [unlockBusy, setUnlockBusy] = useState(false);
  const [unlockErr, setUnlockErr] = useState("");
  const [kiosk, setKiosk] = useState(false);
  const [finishing, setFinishing] = useState(null);
  const [fin, setFin] = useState({ produced_qty: 0, scrap_qty: 0, notes: "" });
  const [trashBusy, setTrashBusy] = useState(false);
  const [perf, setPerf] = useState(null);
  const [showPerf, setShowPerf] = useState(false);
  const [duties, setDuties] = useState([]);
  const [dutyBusyId, setDutyBusyId] = useState(null);
  const [trashTarget, setTrashTarget] = useState(null);
  const [trashReqBusy, setTrashReqBusy] = useState(false);
  const [trashReqErr, setTrashReqErr] = useState("");
  const [pausePolicy, setPausePolicy] = useState({ allowed: true, phase: "mesai", reason: null, deadline: null });
  const loadPerf = useCallback(() => axios.get(`${API_URL}/production/work-orders/performance?company_id=${companyId}`).then((r) => setPerf(r.data)).catch(() => {}), [companyId]);
  useEffect(() => { loadPerf(); }, [loadPerf, wos.length]);

  const loadPausePolicy = useCallback(async (opName) => {
    if (!opName) {
      setPausePolicy({ allowed: false, phase: "outside", reason: "Önce operatör seçin.", deadline: null });
      return;
    }
    try {
      const r = await axios.get(`${API_URL}/production/work-orders/pause-policy`, {
        params: { company_id: companyId, operator_name: opName },
      });
      setPausePolicy(r.data || { allowed: false, phase: "outside" });
    } catch {
      setPausePolicy({ allowed: true, phase: "mesai", reason: null, deadline: null });
    }
  }, [companyId]);

  const load = useCallback(async () => {
    try {
      const [w, e, s, parks, me] = await Promise.all([
        axios.get(`${API_URL}/production/work-orders?company_id=${companyId}${station ? `&station=${encodeURIComponent(station)}` : ""}`).catch(() => ({ data: [] })),
        axios.get(`${API_URL}/personnel/employees?company_id=${companyId}`).catch(() => ({ data: [] })),
        axios.get(`${API_URL}/production/work-orders/stations?company_id=${companyId}`).catch(() => ({ data: [] })),
        axios.get(`${API_URL}/companies/${companyId}/work-parks`).catch(() => ({ data: { parks: [] } })),
        axios.get(`${API_URL}/personnel/me`, { withCredentials: true }).catch(() => ({ data: { tasks: [] } })),
      ]);
      setWos(w.data || []); setEmployees(shopFloorOperators(e.data || []));
      setStations(stationNamesFromParks(parks.data?.parks, Array.isArray(s.data) ? s.data : []));
      setDuties(Array.isArray(me.data?.tasks) ? me.data.tasks : []);
    } catch { /* keep last */ }
  }, [companyId, station]);
  useEffect(() => { load(); const t = setInterval(load, 15000); return () => clearInterval(t); }, [load]);
  useEffect(() => {
    loadPausePolicy(operator);
    if (!operator) return undefined;
    const t = setInterval(() => loadPausePolicy(operator), 60000);
    return () => clearInterval(t);
  }, [operator, loadPausePolicy]);
  useEffect(() => { localStorage.setItem("nx_station", station); }, [station]);
  useEffect(() => { localStorage.setItem("nx_group_same_station", groupSameStation ? "1" : "0"); }, [groupSameStation]);
  useEffect(() => {
    axios.get(`${API_URL}/production/work-orders/shopfloor-settings`, { params: { company_id: companyId } })
      .then((r) => {
        if (typeof r.data?.group_same_station === "boolean") {
          setGroupSameStation(r.data.group_same_station);
          localStorage.setItem("nx_group_same_station", r.data.group_same_station ? "1" : "0");
        }
      })
      .catch(() => {});
  }, [companyId]);

  const requestOperator = (name) => {
    if (!name) { setOperator(""); setPendingEmp(null); setPin(""); setUnlockErr(""); return; }
    if (name === operator) return;
    const emp = employees.find((e) => e.full_name === name);
    if (!emp) return;
    setPendingEmp(emp); setPin(""); setUnlockErr("");
  };
  const cancelUnlock = () => { setPendingEmp(null); setPin(""); setUnlockErr(""); };
  const unlockOperator = async (e) => {
    e.preventDefault();
    if (!pendingEmp) return;
    setUnlockBusy(true); setUnlockErr("");
    try {
      const r = await axios.post(`${API_URL}/production/work-orders/shopfloor-unlock`, { company_id: companyId, employee_id: pendingEmp.id, password: pin });
      setOperator(r.data.operator_name); setPendingEmp(null); setPin("");
      toast.success(`${r.data.operator_name} olarak giriş yapıldı.`);
    } catch (err) { const msg = err.response?.data?.detail || "Şifre doğrulanamadı."; setUnlockErr(msg); toast.error(msg); setPin(""); }
    finally { setUnlockBusy(false); }
  };

  const act = async (w, action, body) => {
    if (!operator) { toast.error("Önce operatör (personel) seçin."); return; }
    if (action === "start") {
      const blocker = operatorStationLock(wos, operator, w.station, w.id || w._id);
      if (blocker) {
        toast.error(operatorStationLockMessage(blocker, operator));
        return;
      }
    }
    try { const r = await axios.post(`${API_URL}/production/work-orders/${w.id}/${action}`, { operator_name: operator, ...(body || {}) }); toast.success(r.data.message); setFinishing(null); load(); }
    catch (err) { toast.error(err.response?.data?.detail || "İşlem başarısız."); }
  };
  const openFinish = (w) => {
    const plan = workOrderFinishPlan(w);
    setFinishing(w);
    setFin({ produced_qty: plan.qty, scrap_qty: 0, notes: "" });
  };
  const active = wos.filter((w) => w.status !== "done" && w.status !== "waiting");
  const waiting = wos.filter((w) => w.status === "waiting");
  const done = wos.filter((w) => w.status === "done");
  const trashCompleted = async () => {
    if (!done.length || trashBusy) return;
    if (!window.confirm(`${done.length} tamamlanan iş emri çöp kutusuna taşınsın mı? 30 gün içinde Geri Dönüşüm’den geri getirilebilir.`)) return;
    setTrashBusy(true);
    try {
      const r = await axios.post(`${API_URL}/production/work-orders/trash-completed`, {
        company_id: companyId,
        ...(station ? { station } : {}),
      });
      toast.success(r.data?.message || "Tamamlananlar çöpe taşındı.");
      load();
      loadPerf();
    } catch (err) {
      toast.error(err.response?.data?.detail || "Çöpe taşınamadı.");
    } finally {
      setTrashBusy(false);
    }
  };
  const mine = active.filter((w) => w.operator_name === operator || w.assigned_name === operator);
  const openDuties = openAssignedDuties(duties);
  const arrangeWos = (list) => (groupSameStation ? groupWorkOrdersByStation(list) : list);

  const toggleGroupSameStation = async (on) => {
    setGroupSameStation(on);
    localStorage.setItem("nx_group_same_station", on ? "1" : "0");
    setGroupBusy(true);
    try {
      const r = await axios.post(`${API_URL}/production/work-orders/shopfloor-settings`, {
        company_id: companyId,
        group_same_station: on,
      });
      toast.success(r.data?.message || (on ? "Peşi sıra istasyon sıralaması açıldı." : "Peşi sıra istasyon sıralaması kapatıldı."));
      load();
    } catch (err) {
      toast.error(err.response?.data?.detail || "Sıralama kaydedilemedi.");
    } finally {
      setGroupBusy(false);
    }
  };

  const renderWoGrid = (list, extraClass = "") => {
    if (!list.length) return null;
    if (!groupSameStation) {
      return (
        <div className={`grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-3 ${extraClass}`}>
          {list.map((w) => <Card key={w.id} w={w} />)}
        </div>
      );
    }
    return (
      <div className={`space-y-4 ${extraClass}`} data-testid="shopfloor-station-groups">
        {shopFloorStationSections(arrangeWos(list)).map((sec) => (
          <div key={sec.key} data-testid={`shopfloor-station-group-${sec.key}`}>
            <div className="flex items-center gap-2 mb-2">
              <ArrowDownUp className="w-3.5 h-3.5 text-slate-400" />
              <h3 className="text-xs font-bold uppercase tracking-wide text-slate-600">{sec.label}</h3>
              <span className="text-[10px] font-semibold text-slate-400">{sec.items.length}</span>
            </div>
            <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-3">
              {sec.items.map((w) => <Card key={w.id} w={w} />)}
            </div>
          </div>
        ))}
      </div>
    );
  };

  const approveDuty = async (t) => {
    if (!t?.id) return;
    setDutyBusyId(t.id);
    try {
      const r = await axios.post(`${API_URL}/personnel/me/tasks/${t.id}/complete`, {}, { withCredentials: true });
      toast.success(r.data?.message || "Görev tamamlandı.");
      load();
    } catch (err) {
      toast.error(err.response?.data?.detail || "Görev onaylanamadı.");
    } finally {
      setDutyBusyId(null);
    }
  };

  const openTrashRequest = (w) => {
    if (w.status === "done") {
      toast.error("Tamamlanan adım buradan silinmez; alttaki “Tamamlananları çöpe taşı”yı kullanın veya üretim emrinden iptal edin.");
      return;
    }
    if (w.trash_request_pending) {
      toast.message("Bu iş emri için silme talebi zaten yönetici onayında.");
      return;
    }
    if (!operator) {
      toast.error("Önce operatör seçin.");
      return;
    }
    setTrashTarget(w);
    setTrashReqErr("");
  };
  const cancelTrashRequest = () => { setTrashTarget(null); setTrashReqErr(""); };
  const confirmTrashRequest = async (e) => {
    e?.preventDefault?.();
    if (!trashTarget?.id) return;
    setTrashReqBusy(true);
    setTrashReqErr("");
    try {
      const r = await axios.post(`${API_URL}/production/work-orders/${trashTarget.id}/trash-request`, {
        company_id: companyId,
        operator_name: operator,
      });
      toast.success(r.data?.message || "Silme talebi yöneticiye gönderildi.");
      cancelTrashRequest();
      load();
    } catch (err) {
      const msg = err.response?.data?.detail || "Talep gönderilemedi.";
      setTrashReqErr(msg);
      toast.error(msg);
    } finally {
      setTrashReqBusy(false);
    }
  };

  const pauseAllowed = !!pausePolicy?.allowed;
  const Card = ({ w }) => {
    const [l, c] = STATUS[w.status] || STATUS.waiting;
    const actions = shopFloorCardActions(w.status, pauseAllowed);
    const stationLock = (actions.start || actions.resume)
      ? operatorStationLock(wos, operator, w.station, w.id || w._id)
      : null;
    const stationLockMsg = stationLock ? operatorStationLockMessage(stationLock, operator) : "";
    const pauseTitle = actions.pauseEnabled
      ? `Duraklat (${shopFloorPausePhaseLabel(pausePolicy?.phase)})`
      : (pausePolicy?.reason || "Mesai / mola / fazla mesai dışında duraklatılamaz");
    return (
    <div className={`bg-white rounded-2xl border-2 p-4 space-y-3 ${shopFloorCardBorder(w.status)}`} data-testid={`wo-card-${w.order_code}-${w.step_no}`}>
      <div className="flex justify-between items-start gap-2">
        <div className="min-w-0"><div className="font-mono text-xs text-slate-400">{w.order_code} • Adım {w.step_no}/{w.step_count}</div><div className="font-bold text-slate-900 text-base leading-tight truncate">{w.step_name}</div><div className="text-sm text-slate-600 flex items-center gap-1 truncate"><Package className="w-3.5 h-3.5" /> {w.product_name}</div></div>
        <div className="flex items-center gap-1 shrink-0">
          {actions.pause && (
            <button
              type="button"
              onClick={() => actions.pauseEnabled && act(w, "pause")}
              disabled={!actions.pauseEnabled}
              className={`p-1.5 rounded-lg border ${actions.pauseEnabled ? "text-orange-600 hover:bg-orange-50 border-orange-200" : "text-slate-300 border-slate-200 cursor-not-allowed"}`}
              title={pauseTitle}
              data-testid={`wo-pause-icon-${w.order_code}-${w.step_no}`}
            >
              <Pause className="w-4 h-4" />
            </button>
          )}
          {w.status !== "done" && (
            <button
              type="button"
              onClick={() => openTrashRequest(w)}
              disabled={!!w.trash_request_pending}
              className={`p-1.5 rounded-lg ${w.trash_request_pending ? "text-amber-500 bg-amber-50 cursor-default" : "text-slate-400 hover:text-rose-600 hover:bg-rose-50"}`}
              title={w.trash_request_pending ? "Silme onayı bekleniyor" : "Yönetici onayına gönder (sil)"}
              data-testid={`wo-trash-${w.order_code}-${w.step_no}`}
            >
              <Trash2 className="w-4 h-4" />
            </button>
          )}
          <span className={`px-2 py-1 rounded-lg text-xs font-bold ${c}`}>{l}</span>
          {w.trash_request_pending ? (
            <span className="px-2 py-1 rounded-lg text-[10px] font-bold bg-amber-50 text-amber-800 border border-amber-200" data-testid={`wo-trash-pending-${w.order_code}-${w.step_no}`}>
              Silme onayı bekliyor
            </span>
          ) : null}
        </div>
      </div>
      <div className="text-xs bg-slate-50 border border-slate-100 rounded-xl px-2.5 py-2 space-y-0.5" data-testid={`wo-meta-${w.order_code}-${w.step_no}`}>
        <div className="flex items-center gap-1.5 text-slate-600"><MapPin className="w-3.5 h-3.5 shrink-0 text-slate-400" /><span>İstasyon: <span className="font-semibold text-slate-900">{w.station || "—"}</span></span></div>
        <div className="flex flex-col gap-0.5 text-slate-600 min-w-0 max-w-full overflow-hidden">
          <div className="flex items-center gap-1.5 min-w-0"><FileText className="w-3.5 h-3.5 shrink-0 text-slate-400" /><span className="truncate">İş dosyası: <span className="font-semibold text-slate-900">{w.job_file_name || "—"}</span></span></div>
          {String(w.step_note || "").trim() ? (
            <div className="flex items-start gap-1.5 min-w-0 w-full max-w-full" data-testid={`wo-step-note-${w.order_code}-${w.step_no}`}>
              <span className="shrink-0 text-slate-400">Adım notu:</span>
              <span className="min-w-0 flex-1 font-semibold text-amber-900 whitespace-pre-wrap break-all [overflow-wrap:anywhere]">{String(w.step_note).trim()}</span>
            </div>
          ) : null}
        </div>
      </div>
      {(w.materials || []).length > 0 && (
        <div className="text-xs border border-slate-100 rounded-xl px-2.5 py-2 space-y-1" data-testid={`wo-materials-${w.order_code}-${w.step_no}`}>
          <div className="font-semibold text-slate-700">Hammaddeler</div>
          <ul className="space-y-0.5">
            {w.materials.map((m, i) => {
              const stockNote = String(m.stock_note || m.note || "").trim();
              const pname = String(m.product_name || "").trim();
              const noteIsExtra = !!(
                stockNote
                && stockNote.toLocaleLowerCase("tr") !== pname.toLocaleLowerCase("tr")
              );
              return (
              <li key={m.product_id || i} className="flex justify-between gap-2 text-slate-600" data-testid={`wo-mat-row-${w.order_code}-${w.step_no}-${i}`}>
                <span className="min-w-0">
                  {stockNote ? (
                    <>
                      <span className="font-semibold text-slate-900 whitespace-pre-wrap break-words" data-testid={`wo-mat-note-${w.order_code}-${w.step_no}-${i}`}>
                        {stockNote}
                      </span>
                      {noteIsExtra && pname ? (
                        <span className="block text-[10px] text-slate-500 truncate" title={pname}>{pname}</span>
                      ) : null}
                    </>
                  ) : (
                    pname || "Hammadde"
                  )}
                </span>
                <span className="shrink-0 font-semibold text-slate-900 self-start">{formatTrQty(m.needed)} {m.unit}</span>
              </li>
              );
            })}
          </ul>
        </div>
      )}
      {Array.isArray(w.images) && w.images.length > 0 && (
        <div className="flex items-center gap-1.5 flex-wrap" data-testid={`wo-images-${w.order_code}-${w.step_no}`}>
          {w.images.slice(0, 8).map((url) => (
            <HoverImageThumb key={url} src={url} className="w-14 h-14 rounded-lg object-cover border border-slate-200" testId={`wo-img-${w.order_code}-${w.step_no}`} />
          ))}
        </div>
      )}
      <div className="flex flex-wrap gap-x-4 gap-y-1 text-xs text-slate-500">
        {(() => {
          const plan = workOrderFinishPlan(w);
          return (
            <span className="font-bold text-slate-900 text-sm" data-testid={`wo-plan-${w.order_code}-${w.step_no}`}>
              {plan.isMaterial ? `${formatTrQty(plan.qty)} ${plan.unit}` : `${formatTrQty(w.planned_quantity)} ${w.unit}`}
              {plan.isMaterial && Number(w.planned_quantity) > 0 ? (
                <span className="ml-1 font-semibold text-slate-400">· mamul {formatTrQty(w.planned_quantity)} {w.unit}</span>
              ) : null}
            </span>
          );
        })()}
        {w.duration_min > 0 && <span className="flex items-center gap-1"><Clock className="w-3.5 h-3.5" /> Hedef {w.duration_min} dk</span>}
        {w.elapsed_min != null && <span className={`flex items-center gap-1 font-semibold ${w.duration_min && w.elapsed_min > w.duration_min ? "text-rose-600" : "text-amber-700"}`}><Clock className="w-3.5 h-3.5" /> {w.elapsed_min} dk geçti</span>}
        {(w.operator_name || w.assigned_name) && <span className="flex items-center gap-1"><User className="w-3.5 h-3.5" /> {w.operator_name || w.assigned_name}</span>}
        {w.planned_date && <span>Plan: {w.planned_date}</span>}
      </div>
      {w.notes && <div className="text-xs bg-slate-50 rounded-lg p-2 text-slate-600">{w.notes}</div>}
      <div className="grid grid-cols-2 gap-2">
        {actions.start && (
          <button
            onClick={() => !stationLock && act(w, "start")}
            disabled={!!stationLock}
            title={stationLockMsg || undefined}
            className={`col-span-2 flex items-center justify-center gap-2 py-3 rounded-xl font-bold text-base ${stationLock ? "bg-slate-200 text-slate-400 cursor-not-allowed" : "bg-emerald-600 hover:bg-emerald-700 text-white"}`}
            data-testid={`wo-start-${w.order_code}-${w.step_no}`}
          >
            <Play className="w-5 h-5" /> Başla
          </button>
        )}
        {actions.pause && (
          <button
            onClick={() => actions.pauseEnabled && act(w, "pause")}
            disabled={!actions.pauseEnabled}
            title={pauseTitle}
            className={`flex items-center justify-center gap-2 py-3.5 rounded-xl font-bold text-base ${actions.pauseEnabled ? "bg-orange-500 hover:bg-orange-600 text-white shadow-sm shadow-orange-500/30" : "bg-slate-200 text-slate-400 cursor-not-allowed"}`}
            data-testid={`wo-pause-${w.order_code}-${w.step_no}`}
          >
            <Pause className="w-5 h-5" /> Duraklat
          </button>
        )}
        {actions.resume && (
          <button
            onClick={() => !stationLock && act(w, "start")}
            disabled={!!stationLock}
            title={stationLockMsg || undefined}
            className={`flex items-center justify-center gap-2 py-3 rounded-xl font-bold ${stationLock ? "bg-slate-200 text-slate-400 cursor-not-allowed" : "bg-emerald-600 hover:bg-emerald-700 text-white"}`}
            data-testid={`wo-resume-${w.order_code}-${w.step_no}`}
          >
            <Play className="w-5 h-5" /> Devam
          </button>
        )}
        {actions.finish && (
          <button onClick={() => openFinish(w)} className="flex items-center justify-center gap-2 py-3 bg-slate-900 hover:bg-slate-800 text-white rounded-xl font-bold" data-testid={`wo-finish-${w.order_code}-${w.step_no}`}>
            <CheckCircle2 className="w-5 h-5" /> Bitir
          </button>
        )}
        {stationLockMsg ? (
          <div className="col-span-2 text-center text-[11px] text-amber-800 bg-amber-50 border border-amber-100 rounded-lg px-2 py-1.5" data-testid={`wo-station-lock-${w.order_code}-${w.step_no}`}>
            {stationLockMsg}
          </div>
        ) : null}
        {w.status === "waiting" && actions.start && !stationLock && (
          <div className="col-span-2 text-center text-[11px] text-slate-400 -mt-1">Önceki adım bitmeden de başlatılabilir</div>
        )}
        {w.status === "done" && <div className="col-span-2 text-center text-xs text-emerald-700 py-2 font-semibold">{w.produced_qty} üretildi{w.scrap_qty ? `, ${w.scrap_qty} fire` : ""} • {w.operator_name}</div>}
      </div>
    </div>); };

  return (
    <div className={kiosk ? "fixed inset-0 z-[100] bg-slate-100 overflow-y-auto p-4 sm:p-6" : "space-y-3"} data-testid="shopfloor-page">
      <div className="flex flex-col lg:flex-row lg:items-center justify-between gap-3">
        <div><h1 className="text-xl sm:text-2xl font-bold text-slate-900 tracking-tight flex items-center gap-2"><Factory className="w-6 h-6 text-emerald-600" /> Üretim Ekranı (Atölye)</h1><p className="text-xs sm:text-sm text-slate-500">Makine başındaki tabletten iş emirlerini görün, adımları başlatın / bitirin</p></div>
        <div className="flex flex-wrap items-center gap-2 text-sm">
          <select value={pendingEmp ? pendingEmp.full_name : operator} onChange={(e) => requestOperator(e.target.value)} className="bg-white border-2 border-slate-300 rounded-xl px-3 py-2.5 font-semibold min-w-[180px]" data-testid="shopfloor-operator"><option value="">Operatör seçin…</option>{employees.map((e) => <option key={e.id} value={e.full_name}>{e.full_name} — {e.position}</option>)}</select>
          <select value={station} onChange={(e) => setStation(e.target.value)} className="bg-white border-2 border-slate-300 rounded-xl px-3 py-2.5 font-semibold" data-testid="shopfloor-station"><option value="">Tüm istasyonlar</option>{stations.map((s) => <option key={s} value={s}>{s}</option>)}</select>
          <button onClick={load} className="p-2.5 bg-white border-2 border-slate-300 rounded-xl" title="Yenile" data-testid="shopfloor-refresh"><RefreshCw className="w-4 h-4" /></button>
          <button onClick={() => setKiosk(!kiosk)} className="flex items-center gap-1 px-3 py-2.5 bg-slate-900 text-white rounded-xl font-semibold" data-testid="shopfloor-kiosk">{kiosk ? <Minimize2 className="w-4 h-4" /> : <Maximize2 className="w-4 h-4" />} {kiosk ? "Çık" : "Tablet Modu"}</button>
        </div>
      </div>
      {!kiosk && <ProductionAiAdvisor companyId={companyId} compact />}
      {!operator && <div className="bg-amber-50 border border-amber-200 rounded-lg px-2.5 py-1.5 text-[11px] text-amber-800 font-semibold" data-testid="shopfloor-no-operator">Operatör seçin ve şifrenizi girin.</div>}
      {operator && !pauseAllowed && (
        <div className="bg-slate-100 border border-slate-200 rounded-lg px-2.5 py-1.5 text-[11px] text-slate-700" data-testid="shopfloor-pause-blocked">
          Duraklat kapalı: {pausePolicy?.reason || "Mesai / mola / fazla mesai dışında."}
          {pausePolicy?.deadline ? ` (otomatik: ${pausePolicy.deadline})` : ""}
        </div>
      )}
      {operator && pauseAllowed && pausePolicy?.phase && pausePolicy.phase !== "mesai" && (
        <div className="bg-orange-50 border border-orange-100 rounded-lg px-2.5 py-1 text-[11px] text-orange-800 font-semibold" data-testid="shopfloor-pause-phase">
          Duraklat aktif — {shopFloorPausePhaseLabel(pausePolicy.phase)}
          {pausePolicy.deadline ? ` · ${pausePolicy.deadline}` : ""}
        </div>
      )}
      <label
        className="inline-flex items-center gap-2 cursor-pointer select-none rounded-lg border border-slate-200 bg-white px-2.5 py-1.5 hover:bg-slate-50 max-w-full"
        title="Açıkken iş emirleri istasyona göre gruplanır; kalan adımlar peşi sıra yeniden sıralanır."
        data-testid="shopfloor-group-station-wrap"
      >
        <input
          type="checkbox"
          checked={!!groupSameStation}
          disabled={groupBusy}
          onChange={(e) => toggleGroupSameStation(e.target.checked)}
          className="rounded border-slate-300 text-emerald-600 focus:ring-emerald-500"
          data-testid="shopfloor-group-same-station"
        />
        <span className="font-semibold text-slate-800 text-xs whitespace-nowrap">Aynı istasyonu peşi sıra işle</span>
      </label>
      <div className="grid grid-cols-3 gap-2 text-center" data-testid="shopfloor-stats">
        {[
          ["Hazır", wos.filter((w) => w.status === "ready").length, "text-blue-600"],
          ["Devam Eden", wos.filter((w) => ["in_progress", "paused"].includes(w.status)).length, "text-amber-600"],
          ["Bugün Biten", done.filter((w) => (w.finished_at || "").startsWith(new Date().toISOString().slice(0, 10))).length, "text-emerald-600"],
        ].map(([l, v, c]) => (
          <div key={l} className="bg-white border rounded-xl px-2 py-1.5">
            <div className="text-[9px] uppercase font-semibold text-slate-400 leading-none">{l}</div>
            <div className={`text-lg font-black leading-tight ${c}`}>{v}</div>
          </div>
        ))}
      </div>
      <div className="bg-white border rounded-2xl p-3" data-testid="shopfloor-performance">
        <button onClick={() => setShowPerf(!showPerf)} className="w-full flex items-center justify-between text-sm font-bold text-slate-800" data-testid="shopfloor-perf-toggle"><span>Bugünkü Performans — operatör / istasyon ({perf?.total_done || 0} adım tamamlandı)</span><span className="text-xs text-slate-400">{showPerf ? "Gizle" : "Göster"}</span></button>
        {showPerf && perf && (
          <div className="grid md:grid-cols-2 gap-3 mt-3 text-xs">
            {[["Operatörler", perf.operators], ["İstasyonlar", perf.stations]].map(([t, list]) => (
              <div key={t}><div className="font-semibold text-slate-500 mb-1">{t}</div>
                <table className="w-full"><thead className="text-slate-400 uppercase text-[10px] border-b"><tr><th className="text-left py-1">Ad</th><th className="text-right py-1">Adım</th><th className="text-right py-1">Üretim</th><th className="text-right py-1">Fire %</th><th className="text-right py-1">Ort. dk</th><th className="text-right py-1">Hedef Aşımı</th></tr></thead>
                  <tbody className="divide-y">{list.length === 0 && <tr><td colSpan={6} className="py-3 text-center text-slate-400">Bugün tamamlanan adım yok.</td></tr>}{list.map((r) => <tr key={r.name} data-testid={`perf-row-${r.name}`}><td className="py-1 font-semibold">{r.name}</td><td className="py-1 text-right">{r.done}</td><td className="py-1 text-right font-bold">{r.produced}</td><td className={`py-1 text-right font-semibold ${r.scrap_rate > 5 ? "text-rose-600" : "text-slate-600"}`}>%{r.scrap_rate}</td><td className="py-1 text-right">{r.avg_min ?? "-"}</td><td className={`py-1 text-right ${r.over_target ? "text-rose-600 font-bold" : ""}`}>{r.over_target}</td></tr>)}</tbody></table></div>))}
          </div>
        )}
      </div>
      {openDuties.length > 0 && (
        <div data-testid="shopfloor-duties">
          <h2 className="text-sm font-bold text-slate-700 mb-2">Atanan Görevler ({openDuties.length} açık)</h2>
          <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-3">
            {openDuties.map((t, i) => (
              <AssignedDutyCard
                key={t.id || i}
                duty={t}
                index={i}
                testId={`shopfloor-duty-${t.id || i}`}
                approveBusy={dutyBusyId === t.id}
                onApprove={() => approveDuty(t)}
                onChanged={() => load()}
              />
            ))}
          </div>
        </div>
      )}
      {mine.length > 0 && <div><h2 className="text-sm font-bold text-slate-700 mb-2">Benim İşlerim ({mine.length})</h2>{renderWoGrid(mine)}</div>}
      <div><h2 className="text-sm font-bold text-slate-700 mb-2">Açık İş Emirleri ({active.length})</h2>
        {active.length === 0 && <div className="bg-white border border-dashed rounded-2xl p-10 text-center text-sm text-slate-400" data-testid="shopfloor-empty">Bekleyen iş emri yok. Üretim &amp; Reçete sayfasından "Üretim Emri Ver" ile oluşturun.</div>}
        {renderWoGrid(active.filter((w) => !mine.includes(w)))}</div>
      {waiting.length > 0 && <div><h2 className="text-sm font-bold text-slate-500 mb-2">Sıradaki Adımlar ({waiting.length})</h2>{renderWoGrid(waiting)}</div>}
      {done.length > 0 && (
        <div className="flex flex-wrap items-center gap-2">
          <button
            type="button"
            onClick={trashCompleted}
            disabled={trashBusy}
            className="inline-flex items-center gap-1.5 text-xs font-semibold text-rose-600 hover:text-rose-800 disabled:opacity-60"
            data-testid="shopfloor-trash-done"
          >
            {trashBusy ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Trash2 className="w-3.5 h-3.5" />}
            Tamamlananları çöpe taşı ({done.length})
          </button>
          <span className="text-[10px] text-slate-400">Çöp kutusundan 30 gün içinde geri getirilebilir.</span>
        </div>
      )}
          {finishing && (() => {
        const plan = workOrderFinishPlan(finishing);
        const entered = Number(fin.produced_qty) + Number(fin.scrap_qty || 0);
        const overPlan = entered > Number(plan.qty || 0) + 1e-9;
        const underPlan = Number(plan.qty || 0) > 0 && entered < Number(plan.qty || 0) - 1e-9;
        return (
        <div className="fixed inset-0 z-[110] bg-slate-900/60 flex items-center justify-center p-4" {...backdropDismissProps(() => setFinishing(null))}>
          <div className="bg-white rounded-2xl max-w-md w-full p-6 space-y-4" onClick={(e) => e.stopPropagation()} data-testid="wo-finish-modal">
            <h3 className="font-bold text-slate-900 text-lg">{finishing.step_name} — Bitir</h3>
            <p className="text-sm text-slate-500">
              {finishing.order_code} • {finishing.product_name} • Plan {plan.qty} {plan.unit}
              {plan.isMaterial && plan.materialName ? ` (${plan.materialName})` : ""}
            </p>
            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className="block text-xs font-semibold mb-1">Üretilen ({plan.unit})</label>
                <input type="number" min="0" step="any" value={fin.produced_qty} onChange={(e) => setFin({ ...fin, produced_qty: e.target.value })} className="w-full border-2 rounded-xl p-3 text-xl font-bold text-center" data-testid="wo-finish-produced" />
              </div>
              <div><label className="block text-xs font-semibold mb-1">Fire / Hatalı</label><input type="number" min="0" step="any" value={fin.scrap_qty} onChange={(e) => setFin({ ...fin, scrap_qty: e.target.value })} className="w-full border-2 rounded-xl p-3 text-xl font-bold text-center text-rose-600" data-testid="wo-finish-scrap" /></div>
            </div>
            {overPlan && (
              <p className="text-xs text-amber-800 bg-amber-50 border border-amber-200 rounded-lg p-2" data-testid="wo-finish-over-hint">
                Plan üstü: {plan.qty} {plan.unit} planlandı, siz {entered} giriyorsunuz — stok buna göre işlenir.
              </p>
            )}
            {underPlan && (
              <p className="text-xs text-sky-800 bg-sky-50 border border-sky-200 rounded-lg p-2" data-testid="wo-finish-under-hint">
                Plan altı: {plan.qty} {plan.unit} planlandı, siz {entered} giriyorsunuz — stok buna göre işlenir.
              </p>
            )}
            <input value={fin.notes} onChange={(e) => setFin({ ...fin, notes: e.target.value })} placeholder="Not (isteğe bağlı)" className="w-full border rounded-xl p-3" data-testid="wo-finish-notes" />
            {finishing.step_no === finishing.step_count && (
              <p className="text-xs text-emerald-700 bg-emerald-50 rounded-lg p-2">
                Son adım: {plan.isMaterial
                  ? `girilen hammadde stoğundan düşülür; mamul stoka ${finishing.planned_quantity} ${finishing.unit} yazılır`
                  : "üretilen miktar mamul stoğa eklenir, hammaddeler buna göre düşülür (fazla/eksik dahil)"}.
              </p>
            )}
            {plan.isMaterial && finishing.step_no !== finishing.step_count && (
              <p className="text-xs text-slate-600 bg-slate-50 rounded-lg p-2">
                Hammadde adımı: girilen üretilen + fire miktarı stoktan hemen düşülür.
              </p>
            )}
            <div className="flex gap-2"><button onClick={() => setFinishing(null)} className="flex-1 py-3 border-2 rounded-xl font-semibold">İptal</button><button onClick={() => act(finishing, "finish", { produced_qty: Number(fin.produced_qty), scrap_qty: Number(fin.scrap_qty), notes: fin.notes })} className="flex-1 py-3 bg-emerald-600 text-white rounded-xl font-bold" data-testid="wo-finish-confirm">Tamamla</button></div>
          </div>
        </div>
        );
      })()}
      {pendingEmp && (
        <div className="fixed inset-0 z-[120] bg-slate-900/60 flex items-center justify-center p-4" {...backdropDismissProps(cancelUnlock)}>
          <form onSubmit={unlockOperator} onClick={(e) => e.stopPropagation()} className="bg-white rounded-2xl max-w-sm w-full p-6 space-y-4" data-testid="shopfloor-pin-modal">
            <div className="flex items-start justify-between gap-2">
              <div>
                <h3 className="font-bold text-slate-900 text-lg flex items-center gap-2"><KeyRound className="w-5 h-5 text-emerald-600" /> Operatör şifresi</h3>
                <p className="text-sm text-slate-500 mt-1">{pendingEmp.full_name} — {pendingEmp.position}</p>
                <p className="text-[11px] text-amber-700 mt-1">Mesaim girişi yapılmamış personel operatör olamaz.</p>
              </div>
              <button type="button" onClick={cancelUnlock} className="text-slate-400 hover:text-slate-700" data-testid="shopfloor-pin-cancel"><X className="w-5 h-5" /></button>
            </div>
            <div>
              <label className="block text-xs font-semibold mb-1">Şifre</label>
              <input type="password" autoFocus value={pin} onChange={(e) => setPin(e.target.value)} className="w-full border-2 rounded-xl p-3 text-lg font-semibold tracking-widest" required minLength={4} data-testid="shopfloor-pin-input" />
            </div>
            {unlockErr && <div className="text-xs text-rose-700 bg-rose-50 border border-rose-200 rounded-lg px-3 py-2" data-testid="shopfloor-pin-error">{unlockErr}</div>}
            <div className="flex gap-2">
              <button type="button" onClick={cancelUnlock} className="flex-1 py-3 border-2 rounded-xl font-semibold">Vazgeç</button>
              <button type="submit" disabled={unlockBusy || pin.length < 4} className="flex-1 py-3 bg-emerald-600 text-white rounded-xl font-bold flex items-center justify-center gap-1.5 disabled:opacity-60" data-testid="shopfloor-pin-submit">{unlockBusy ? <Loader2 className="w-4 h-4 animate-spin" /> : <KeyRound className="w-4 h-4" />} Giriş</button>
            </div>
          </form>
        </div>
      )}
      {trashTarget && (
        <div className="fixed inset-0 z-[120] bg-slate-900/60 flex items-center justify-center p-4" {...backdropDismissProps(cancelTrashRequest)}>
          <form onSubmit={confirmTrashRequest} onClick={(e) => e.stopPropagation()} className="bg-white rounded-2xl max-w-sm w-full p-6 space-y-4" data-testid="wo-trash-request-modal">
            <div className="flex items-start justify-between gap-2">
              <div>
                <h3 className="font-bold text-slate-900 text-lg flex items-center gap-2"><Trash2 className="w-5 h-5 text-rose-600" /> Yönetici onayına gönder</h3>
                <p className="text-sm text-slate-500 mt-1">{trashTarget.order_code} · {trashTarget.step_name}</p>
                <p className="text-[11px] text-slate-500 mt-1">Talep yöneticiye iletilir; onaylanınca üretim emri ve adımlar çöp kutusuna taşınır.</p>
              </div>
              <button type="button" onClick={cancelTrashRequest} className="text-slate-400 hover:text-slate-700" data-testid="wo-trash-request-cancel"><X className="w-5 h-5" /></button>
            </div>
            {trashReqErr && <div className="text-xs text-rose-700 bg-rose-50 border border-rose-200 rounded-lg px-3 py-2" data-testid="wo-trash-request-error">{trashReqErr}</div>}
            <div className="flex gap-2">
              <button type="button" onClick={cancelTrashRequest} className="flex-1 py-3 border-2 rounded-xl font-semibold">Vazgeç</button>
              <button type="submit" disabled={trashReqBusy} className="flex-1 py-3 bg-rose-600 text-white rounded-xl font-bold flex items-center justify-center gap-1.5 disabled:opacity-60" data-testid="wo-trash-request-confirm">{trashReqBusy ? <Loader2 className="w-4 h-4 animate-spin" /> : <Trash2 className="w-4 h-4" />} Onaya gönder</button>
            </div>
          </form>
        </div>
      )}
    </div>
  );
}
