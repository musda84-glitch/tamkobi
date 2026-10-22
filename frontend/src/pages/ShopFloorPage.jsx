import React, { useEffect, useState, useCallback, useRef } from "react";
import axios from "axios";
import { toast } from "sonner";
import { useMesaimGate } from "../context/MesaimGateContext";
import { bindMesaimLockedInterceptor } from "../utils/mesaimLockClient";
import { Factory, Play, Pause, CheckCircle2, Clock, User, Maximize2, Minimize2, RefreshCw, Folder, Package, X, Loader2, FileText, Trash2, ArrowDownUp } from "lucide-react";
import { API_URL, useAuth } from "../context/AuthContext";
import { stationNamesFromParks } from "../utils/workParks";
import { AssignedDutyCard } from "../components/AssignedDutyCard";
import { HoverImageThumb } from "../utils/HoverImageThumb";
import { openAssignedDuties } from "../utils/assignedDuty";
import { operatorStationLock, operatorStationLockMessage, pausedForLabel, shopFloorCardActions, shopFloorCardBorder, shopFloorPausePhaseLabel, sortWorkOrdersByStatus, workOrderFinishPlan, workOrderQtyLabel } from "../utils/shopFloorActions";
import ShopfloorPinPad from "../components/ShopfloorPinPad";
import { clearOperatorSession, isAtolyeAccount, isOperatorSessionError, isSessionExpired, isValidPin, loadOperatorSession, operatorHeaders, saveOperatorSession, unlockErrorMessage } from "../utils/shopfloorOperatorSession";
import { backdropDismissProps } from "../utils/modalBackdrop";
import { groupWorkOrdersByStation, shopFloorStationSections } from "../utils/recipeStationOrder";
import { cardTags, cardTitle, matchesLinkFilter, normalizeShopfloorFilters, projectColor, projectFilterLabel, recipeFilterLabel, shopfloorFiltersQuery, stationBannerColor, stationColor, workOrderListQuery } from "../utils/shopFloorCardMeta";
import { formatTrQty } from "../utils/money";
import { QuantityInput } from "../components/MoneyInput";
import { useLivePoll } from "../hooks/useLivePoll";
import { activeCompanyId } from "../utils/activeCompanyId";
import NoCompanyNotice from "../components/NoCompanyNotice";

const woId = (w) => String(w?.id || w?._id || "");

const STATUS = { waiting: ["Bekliyor", "bg-slate-100 text-slate-500"], ready: ["Hazır", "bg-blue-50 text-blue-700"], in_progress: ["Devam Ediyor", "bg-amber-50 text-amber-700"], paused: ["Duraklatıldı", "bg-orange-50 text-orange-700"], done: ["Tamamlandı", "bg-emerald-50 text-emerald-700"] };

function WoStepBar({ w }) {
  const count = Number(w?.step_count);
  const parts = Number.isFinite(count) && count > 1 ? count : 1;
  const current = Number(w?.step_no);
  return (
    <div className="flex gap-1" data-testid={`wo-stepbar-${w.order_code}-${w.step_no}`}>
      {Array.from({ length: parts }, (_, i) => {
        const n = i + 1;
        const here = parts > 1 && n === current;
        return (
          <span
            key={n}
            className={`flex-1 rounded-full ${parts === 1 ? "h-1 bg-slate-200" : here ? "h-1.5 bg-slate-800" : "h-1.5 bg-slate-200"}`}
          />
        );
      })}
    </div>
  );
}

export default function ShopFloorPage() {
  const { activeCompany, user } = useAuth();
  const atolye = isAtolyeAccount(user);
  const userId = String(user?.id || user?._id || "");
  const { refresh: refreshMesaimGate } = useMesaimGate();
  const companyId = activeCompanyId(activeCompany);
  useEffect(() => bindMesaimLockedInterceptor(axios, refreshMesaimGate), [refreshMesaimGate]);
  const [wos, setWos] = useState([]);
  /** İstasyon filtresinden bağımsız in_progress listesi — operatör kilit kontrolü için */
  const [lockWos, setLockWos] = useState([]);
  const [operators, setOperators] = useState([]);
  const [stations, setStations] = useState([]);
  const [operator, setOperator] = useState("");
  const [operatorSession, setOperatorSession] = useState(null);
  const [linkedName, setLinkedName] = useState("");
  const [station, setStation] = useState(() => localStorage.getItem("nx_station") || "");
  const [projectId, setProjectId] = useState("");
  const [recipeId, setRecipeId] = useState("");
  const [filterCatalog, setFilterCatalog] = useState({ projects: [], recipes: [] });
  const [groupSameStation, setGroupSameStation] = useState(() => localStorage.getItem("nx_group_same_station") === "1");
  const [groupBusy, setGroupBusy] = useState(false);
  const [pendingOp, setPendingOp] = useState(null);
  const [unlockBusy, setUnlockBusy] = useState(false);
  const [unlockErr, setUnlockErr] = useState("");
  const [kiosk, setKiosk] = useState(false);
  const [finishing, setFinishing] = useState(null);
  const [fin, setFin] = useState({ produced_qty: 0, scrap_qty: 0, notes: "" });
  const [trashBusy, setTrashBusy] = useState(false);
  const [duties, setDuties] = useState([]);
  const [dutyBusyId, setDutyBusyId] = useState(null);
  const [trashTarget, setTrashTarget] = useState(null);
  const [trashReqBusy, setTrashReqBusy] = useState(false);
  const [trashReqErr, setTrashReqErr] = useState("");
  const [pausePolicy, setPausePolicy] = useState({ allowed: true, phase: "mesai", reason: null, deadline: null });
  const [loadError, setLoadError] = useState("");
  const [statusFilter, setStatusFilter] = useState(null);
  const [detailOpen, setDetailOpen] = useState({});
  const [now, setNow] = useState(() => new Date());

  const loadPausePolicy = useCallback(async (opName) => {
    if (!opName) {
      if (!atolye) {
        setPausePolicy({ allowed: true, phase: "mesai", reason: null, deadline: null });
        return;
      }
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
  }, [companyId, atolye]);

  const load = useCallback(async () => {
    if (!companyId) {
      setLoadError("Firma seçili değil");
      setWos([]);
      return;
    }
    try {
      const bust = `_=${Date.now()}`;
      const headers = { "Cache-Control": "no-cache", Pragma: "no-cache" };
      const listQs = workOrderListQuery({ companyId, station, projectId, recipeId, bust });
      const filterQs = shopfloorFiltersQuery({ companyId, station });
      const [w, lockRows, ops, s, filters, parks, me] = await Promise.all([
        axios.get(`${API_URL}/production/work-orders?${listQs}`, {
          headers,
        }),
        // Tablet istasyona kilitliyken başka istasyondaki in_progress'i de gör (UI kilidi)
        station
          ? axios.get(`${API_URL}/production/work-orders?company_id=${companyId}&status=in_progress&${bust}`, { headers }).catch(() => ({ data: [] }))
          : Promise.resolve(null),
        atolye
          ? axios.get(`${API_URL}/production/work-orders/shopfloor-operators`, { params: { company_id: companyId } }).catch(() => ({ data: [] }))
          : Promise.resolve({ data: [] }),
        axios.get(`${API_URL}/production/work-orders/stations?company_id=${companyId}`).catch(() => ({ data: [] })),
        axios.get(`${API_URL}/production/work-orders/shopfloor-filters${filterQs ? `?${filterQs}` : ""}`).catch(() => ({ data: { projects: [], recipes: [] } })),
        axios.get(`${API_URL}/companies/${companyId}/work-parks`).catch(() => ({ data: { parks: [] } })),
        axios.get(`${API_URL}/personnel/me`, { withCredentials: true }).catch(() => ({ data: { tasks: [] } })),
      ]);
      const list = Array.isArray(w.data) ? w.data : [];
      setWos(list);
      setLockWos(station ? (Array.isArray(lockRows?.data) ? lockRows.data : []) : list);
      setOperators(Array.isArray(ops?.data) ? ops.data : []);
      setStations(stationNamesFromParks(parks.data?.parks, Array.isArray(s.data) ? s.data : []));
      setFilterCatalog(normalizeShopfloorFilters(filters?.data));
      setDuties(Array.isArray(me.data?.tasks) ? me.data.tasks : []);
      setLinkedName(String(me.data?.employee?.full_name || "").trim());
      setLoadError("");
    } catch {
      setLoadError("Yetkiniz yok / yüklenemedi");
    }
  }, [companyId, station, atolye, projectId, recipeId]);
  // Mobil bitişin tablete yansıması: 5 sn poll + sekme/focus'ta anında yenile
  useLivePoll(load, { intervalMs: 5000 });
  const skipLinkReload = useRef(true);
  useEffect(() => {
    if (skipLinkReload.current) {
      skipLinkReload.current = false;
      return;
    }
    load();
  }, [station, projectId, recipeId, load]);
  useEffect(() => {
    loadPausePolicy(operator);
    if (!operator) return undefined;
    const t = setInterval(() => loadPausePolicy(operator), 60000);
    return () => clearInterval(t);
  }, [operator, loadPausePolicy]);
  useEffect(() => { localStorage.setItem("nx_station", station); }, [station]);
  useEffect(() => { localStorage.setItem("nx_group_same_station", groupSameStation ? "1" : "0"); }, [groupSameStation]);
  useEffect(() => {
    if (!companyId) return undefined;
    axios.get(`${API_URL}/production/work-orders/shopfloor-settings`, { params: { company_id: companyId } })
      .then((r) => {
        if (typeof r.data?.group_same_station === "boolean") {
          setGroupSameStation(r.data.group_same_station);
          localStorage.setItem("nx_group_same_station", r.data.group_same_station ? "1" : "0");
        }
      })
      .catch(() => {});
  }, [companyId]);
  useEffect(() => {
    const t = setInterval(() => setNow(new Date()), 60000);
    return () => clearInterval(t);
  }, []);

  const ownName = linkedName || String(user?.name || "").trim();
  useEffect(() => {
    if (!atolye) {
      setOperator(ownName);
      setOperatorSession(null);
      setPendingOp(null);
      return;
    }
    if (!companyId || !userId) return;
    const saved = loadOperatorSession(companyId, userId);
    if (!saved || isSessionExpired(saved, new Date())) {
      if (saved) {
        clearOperatorSession(companyId, userId);
        toast.error("Operatör oturumu sona erdi, yeniden PIN girin.");
      }
      setOperatorSession(null);
      setOperator("");
      return;
    }
    setOperatorSession(saved);
    setOperator(saved.operator_name || "");
  }, [atolye, companyId, userId, ownName]);
  useEffect(() => {
    if (!atolye || !operatorSession) return;
    if (!isSessionExpired(operatorSession, now)) return;
    clearOperatorSession(companyId, userId);
    setOperatorSession(null);
    setOperator("");
    setPendingOp(null);
    setUnlockErr("");
    toast.error("Operatör oturumu sona erdi, yeniden PIN girin.");
  }, [now, atolye, operatorSession, companyId, userId]);

  const endOperatorSession = () => {
    clearOperatorSession(companyId, userId);
    setOperatorSession(null);
    setOperator("");
    setPendingOp(null);
    setUnlockErr("");
    toast.error("Operatör oturumu sona erdi, yeniden PIN girin.");
  };
  const logoutOperator = () => {
    if (atolye) clearOperatorSession(companyId, userId);
    setOperatorSession(null);
    setOperator(atolye ? "" : ownName);
    setPendingOp(null);
    setUnlockErr("");
  };
  const cancelUnlock = () => {
    setPendingOp(null);
    setUnlockErr("");
  };
  const submitPin = async (pin) => {
    if (!atolye || !pendingOp || unlockBusy) return;
    if (!isValidPin(pin)) {
      setUnlockErr("PIN 4 haneli olmalı.");
      return;
    }
    setUnlockBusy(true);
    setUnlockErr("");
    try {
      const r = await axios.post(`${API_URL}/production/work-orders/shopfloor-unlock`, {
        company_id: companyId,
        operator_type: pendingOp.operator_type,
        operator_id: pendingOp.id,
        pin,
      });
      const session = {
        token: r.data?.operator_token || "",
        operator_name: r.data?.operator_name || pendingOp.name || "",
        operator_type: r.data?.operator_type || pendingOp.operator_type || "",
        operator_id: r.data?.operator_id || pendingOp.id,
        expires_at: r.data?.expires_at || "",
      };
      saveOperatorSession(companyId, userId, session);
      setOperatorSession(session);
      setOperator(session.operator_name);
      setPendingOp(null);
      toast.success(`${session.operator_name} olarak giriş yapıldı.`);
    } catch (err) {
      const msg = unlockErrorMessage(err);
      setUnlockErr(msg);
      toast.error(msg);
    } finally {
      setUnlockBusy(false);
    }
  };

  const act = async (w, action, body) => {
    if (atolye && !operator) { toast.error("Önce operatör (personel) seçin."); return; }
    if (atolye && isSessionExpired(operatorSession, new Date())) { endOperatorSession(); return; }
    const id = woId(w);
    if (!id) { toast.error("İş emri kimliği bulunamadı."); return; }
    if (action === "start") {
      const blocker = operatorStationLock(lockWos, operator, w.station, id);
      if (blocker) {
        toast.error(operatorStationLockMessage(blocker, operator));
        return;
      }
    }
    try {
      const payload = { operator_name: operator, ...(body || {}) };
      const r = atolye
        ? await axios.post(`${API_URL}/production/work-orders/${id}/${action}`, payload, { headers: operatorHeaders(operatorSession) })
        : await axios.post(`${API_URL}/production/work-orders/${id}/${action}`, payload);
      toast.success(r.data.message);
      setFinishing(null);
      // Anında yansıt (mobil/diğer sekme ile yarışmadan önce)
      const updated = r.data?.work_order;
      if (updated && woId(updated)) {
        const uid = woId(updated);
        const patch = (prev) => {
          const hit = prev.some((x) => woId(x) === uid);
          if (hit) return prev.map((x) => (woId(x) === uid ? { ...x, ...updated } : x));
          return String(updated.status || "") === "in_progress" ? [...prev, updated] : prev;
        };
        setWos(patch);
        setLockWos((prev) => {
          if (String(updated.status || "") === "in_progress") return patch(prev);
          return prev.filter((x) => woId(x) !== uid);
        });
      }
      load();
    } catch (err) {
      if (atolye && isOperatorSessionError(err)) { endOperatorSession(); return; }
      toast.error(err.response?.data?.detail || "İşlem başarısız.");
    }
  };
  const openFinish = (w) => {
    const plan = workOrderFinishPlan(w);
    setFinishing(w);
    setFin({ produced_qty: plan.qty, scrap_qty: 0, notes: "" });
  };
  const active = wos.filter((w) => w.status !== "done" && w.status !== "waiting");
  const waiting = wos.filter((w) => w.status === "waiting");
  const done = wos.filter((w) => w.status === "done");
  const todayKey = new Date().toISOString().slice(0, 10);
  const doneToday = done.filter((w) => (w.finished_at || "").startsWith(todayKey));
  const readyCount = wos.filter((w) => w.status === "ready").length;
  const activeCount = wos.filter((w) => w.status === "in_progress" || w.status === "paused").length;
  const passesFilter = (w) => {
    if (!matchesLinkFilter(w, projectId, recipeId)) return false;
    if (statusFilter === "ready") return w.status === "ready";
    if (statusFilter === "active") return w.status === "in_progress" || w.status === "paused";
    if (statusFilter === "done") return false;
    return true;
  };
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
    } catch (err) {
      toast.error(err.response?.data?.detail || "Çöpe taşınamadı.");
    } finally {
      setTrashBusy(false);
    }
  };
  const mine = active.filter((w) => w.operator_name === operator || w.assigned_name === operator);
  const openDuties = openAssignedDuties(duties);
  const arrangeWos = (list) => {
    const rows = Array.isArray(list) ? list : [];
    // Görünüm gruplaması "Tüm istasyonlar" (boş filtre) iken her zaman açık.
    // groupSameStation yalnız backend peşi sıra sıralamasıdır.
    if (station) return sortWorkOrdersByStatus(rows);
    return shopFloorStationSections(groupWorkOrdersByStation(rows))
      .flatMap((sec) => sortWorkOrdersByStatus(sec.items));
  };
  const mineShown = mine.filter(passesFilter);
  const activeRest = active.filter((w) => !mine.includes(w) && passesFilter(w));

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
    const arranged = arrangeWos(list);
    const sections = station ? [] : shopFloorStationSections(arranged);
    if (sections.length <= 1) {
      return (
        <div className={`grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-3 items-stretch ${extraClass}`}>
          {arranged.map((w) => <Card key={w.id} w={w} />)}
        </div>
      );
    }
    return (
      <div className={`space-y-4 ${extraClass}`} data-testid="shopfloor-station-groups">
        {!companyId && <NoCompanyNotice />}
        {sections.map((sec) => {
          const banner = stationBannerColor(sec.label, sec.key);
          return (
          <div key={sec.key} data-testid={`shopfloor-station-group-${sec.key}`}>
            <div
              className={`flex items-center gap-2 mb-2 rounded-xl px-3 py-2 min-h-11 ${banner.className}`}
              style={{ backgroundColor: banner.bg, color: banner.fg }}
              data-testid={`shopfloor-station-banner-${sec.key}`}
              data-station-color={banner.id}
            >
              <ArrowDownUp className="w-3.5 h-3.5 shrink-0" />
              <h3 className="text-xs font-bold uppercase tracking-wide">{sec.label}</h3>
              <span className="text-[10px] font-semibold">(<span data-testid={`shopfloor-station-group-count-${sec.key}`}>{sec.items.length}</span> iş)</span>
            </div>
            <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-3 items-stretch">
              {sec.items.map((w) => <Card key={w.id} w={w} />)}
            </div>
          </div>
          );
        })}
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
    if (atolye && !operator) {
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
    if (atolye && isSessionExpired(operatorSession, new Date())) { endOperatorSession(); cancelTrashRequest(); return; }
    setTrashReqBusy(true);
    setTrashReqErr("");
    try {
      const payload = { company_id: companyId, operator_name: operator };
      const r = atolye
        ? await axios.post(`${API_URL}/production/work-orders/${woId(trashTarget)}/trash-request`, payload, { headers: operatorHeaders(operatorSession) })
        : await axios.post(`${API_URL}/production/work-orders/${woId(trashTarget)}/trash-request`, payload);
      toast.success(r.data?.message || "Silme talebi yöneticiye gönderildi.");
      cancelTrashRequest();
      load();
    } catch (err) {
      if (atolye && isOperatorSessionError(err)) {
        endOperatorSession();
        cancelTrashRequest();
        return;
      }
      const msg = err.response?.data?.detail || "Talep gönderilemedi.";
      setTrashReqErr(msg);
      toast.error(msg);
    } finally {
      setTrashReqBusy(false);
    }
  };

  const pauseAllowed = !!pausePolicy?.allowed;
  const toggleDetail = (w) => {
    const id = `${w.order_code}-${w.step_no}`;
    setDetailOpen((prev) => ({ ...prev, [id]: !prev[id] }));
  };
  const Card = ({ w }) => {
    const [l, c] = STATUS[w.status] || STATUS.waiting;
    const actions = shopFloorCardActions(w.status, pauseAllowed);
    const needsOperator = atolye && !operator;
    const stationLock = (actions.start || actions.resume)
      ? operatorStationLock(lockWos, operator, w.station, w.id || w._id)
      : null;
    const stationLockMsg = stationLock ? operatorStationLockMessage(stationLock, operator) : "";
    const startBlocked = needsOperator || !!stationLock;
    const pauseOn = !needsOperator && actions.pauseEnabled;
    const pauseTitle = needsOperator
      ? "Önce operatör seçin"
      : (actions.pauseEnabled
        ? `Duraklat (${shopFloorPausePhaseLabel(pausePolicy?.phase)})`
        : (pausePolicy?.reason || "Mesai / mola / fazla mesai dışında duraklatılamaz"));
    const materials = Array.isArray(w.materials) ? w.materials : [];
    const hasNotes = !!w.notes;
    const hasDetail = materials.length > 0 || hasNotes;
    const detailId = `${w.order_code}-${w.step_no}`;
    const showDetail = !!detailOpen[detailId];
    const pausedLabel = w.status === "paused" ? pausedForLabel(w.paused_at, now) : "";
    const trashDisabled = needsOperator || !!w.trash_request_pending;
    const title = cardTitle(w);
    const tags = cardTags(w);
    const projectTone = projectColor(w.project_id);
    const stationName = String(w.station || "").trim();
    const stationTone = stationName ? stationColor(stationName) : null;
    const showProductLine = title.source !== "recipe" && title.product && title.product !== title.text;
    return (
    <div
      className={`min-w-0 bg-white rounded-2xl border-2 border-l-4 p-4 h-full flex flex-col gap-3 ${shopFloorCardBorder(w.status)} ${projectTone.className}`}
      style={{ borderLeftColor: projectTone.stripe, borderLeftWidth: "4px" }}
      data-testid={`wo-card-${w.order_code}-${w.step_no}`}
      data-project-color={projectTone.id}
    >
      <div className="flex flex-wrap justify-between items-start gap-2">
        <div className="min-w-0 flex-1 basis-48">
          <div className="font-mono text-xs text-slate-400 break-all">{w.order_code} • Adım {w.step_no}/{w.step_count}</div>
          <div
            className={`font-bold text-slate-900 leading-tight line-clamp-2 break-words ${title.source === "recipe" ? "text-lg" : "text-base"}`}
            title={title.text}
            data-testid={`wo-title-${w.order_code}-${w.step_no}`}
          >{title.text}</div>
          {showProductLine ? (
            <div className="text-sm text-slate-600 flex items-start gap-1 min-w-0">
              <Package className="w-3.5 h-3.5 shrink-0 mt-0.5" />
              <span className="line-clamp-2 break-words" title={title.product}>{title.product}</span>
            </div>
          ) : null}
          {tags.length > 0 ? (
            <div className="flex flex-wrap gap-1.5 mt-1.5" data-testid={`wo-tags-${w.order_code}-${w.step_no}`}>
              {tags.map((tag) => (
                <span
                  key={tag.kind}
                  className="inline-flex max-w-full items-center gap-1 rounded-full bg-slate-100 px-2 py-1 text-[11px] font-semibold text-slate-700 break-words"
                  data-testid={`wo-tag-${tag.kind}-${w.order_code}-${w.step_no}`}
                >
                  {tag.kind === "project" ? <Folder className="w-3 h-3 shrink-0" /> : null}
                  {tag.kind === "order" ? <FileText className="w-3 h-3 shrink-0" /> : null}
                  {tag.kind === "customer" ? <User className="w-3 h-3 shrink-0" /> : null}
                  <span className="min-w-0 break-words">{tag.label}</span>
                </span>
              ))}
            </div>
          ) : null}
        </div>
        <div className="flex flex-wrap items-center justify-end gap-1 shrink-0 max-w-full">
          {stationTone ? (
            <span
              className={`inline-flex items-center rounded-full px-2.5 py-1 text-[11px] font-bold ${stationTone.className}`}
              style={{ backgroundColor: stationTone.bg, color: stationTone.fg }}
              data-testid={`wo-station-tag-${w.order_code}-${w.step_no}`}
              data-station-color={stationTone.id}
            >{stationName}</span>
          ) : null}
          {actions.pause && (
            <button
              type="button"
              onClick={() => { if (pauseOn) act(w, "pause"); }}
              disabled={!pauseOn}
              className={`p-1.5 rounded-lg border ${pauseOn ? "text-orange-600 hover:bg-orange-50 border-orange-200" : "text-slate-300 border-slate-200 cursor-not-allowed"}`}
              title={pauseTitle}
              data-testid={`wo-pause-icon-${w.order_code}-${w.step_no}`}
            >
              <Pause className="w-4 h-4" />
            </button>
          )}
          {w.status !== "done" && (
            <button
              type="button"
              onClick={() => { if (!needsOperator) openTrashRequest(w); }}
              disabled={trashDisabled}
              className={`p-1.5 rounded-lg ${!needsOperator && w.trash_request_pending ? "text-amber-500 bg-amber-50 cursor-default" : trashDisabled ? "text-slate-300 cursor-not-allowed" : "text-slate-400 hover:text-rose-600 hover:bg-rose-50"}`}
              title={needsOperator ? "Önce operatör seçin" : (w.trash_request_pending ? "Silme onayı bekleniyor" : "Yönetici onayına gönder (sil)")}
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
      <WoStepBar w={w} />
      {pausedLabel ? (
        <div className="flex flex-wrap items-center gap-2 text-xs font-semibold text-orange-800" data-testid={`wo-paused-for-${w.order_code}-${w.step_no}`}>
          <span>⏸ {pausedLabel} duraklatıldı</span>
          <span>{w.auto_paused ? "Otomatik (mesai dışı)" : "Elle"}</span>
        </div>
      ) : null}
      <div className="text-xs bg-slate-50 border border-slate-100 rounded-xl px-2.5 py-2 space-y-0.5" data-testid={`wo-meta-${w.order_code}-${w.step_no}`}>
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
          const label = workOrderQtyLabel(w, plan);
          const mark = " · mamul ";
          const at = label ? label.indexOf(mark) : -1;
          const primary = at >= 0 ? label.slice(0, at) : label;
          const mamul = at >= 0 ? label.slice(at + mark.length) : null;
          return (
            <span className="font-bold text-slate-900 text-sm" data-testid={`wo-plan-${w.order_code}-${w.step_no}`}>
              {primary}
              {mamul ? <span className="ml-1 font-semibold text-slate-400">· mamul {mamul}</span> : null}
            </span>
          );
        })()}
        {w.duration_min > 0 && <span className="flex items-center gap-1"><Clock className="w-3.5 h-3.5" /> Hedef {w.duration_min} dk</span>}
        {w.elapsed_min != null && (
          <span className={`flex items-center gap-1 font-semibold ${w.duration_min && w.elapsed_min > w.duration_min ? "text-rose-600" : "text-amber-700"}`}>
            <Clock className="w-3.5 h-3.5" /> {w.status === "paused" ? `çalışılan ${w.elapsed_min} dk` : `${w.elapsed_min} dk geçti`}
          </span>
        )}
        {(w.operator_name || w.assigned_name) && <span className="flex items-center gap-1"><User className="w-3.5 h-3.5" /> {w.operator_name || w.assigned_name}</span>}
        {w.planned_date && <span>Plan: {w.planned_date}</span>}
      </div>
      {hasDetail && (
        <div>
          <button
            type="button"
            onClick={() => toggleDetail(w)}
            aria-expanded={showDetail}
            className="text-xs font-bold text-slate-600 hover:text-slate-900"
            data-testid={`wo-detail-toggle-${w.order_code}-${w.step_no}`}
          >
            Detay
          </button>
          {showDetail && (
            <div className="mt-2 space-y-2">
              {materials.length > 0 && (
                <div className="text-xs border border-slate-100 rounded-xl px-2.5 py-2 space-y-1" data-testid={`wo-materials-${w.order_code}-${w.step_no}`}>
                  <div className="font-semibold text-slate-700">Hammaddeler</div>
                  <ul className="space-y-0.5">
                    {materials.map((m, i) => {
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
              {hasNotes && <div className="text-xs bg-slate-50 rounded-lg p-2 text-slate-600">{w.notes}</div>}
            </div>
          )}
        </div>
      )}
      <div className="grid grid-cols-2 gap-2 mt-auto">
        {actions.start && (
          <button
            type="button"
            onClick={() => { if (!startBlocked) act(w, "start"); }}
            disabled={startBlocked}
            title={needsOperator ? "Önce operatör seçin" : (stationLockMsg || undefined)}
            className={`col-span-2 w-full min-h-11 flex items-center justify-center gap-2 py-3 rounded-xl font-bold text-base ${startBlocked ? "bg-slate-200 text-slate-400 cursor-not-allowed" : "bg-emerald-600 hover:bg-emerald-700 text-white"}`}
            data-testid={`wo-start-${w.order_code}-${w.step_no}`}
          >
            <Play className="w-5 h-5" /> Başla
          </button>
        )}
        {actions.pause && (
          <button
            type="button"
            onClick={() => { if (pauseOn) act(w, "pause"); }}
            disabled={!pauseOn}
            title={pauseTitle}
            className={`min-h-11 flex items-center justify-center gap-2 py-3.5 rounded-xl font-bold text-base ${pauseOn ? "bg-orange-500 hover:bg-orange-600 text-white shadow-sm shadow-orange-500/30" : "bg-slate-200 text-slate-400 cursor-not-allowed"}`}
            data-testid={`wo-pause-${w.order_code}-${w.step_no}`}
          >
            <Pause className="w-5 h-5" /> Duraklat
          </button>
        )}
        {actions.resume && (
          <button
            type="button"
            onClick={() => { if (!startBlocked) act(w, "start"); }}
            disabled={startBlocked}
            title={needsOperator ? "Önce operatör seçin" : (stationLockMsg || undefined)}
            className={`min-h-11 flex items-center justify-center gap-2 py-3 rounded-xl font-bold ${startBlocked ? "bg-slate-200 text-slate-400 cursor-not-allowed" : "bg-emerald-600 hover:bg-emerald-700 text-white"}`}
            data-testid={`wo-resume-${w.order_code}-${w.step_no}`}
          >
            <Play className="w-5 h-5" /> Devam
          </button>
        )}
        {actions.finish && (
          <button
            type="button"
            onClick={() => { if (!needsOperator) openFinish(w); }}
            disabled={needsOperator}
            title={needsOperator ? "Önce operatör seçin" : undefined}
            className={`min-h-11 flex items-center justify-center gap-2 py-3 rounded-xl font-bold ${needsOperator ? "bg-slate-200 text-slate-400 cursor-not-allowed" : "bg-slate-900 hover:bg-slate-800 text-white"}`}
            data-testid={`wo-finish-${w.order_code}-${w.step_no}`}
          >
            <CheckCircle2 className="w-5 h-5" /> Bitir
          </button>
        )}
        {needsOperator && w.status !== "done" ? (
          <div className="col-span-2 text-center text-[11px] font-semibold text-amber-800 bg-amber-50 border border-amber-100 rounded-lg px-2 py-1.5" data-testid={`wo-need-operator-${w.order_code}-${w.step_no}`}>
            Önce operatör seçin
          </div>
        ) : null}
        {stationLockMsg ? (
          <div className="col-span-2 text-center text-[11px] text-amber-800 bg-amber-50 border border-amber-100 rounded-lg px-2 py-1.5" data-testid={`wo-station-lock-${w.order_code}-${w.step_no}`}>
            {stationLockMsg}
          </div>
        ) : null}
        {operator && w.status === "waiting" && actions.start && !stationLock && (
          <div className="col-span-2 text-center text-[11px] text-slate-400 -mt-1">Önceki adım bitmeden de başlatılabilir</div>
        )}
        {w.status === "done" && <div className="col-span-2 text-center text-xs text-emerald-700 py-2 font-semibold">{w.produced_qty} üretildi{w.scrap_qty ? `, ${w.scrap_qty} fire` : ""} • {w.operator_name}</div>}
      </div>
    </div>); };

  const statClass = (on, tone) => (on ? tone : "border-slate-200 bg-white");
  const stationBadges = Array.isArray(user?.shopfloor_stations) ? user.shopfloor_stations.filter(Boolean) : [];

  return (
    <div className={kiosk ? "fixed inset-0 z-[100] bg-slate-100 overflow-y-auto overflow-x-hidden p-4 sm:p-6" : "space-y-3 overflow-x-hidden"} data-testid="shopfloor-page">
      {atolye ? (
        <div className="flex flex-wrap items-center gap-2 rounded-xl border border-slate-200 bg-white px-3 py-2 text-sm" data-testid="shopfloor-atolye-banner">
          <span className="font-semibold text-slate-900" data-testid="shopfloor-atolye-account">{user?.name || "Atölye"} · Atölye kullanıcısı</span>
          {stationBadges.map((name) => (
            <span key={name} className="rounded-full bg-slate-100 px-2 py-0.5 text-[11px] font-semibold text-slate-700" data-testid={`shopfloor-station-badge-${name}`}>{name}</span>
          ))}
        </div>
      ) : null}
      <div className="flex flex-col lg:flex-row lg:items-center justify-between gap-3">
        <div><h1 className="text-xl sm:text-2xl font-bold text-slate-900 tracking-tight flex items-center gap-2"><Factory className="w-6 h-6 text-emerald-600" /> Üretim Ekranı (Atölye)</h1><p className="text-xs sm:text-sm text-slate-500">Makine başındaki tabletten iş emirlerini görün, adımları başlatın / bitirin</p></div>
        <div className="flex flex-wrap items-center gap-2 text-sm max-w-full min-w-0">
          {(atolye ? !!operator : true) ? (
            <span className="inline-flex items-center gap-1.5 rounded-xl border border-emerald-200 bg-emerald-50 px-3 py-2 min-h-11 max-w-full text-sm font-semibold text-emerald-800" data-testid="shopfloor-operator-chip">
              <User className="w-4 h-4 shrink-0" />
              {atolye ? (
                <>
                  <span>{operator}</span>
                  <span aria-hidden="true">·</span>
                  <button type="button" onClick={logoutOperator} className="font-semibold underline underline-offset-2" data-testid="shopfloor-operator-change">değiştir</button>
                  <span aria-hidden="true">·</span>
                  <button type="button" onClick={logoutOperator} className="font-semibold underline underline-offset-2" data-testid="shopfloor-operator-logout">Çıkış</button>
                </>
              ) : (
                <span>Operatör: {operator || "—"}</span>
              )}
            </span>
          ) : null}
          <select value={station} onChange={(e) => setStation(e.target.value)} aria-label="İstasyon" className="bg-white border-2 border-slate-300 rounded-xl px-3 py-2.5 min-h-11 min-w-0 max-w-full w-[calc(50%-0.25rem)] sm:w-auto sm:max-w-xs font-semibold" data-testid="shopfloor-station"><option value="">Tüm istasyonlar</option>{stations.map((s) => <option key={s} value={s}>{s}</option>)}</select>
          <select value={projectId} onChange={(e) => setProjectId(e.target.value)} aria-label="Proje" className="bg-white border-2 border-slate-300 rounded-xl px-3 py-2.5 min-h-11 min-w-0 max-w-full w-[calc(50%-0.25rem)] sm:w-auto sm:max-w-xs font-semibold" data-testid="shopfloor-project">
            <option value="">Proje: Tüm projeler</option>
            {filterCatalog.projects.map((row) => (
              <option key={row.project_id} value={String(row.project_id)}>{projectFilterLabel(row)}</option>
            ))}
          </select>
          <select value={recipeId} onChange={(e) => setRecipeId(e.target.value)} aria-label="Reçete" className="bg-white border-2 border-slate-300 rounded-xl px-3 py-2.5 min-h-11 min-w-0 max-w-full w-[calc(50%-0.25rem)] sm:w-auto sm:max-w-xs font-semibold" data-testid="shopfloor-recipe">
            <option value="">Reçete: Tüm reçeteler</option>
            {filterCatalog.recipes.map((row) => (
              <option key={row.recipe_id} value={String(row.recipe_id)}>{recipeFilterLabel(row)}</option>
            ))}
          </select>
          <button onClick={load} className="p-2.5 min-h-11 min-w-11 shrink-0 bg-white border-2 border-slate-300 rounded-xl" title="Yenile" data-testid="shopfloor-refresh"><RefreshCw className="w-4 h-4" /></button>
          <button onClick={() => setKiosk(!kiosk)} className="flex items-center justify-center gap-1 px-3 py-2.5 min-h-11 min-w-0 max-w-full w-[calc(50%-0.25rem)] sm:w-auto bg-slate-900 text-white rounded-xl font-semibold" data-testid="shopfloor-kiosk">{kiosk ? <Minimize2 className="w-4 h-4" /> : <Maximize2 className="w-4 h-4" />} {kiosk ? "Çık" : "Tablet Modu"}</button>
        </div>
      </div>
      {atolye && !operator && (
        <div className="rounded-2xl border-2 border-amber-400 bg-amber-50 px-4 py-4 shadow-sm sm:px-6 sm:py-5" data-testid="shopfloor-no-operator">
          <h2 className="text-lg font-bold text-amber-950">Operatör seçin</h2>
          <p className="text-sm text-amber-800 mb-3">Başla / Devam / Bitir operatör PIN girişinden sonra açılır.</p>
          {operators.length === 0 ? (
            <p className="text-sm font-semibold text-amber-900" data-testid="shopfloor-operators-empty">PIN tanımlı ve mesaiye giriş yapmış operatör yok</p>
          ) : (
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-2">
              {operators.map((op) => (
                <button
                  key={`${op.operator_type || "op"}-${op.id}`}
                  type="button"
                  onClick={() => { setPendingOp(op); setUnlockErr(""); }}
                  className="text-left rounded-xl border-2 border-white bg-white px-3 py-3 shadow-sm hover:border-orange-300"
                  data-testid={`shopfloor-operator-card-${op.id}`}
                >
                  <div className="font-bold text-slate-900">{op.name}</div>
                  {op.station ? <div className="text-xs text-slate-500 mt-0.5">{op.station}</div> : null}
                  <div className="text-[11px] font-semibold text-emerald-700 mt-1">PIN tanımlı</div>
                </button>
              ))}
            </div>
          )}
        </div>
      )}
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
        <button
          type="button"
          aria-pressed={statusFilter === "ready"}
          onClick={() => setStatusFilter((cur) => (cur === "ready" ? null : "ready"))}
          className={`border-2 rounded-xl px-2 py-1.5 ${statClass(statusFilter === "ready", "border-blue-500 bg-blue-50")}`}
          data-testid="shopfloor-stat-ready"
        >
          <div className="text-[9px] uppercase font-semibold text-slate-400 leading-none">Hazır</div>
          <div className="text-lg font-black leading-tight text-blue-600">{readyCount}</div>
        </button>
        <button
          type="button"
          aria-pressed={statusFilter === "active"}
          onClick={() => setStatusFilter((cur) => (cur === "active" ? null : "active"))}
          className={`border-2 rounded-xl px-2 py-1.5 ${statClass(statusFilter === "active", "border-amber-500 bg-amber-50")}`}
          data-testid="shopfloor-stat-active"
        >
          <div className="text-[9px] uppercase font-semibold text-slate-400 leading-none">Devam Eden</div>
          <div className="text-lg font-black leading-tight text-amber-600">{activeCount}</div>
        </button>
        <button
          type="button"
          aria-pressed={statusFilter === "done"}
          onClick={() => setStatusFilter((cur) => (cur === "done" ? null : "done"))}
          className={`border-2 rounded-xl px-2 py-1.5 ${statClass(statusFilter === "done", "border-emerald-500 bg-emerald-50")}`}
          data-testid="shopfloor-stat-done"
        >
          <div className="text-[9px] uppercase font-semibold text-slate-400 leading-none">Bugün Biten</div>
          <div className="text-lg font-black leading-tight text-emerald-600">{doneToday.length}</div>
        </button>
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
      {statusFilter !== "done" && mineShown.length > 0 && <div><h2 className="text-sm font-bold text-slate-700 mb-2">Benim İşlerim ({mineShown.length})</h2>{renderWoGrid(mineShown)}</div>}
      {statusFilter !== "done" && (
      <div><h2 className="text-sm font-bold text-slate-700 mb-2">Açık İş Emirleri ({statusFilter ? mineShown.length + activeRest.length : active.length})</h2>
        {loadError ? <div className="bg-rose-50 border border-rose-200 rounded-2xl p-6 text-center text-sm font-semibold text-rose-800" data-testid="shopfloor-load-error">{loadError}</div> : null}
        {!loadError && !statusFilter && active.length === 0 && <div className="bg-white border border-dashed rounded-2xl p-10 text-center text-sm text-slate-400" data-testid="shopfloor-empty">Bekleyen iş emri yok. Üretim &amp; Reçete sayfasından "Üretim Emri Ver" ile oluşturun.</div>}
        {renderWoGrid(activeRest)}</div>
      )}
      {!statusFilter && waiting.length > 0 && <div><h2 className="text-sm font-bold text-slate-500 mb-2">Sıradaki Adımlar ({waiting.length})</h2>{renderWoGrid(waiting)}</div>}
      {statusFilter === "done" && (
        <div>
          <h2 className="text-sm font-bold text-slate-700 mb-2">Bugün Biten ({doneToday.length})</h2>
          {renderWoGrid(doneToday)}
        </div>
      )}
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
        const mamulQty = workOrderQtyLabel(finishing, { isMaterial: false });
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
                <QuantityInput value={fin.produced_qty} onChange={(n) => setFin({ ...fin, produced_qty: n ?? "" })} className="w-full border-2 rounded-xl p-3 text-xl font-bold text-center" data-testid="wo-finish-produced" />
              </div>
              <div><label className="block text-xs font-semibold mb-1">Fire / Hatalı</label><QuantityInput value={fin.scrap_qty} onChange={(n) => setFin({ ...fin, scrap_qty: n ?? "" })} className="w-full border-2 rounded-xl p-3 text-xl font-bold text-center text-rose-600" data-testid="wo-finish-scrap" /></div>
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
              <p className="text-xs text-emerald-700 bg-emerald-50 rounded-lg p-2" data-testid="wo-finish-last-step">
                Son adım: {plan.isMaterial
                  ? `girilen hammadde stoğundan düşülür; ${mamulQty ? `mamul stoka ${mamulQty} yazılır` : "mamul stoka yazılır"}`
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
      {atolye && pendingOp && (
        <div className="fixed inset-0 z-[120] bg-slate-900/60 flex items-center justify-center p-4" {...backdropDismissProps(cancelUnlock)}>
          <div onClick={(e) => e.stopPropagation()} className="bg-white rounded-2xl max-w-sm w-full p-6" data-testid="shopfloor-pin-modal">
            <ShopfloorPinPad
              operatorName={pendingOp.name}
              station={pendingOp.station}
              error={unlockErr}
              busy={unlockBusy}
              onSubmit={submitPin}
              onCancel={cancelUnlock}
            />
          </div>
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
