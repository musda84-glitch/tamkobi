import React, { useEffect, useState, useCallback, useRef } from "react";
import axios from "axios";
import { toast } from "sonner";
import { useMesaimGate } from "../context/MesaimGateContext";
import { bindMesaimLockedInterceptor } from "../utils/mesaimLockClient";
import { Factory, Play, Pause, CheckCircle2, Clock, User, Maximize2, Minimize2, RefreshCw, X, Loader2, FileText, Trash2, ArrowDownUp } from "lucide-react";
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
import { focusJob, normalizeScrapReasons, personnelCode, shopfloorMayOperate, takeoverDetail, undoCountdown } from "../utils/shopFloorScreen";
import { DrawingViewer, FilterMenu, FocusBoard, IdleLock, OperatorPicker, PartialCountDialog, TakeoverDialog, UndoToast } from "../components/ShopFloorPanels";
import { formatTrQty } from "../utils/money";
import { QuantityInput } from "../components/MoneyInput";
import { useLivePoll } from "../hooks/useLivePoll";
import { activeCompanyId } from "../utils/activeCompanyId";
import NoCompanyNotice from "../components/NoCompanyNotice";

const woId = (w) => String(w?.id || w?._id || "");

const STATUS = { waiting: ["Bekliyor", "bg-slate-100 text-slate-600 border border-slate-200"], ready: ["Hazır", "bg-blue-50 text-blue-700 border border-blue-200"], in_progress: ["Devam ediyor", "bg-amber-50 text-amber-700 border border-amber-200"], paused: ["Duraklatıldı", "bg-orange-50 text-orange-700 border border-orange-200"], done: ["Bitti", "bg-emerald-50 text-emerald-700 border border-emerald-200"] };

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
  const [shopSettings, setShopSettings] = useState({ idle_lock_minutes: 30, undo_finish_minutes: 5, scrap_reasons: [] });
  const [partialJob, setPartialJob] = useState(null);
  const [partialBusy, setPartialBusy] = useState(false);
  const [takeover, setTakeover] = useState(null);
  const [drawing, setDrawing] = useState(null);
  const [undoToast, setUndoToast] = useState(null);
  const [idleLocked, setIdleLocked] = useState(false);
  const [idleErr, setIdleErr] = useState("");
  const [idleBusy, setIdleBusy] = useState(false);
  const [focusOpen, setFocusOpen] = useState(false);
  const [filterMenu, setFilterMenu] = useState("");
  const [scrapReason, setScrapReason] = useState(null);
  const mayOperate = shopfloorMayOperate(user);
  const passiveTitle = "Görüntüleme yetkisi";

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
        const data = r.data || {};
        if (typeof data.group_same_station === "boolean") {
          setGroupSameStation(data.group_same_station);
          localStorage.setItem("nx_group_same_station", data.group_same_station ? "1" : "0");
        }
        setShopSettings((prev) => ({
          ...prev,
          idle_lock_minutes: Number(data.idle_lock_minutes) || prev.idle_lock_minutes,
          undo_finish_minutes: Number(data.undo_finish_minutes) || prev.undo_finish_minutes,
          scrap_reasons: normalizeScrapReasons(data.scrap_reasons),
        }));
      })
      .catch(() => {});
  }, [companyId]);
  useEffect(() => {
    const t = setInterval(() => setNow(new Date()), 1000);
    return () => clearInterval(t);
  }, []);
  useEffect(() => {
    if (!atolye || !operatorSession || idleLocked) return undefined;
    const minutes = Number(shopSettings.idle_lock_minutes) || 30;
    let timer = null;
    const arm = () => {
      if (timer) clearTimeout(timer);
      timer = setTimeout(() => setIdleLocked(true), minutes * 60 * 1000);
    };
    arm();
    const bump = () => arm();
    window.addEventListener("pointerdown", bump);
    window.addEventListener("keydown", bump);
    return () => {
      if (timer) clearTimeout(timer);
      window.removeEventListener("pointerdown", bump);
      window.removeEventListener("keydown", bump);
    };
  }, [atolye, operatorSession, idleLocked, shopSettings.idle_lock_minutes]);

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

  const postOpts = (extraHeaders) => {
    const headers = { ...(extraHeaders || {}), ...(atolye ? operatorHeaders(operatorSession) : {}) };
    return Object.keys(headers).length ? { headers } : undefined;
  };
  const mediaUrl = (path) => {
    const raw = String(path || "");
    if (!raw || /^https?:/i.test(raw)) return raw;
    if (raw.startsWith("/api")) return `${String(API_URL).replace(/\/api\/?$/, "")}${raw}`;
    return raw;
  };
  const act = async (w, action, body) => {
    if (!mayOperate) { toast.error("Görüntüleme yetkisiyle iş başlatılamaz."); return; }
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
      setTakeover(null);
      const updated = r.data?.work_order;
      if (action === "finish") {
        setUndoToast({
          id: woId(updated || w),
          text: `${w.order_code} Adım ${w.step_no} bitirildi · stok işlendi`,
          finishedAt: updated?.finished_at || new Date().toISOString(),
          workOrder: updated || w,
        });
      }
      // Anında yansıt (mobil/diğer sekme ile yarışmadan önce)
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
      const takeoverInfo = takeoverDetail(err);
      if (takeoverInfo) {
        setTakeover({ w, action, body: body || {}, detail: takeoverInfo });
        return;
      }
      const detail = err.response?.data?.detail;
      toast.error(typeof detail === "string" ? detail : (detail?.message || "İşlem başarısız."));
    }
  };
  const openFinish = (w) => {
    if (!mayOperate) return;
    const plan = workOrderFinishPlan(w);
    setFinishing(w);
    setScrapReason(null);
    setFin({ produced_qty: plan.qty, scrap_qty: 0, notes: "" });
  };
  const openDrawing = async (w) => {
    const id = woId(w);
    if (!id) return;
    try {
      const r = await axios.get(`${API_URL}/production/work-orders/${id}/drawing`, postOpts());
      const data = r.data || {};
      setDrawing({
        title: `${w.order_code} Adım ${w.step_no}/${w.step_count}`,
        filename: data.filename,
        expiresIn: data.expires_in,
        url: mediaUrl(data.url),
        contentType: data.content_type,
      });
    } catch (err) {
      const detail = err.response?.data?.detail;
      const message = typeof detail === "string" ? detail : (detail?.message || "Teknik çizim açılamadı.");
      toast.error(message);
    }
  };
  const submitPartial = async (qty) => {
    if (!mayOperate || !partialJob || partialBusy) return;
    const id = woId(partialJob);
    const key = (typeof crypto !== "undefined" && crypto.randomUUID) ? crypto.randomUUID() : `pc-${Date.now()}`;
    setPartialBusy(true);
    try {
      const r = await axios.post(
        `${API_URL}/production/work-orders/${id}/partial-count`,
        { qty, operator_name: operator },
        postOpts({ "Idempotency-Key": key }),
      );
      const total = r.data?.partial_qty_total;
      if (total != null) {
        setWos((prev) => prev.map((row) => (woId(row) === id ? { ...row, partial_qty_total: total } : row)));
      }
      setPartialJob(null);
      toast.success("Ara sayım eklendi.");
      load();
    } catch (err) {
      if (atolye && isOperatorSessionError(err)) { endOperatorSession(); return; }
      const detail = err.response?.data?.detail;
      toast.error(typeof detail === "string" ? detail : (detail?.message || "Ara sayım eklenemedi."));
    } finally {
      setPartialBusy(false);
    }
  };
  const undoWork = async (w) => {
    if (!mayOperate || !w) return;
    const id = woId(w);
    try {
      const r = await axios.post(`${API_URL}/production/work-orders/${id}/undo-finish`, { operator_name: operator }, postOpts());
      toast.success(r.data?.message || "Bitirme geri alındı.");
      setUndoToast(null);
      load();
    } catch (err) {
      if (atolye && isOperatorSessionError(err)) { endOperatorSession(); return; }
      const detail = err.response?.data?.detail;
      toast.error(typeof detail === "string" ? detail : (detail?.message || "Geri alınamadı."));
    }
  };
  const submitIdlePin = async (pin) => {
    if (!operatorSession || idleBusy) return;
    setIdleBusy(true);
    setIdleErr("");
    try {
      const r = await axios.post(`${API_URL}/production/work-orders/shopfloor-unlock`, {
        company_id: companyId,
        operator_type: operatorSession.operator_type,
        operator_id: operatorSession.operator_id,
        pin,
      });
      const session = {
        token: r.data?.operator_token || operatorSession.token,
        operator_name: r.data?.operator_name || operatorSession.operator_name,
        operator_type: r.data?.operator_type || operatorSession.operator_type,
        operator_id: r.data?.operator_id || operatorSession.operator_id,
        expires_at: r.data?.expires_at || operatorSession.expires_at,
      };
      saveOperatorSession(companyId, userId, session);
      setOperatorSession(session);
      setIdleLocked(false);
    } catch (err) {
      setIdleErr(unlockErrorMessage(err));
    } finally {
      setIdleBusy(false);
    }
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
    const viewLocked = !mayOperate;
    const stationLock = (actions.start || actions.resume)
      ? operatorStationLock(lockWos, operator, w.station, w.id || w._id)
      : null;
    const stationLockMsg = stationLock ? operatorStationLockMessage(stationLock, operator) : "";
    const startBlocked = viewLocked || needsOperator || !!stationLock;
    const pauseOn = !viewLocked && !needsOperator && actions.pauseEnabled;
    const pauseTitle = viewLocked
      ? passiveTitle
      : (needsOperator
        ? "Önce operatör seçin"
        : (actions.pauseEnabled
          ? `Duraklat (${shopFloorPausePhaseLabel(pausePolicy?.phase)})`
          : (pausePolicy?.reason || "Mesai / mola / fazla mesai dışında duraklatılamaz")));
    const materials = Array.isArray(w.materials) ? w.materials : [];
    const hasNotes = !!w.notes;
    const hasDetail = materials.length > 0 || hasNotes;
    const detailId = `${w.order_code}-${w.step_no}`;
    const showDetail = !!detailOpen[detailId];
    const pausedLabel = w.status === "paused" ? pausedForLabel(w.paused_at, now) : "";
    const trashDisabled = viewLocked || needsOperator || !!w.trash_request_pending;
    const title = cardTitle(w);
    const tags = cardTags(w);
    const projectTone = projectColor(w.project_id);
    const stationName = String(w.station || "").trim();
    const stationTone = stationName ? stationColor(stationName) : null;
    return (
    <div
      className={`min-w-0 max-w-full bg-white rounded-2xl border-2 border-l-8 p-4 h-full flex flex-col gap-3 ${shopFloorCardBorder(w.status)}`}
      style={{ borderLeftColor: projectTone.stripe, borderLeftWidth: "8px" }}
      data-testid={`wo-card-${w.order_code}-${w.step_no}`}
      data-project-color={projectTone.id}
    >
      <div className="flex flex-wrap justify-between items-start gap-2">
        <div className="min-w-0 flex-1 basis-48">
          <div className="font-mono text-xs text-slate-400 break-all">{w.order_code} • Adım {w.step_no}/{w.step_count}</div>
          <div
            className={`font-bold text-slate-900 leading-tight line-clamp-2 break-words ${title.source === "recipe" ? "text-lg" : "text-base"}`}
            style={title.source === "recipe" ? { fontWeight: 800 } : undefined}
            title={title.text}
            data-testid={`wo-title-${w.order_code}-${w.step_no}`}
          >{title.text}</div>
          <div className="mt-0.5 flex flex-wrap items-center gap-1.5 min-w-0">
            {stationTone ? (
              <span
                className="inline-block whitespace-nowrap rounded-md px-2 py-0.5 text-[11px] font-extrabold text-white"
                style={{ backgroundColor: stationTone.bg, color: stationTone.fg }}
                data-testid={`wo-station-tag-${w.order_code}-${w.step_no}`}
                data-station-color={stationTone.id}
              >■ {stationName}</span>
            ) : null}
            {title.product && title.product !== title.text ? (
              <span className="text-sm text-slate-600 min-w-0 break-words">{title.product}</span>
            ) : null}
          </div>
          {tags.length > 0 ? (
            <div className="flex flex-wrap gap-1.5 mt-1.5" data-testid={`wo-tags-${w.order_code}-${w.step_no}`}>
              {tags.map((tag) => {
                const projectTag = tag.kind === "project";
                const customerTag = tag.kind === "customer";
                const prefix = projectTag ? "Proje " : (tag.kind === "order" ? "Sipariş " : "Müşteri: ");
                return (
                <span
                  key={tag.kind}
                  className={`inline-flex max-w-full items-center gap-1 rounded-md border px-1.5 py-0.5 text-[11px] font-bold break-words ${customerTag ? "border-fuchsia-300 bg-fuchsia-50 text-fuchsia-800" : projectTag ? "bg-white" : "border-slate-300 bg-slate-50 text-slate-700"}`}
                  style={projectTag ? { color: projectTone.stripe, borderColor: projectTone.stripe } : undefined}
                  data-testid={`wo-tag-${tag.kind}-${w.order_code}-${w.step_no}`}
                >
                  {projectTag ? <b className="inline-block h-2 w-2 shrink-0 rounded-full" style={{ background: projectTone.stripe }} /> : null}
                  <span className="min-w-0 break-words">{prefix}{tag.label}</span>
                </span>
                );
              })}
            </div>
          ) : null}
        </div>
        <div className="flex flex-wrap items-center justify-end gap-1 shrink-0 max-w-full">
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
          <span className={`px-2 py-1 rounded-lg text-[11px] font-bold ${c}`}>
            {l}{(w.status === "in_progress" || w.status === "paused") && (w.operator_name || w.assigned_name) ? ` · ${w.operator_name || w.assigned_name}` : ""}
          </span>
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
          <div>İstasyon: <b className="text-slate-900">{stationName || "—"}</b></div>
          <div className="flex items-center gap-1.5 min-w-0"><FileText className="w-3.5 h-3.5 shrink-0 text-slate-400" /><span className="truncate">İş dosyası: <span className="font-semibold text-slate-900">{w.job_file_name || "—"}</span></span></div>
          <div>Plan: <b className="text-slate-900" data-testid={`wo-plan-${w.order_code}-${w.step_no}`}>{(() => {
            const plan = workOrderFinishPlan(w);
            const label = workOrderQtyLabel(w, plan);
            if (!label) return "";
            const mark = " · mamul ";
            const at = label.indexOf(mark);
            if (at < 0) return label;
            return <>{label.slice(0, at)}<span className="ml-1 font-semibold text-slate-400">· mamul {label.slice(at + mark.length)}</span></>;
          })()}</b></div>
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
      {w.status === "in_progress" && w.partial_qty_total != null ? (
        <div data-testid={`wo-partial-bar-${w.order_code}-${w.step_no}`}>
          <div className="mb-1 flex justify-between text-xs text-slate-600">
            <span>Ara sayım toplamı</span>
            <b className="text-slate-900">{formatTrQty(w.partial_qty_total)} / {formatTrQty(workOrderFinishPlan(w).qty)} {workOrderFinishPlan(w).unit}</b>
          </div>
          <div className="h-2 overflow-hidden rounded-full bg-slate-200">
            <i className="block h-full bg-amber-500" style={{ width: `${Math.min(100, Math.round((Number(w.partial_qty_total) / Math.max(Number(workOrderFinishPlan(w).qty) || 1, 1)) * 100))}%` }} />
          </div>
        </div>
      ) : null}
      <div className="grid grid-cols-2 gap-2 mt-auto">
        {actions.start && (
          <button
            type="button"
            onClick={() => { if (!startBlocked) act(w, "start"); }}
            disabled={startBlocked}
            title={viewLocked ? passiveTitle : (needsOperator ? "Önce operatör seçin" : (stationLockMsg || undefined))}
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
            title={viewLocked ? passiveTitle : (needsOperator ? "Önce operatör seçin" : (stationLockMsg || undefined))}
            className={`min-h-11 flex items-center justify-center gap-2 py-3 rounded-xl font-bold ${startBlocked ? "bg-slate-200 text-slate-400 cursor-not-allowed" : "bg-emerald-600 hover:bg-emerald-700 text-white"}`}
            data-testid={`wo-resume-${w.order_code}-${w.step_no}`}
          >
            <Play className="w-5 h-5" /> Devam
          </button>
        )}
        {actions.finish && (
          <button
            type="button"
            onClick={() => { if (!needsOperator && !viewLocked) openFinish(w); }}
            disabled={needsOperator || viewLocked}
            title={viewLocked ? passiveTitle : (needsOperator ? "Önce operatör seçin" : undefined)}
            className={`min-h-11 flex items-center justify-center gap-2 py-3 rounded-xl font-bold ${needsOperator || viewLocked ? "bg-slate-200 text-slate-400 cursor-not-allowed" : "bg-slate-900 hover:bg-slate-800 text-white"}`}
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
        {w.status === "in_progress" ? (
          <button
            type="button"
            disabled={viewLocked || needsOperator}
            onClick={() => { if (!viewLocked && !needsOperator) setPartialJob(w); }}
            className={`min-h-11 flex items-center justify-center gap-2 rounded-xl border-2 border-slate-300 bg-white px-2 py-3 text-[15px] font-bold ${viewLocked || needsOperator ? "cursor-not-allowed bg-slate-200 text-slate-400" : "text-slate-900"}`}
            data-testid={`wo-partial-${w.order_code}-${w.step_no}`}
          >
            Ara sayım {w.partial_qty_total != null ? <span className="font-extrabold text-amber-700">{formatTrQty(w.partial_qty_total)}/{formatTrQty(workOrderFinishPlan(w).qty)}</span> : null}
          </button>
        ) : null}
        {(w.status === "in_progress" || w.status === "ready" || w.status === "waiting" || w.status === "paused") ? (
          <button
            type="button"
            onClick={() => openDrawing(w)}
            className={`${actions.start || w.status === "waiting" || w.status === "ready" || (w.status === "paused" && !actions.pause) ? "col-span-2 text-[13px]" : ""} min-h-11 flex items-center justify-center gap-2 rounded-xl border-2 border-blue-200 bg-blue-50 px-2 py-3 font-bold text-blue-700`}
            data-testid={`wo-drawing-${w.order_code}-${w.step_no}`}
          >
            Teknik çizim
          </button>
        ) : null}
        {w.status === "done" && (
          <div className="col-span-2 text-center text-xs text-emerald-700 py-1 font-semibold" data-testid={`wo-done-summary-${w.order_code}-${w.step_no}`}>
            {w.produced_qty} üretildi{w.scrap_qty ? `, ${w.scrap_qty} fire${w.scrap_reason_label ? ` (${w.scrap_reason_label})` : ""}` : ""} • {w.operator_name}
          </div>
        )}
        {w.status === "done" && undoCountdown(w.finished_at, shopSettings.undo_finish_minutes, now) ? (
          <button
            type="button"
            disabled={viewLocked || needsOperator}
            onClick={() => undoWork(w)}
            className="col-span-2 min-h-11 rounded-xl border-2 border-amber-400 bg-white font-bold text-amber-700 disabled:cursor-not-allowed disabled:border-slate-200 disabled:text-slate-400"
            data-testid={`wo-undo-${w.order_code}-${w.step_no}`}
          >
            Geri al ({undoCountdown(w.finished_at, shopSettings.undo_finish_minutes, now)})
          </button>
        ) : null}
      </div>
    </div>); };

  const statClass = (on, tone) => (on ? tone : "border-slate-200 bg-white");
  const stationBadges = Array.isArray(user?.shopfloor_stations) ? user.shopfloor_stations.filter(Boolean) : [];

  return (
    <div className={kiosk ? "fixed inset-0 z-[100] bg-slate-100 overflow-y-auto overflow-x-hidden p-3 sm:p-6 max-w-full" : "space-y-3 overflow-x-hidden max-w-full min-w-0"} data-testid="shopfloor-page">
      {atolye ? (
        <div className="flex flex-wrap items-center gap-2 rounded-xl border border-slate-200 bg-white px-3 py-2 text-sm" data-testid="shopfloor-atolye-banner">
          <span className="font-semibold text-slate-900" data-testid="shopfloor-atolye-account">{user?.name || "Atölye"} · Atölye kullanıcısı</span>
          {stationBadges.map((name) => {
            const tone = stationColor(name);
            return (
            <span key={name} className="rounded-md px-2.5 py-0.5 text-[11px] font-extrabold text-white" style={{ backgroundColor: tone.bg }} data-testid={`shopfloor-station-badge-${name}`}>■ {name}</span>
            );
          })}
        </div>
      ) : null}
      <div className="flex flex-col lg:flex-row lg:items-center justify-between gap-3">
        <div><h1 className="text-xl sm:text-2xl font-bold text-slate-900 tracking-tight flex items-center gap-2"><Factory className="w-6 h-6 text-emerald-600" /> Üretim Ekranı (Atölye)</h1><p className="hidden text-xs text-slate-500 min-[701px]:block sm:text-sm">Makine başındaki tabletten iş emirlerini görün, adımları başlatın / bitirin</p></div>
        <div className="relative flex flex-wrap items-center gap-2 text-sm max-w-full min-w-0">
          {(atolye ? !!operator : true) ? (
            <span className="inline-flex items-center gap-1.5 rounded-xl border border-emerald-200 bg-emerald-50 px-3 py-2 min-h-11 max-w-full text-sm font-semibold text-emerald-800" data-testid="shopfloor-operator-chip">
              <User className="w-4 h-4 shrink-0" />
              {atolye ? (
                <>
                  <span>Operatör: {operator}{personnelCode(operators.find((row) => row.id === operatorSession?.operator_id)) ? ` · ${personnelCode(operators.find((row) => row.id === operatorSession?.operator_id))}` : ""}</span>
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
          <div className="pointer-events-none absolute h-0 w-0 overflow-hidden" aria-hidden="true">
            <select value={projectId} onChange={(e) => setProjectId(e.target.value)} aria-label="Proje" className="bg-white border-2 border-slate-300 rounded-xl px-3 py-2.5 min-h-11 min-w-0 max-w-full font-semibold" data-testid="shopfloor-project">
              <option value="">Proje: Tüm projeler</option>
              {filterCatalog.projects.map((row) => (
                <option key={row.project_id} value={String(row.project_id)}>{projectFilterLabel(row)}</option>
              ))}
            </select>
            <select value={recipeId} onChange={(e) => setRecipeId(e.target.value)} aria-label="Reçete" className="bg-white border-2 border-slate-300 rounded-xl px-3 py-2.5 min-h-11 min-w-0 max-w-full font-semibold" data-testid="shopfloor-recipe">
              <option value="">Reçete: Tüm reçeteler</option>
              {filterCatalog.recipes.map((row) => (
                <option key={row.recipe_id} value={String(row.recipe_id)}>{recipeFilterLabel(row)}</option>
              ))}
            </select>
          </div>
          <button type="button" onClick={() => setFocusOpen(true)} className="min-h-11 rounded-xl border-2 border-slate-300 bg-white px-3 py-2.5 font-bold" data-testid="shopfloor-focus-open">Sıradaki iş</button>
          <button onClick={load} className="p-2.5 min-h-11 min-w-11 shrink-0 bg-white border-2 border-slate-300 rounded-xl" title="Yenile" data-testid="shopfloor-refresh"><RefreshCw className="w-4 h-4" /></button>
          <button onClick={() => setKiosk(!kiosk)} className="flex items-center justify-center gap-1 px-3 py-2.5 min-h-11 min-w-0 max-w-full w-[calc(50%-0.25rem)] sm:w-auto bg-slate-900 text-white rounded-xl font-semibold" data-testid="shopfloor-kiosk">{kiosk ? <Minimize2 className="w-4 h-4" /> : <Maximize2 className="w-4 h-4" />} {kiosk ? "Çık" : "Tablet Modu"}</button>
        </div>
      </div>
      {atolye && !operator && (
        <OperatorPicker operators={operators} onPick={(op) => { setPendingOp(op); setUnlockErr(""); }} />
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
      <div className="relative flex flex-wrap gap-2" data-testid="shopfloor-filters">
        <button type="button" onClick={() => { setProjectId(""); setRecipeId(""); setFilterMenu(""); }} className={`min-h-11 rounded-full border-2 px-3.5 py-1.5 text-sm font-bold ${!projectId && !recipeId ? "border-slate-900 bg-slate-900 text-white" : "border-slate-300 bg-white text-slate-900"}`} data-testid="shopfloor-filter-all">Tümü</button>
        <button type="button" onClick={() => setFilterMenu((cur) => (cur === "project" ? "" : "project"))} className={`min-h-11 rounded-full border-2 px-3.5 py-1.5 text-sm font-bold ${filterMenu === "project" || projectId ? "border-slate-900 bg-slate-900 text-white" : "border-slate-300 bg-white text-slate-900"}`} data-testid="shopfloor-filter-project">Proje ▾</button>
        <button type="button" onClick={() => setFilterMenu((cur) => (cur === "recipe" ? "" : "recipe"))} className={`min-h-11 rounded-full border-2 px-3.5 py-1.5 text-sm font-bold ${filterMenu === "recipe" || recipeId ? "border-slate-900 bg-slate-900 text-white" : "border-slate-300 bg-white text-slate-900"}`} data-testid="shopfloor-filter-recipe">Reçete ▾</button>
        <FilterMenu
          open={filterMenu === "project" || filterMenu === "recipe"}
          anchor={filterMenu === "recipe" ? "recipe" : "project"}
          projectId={filterMenu === "recipe" ? recipeId : projectId}
          onPick={(id) => {
            if (filterMenu === "recipe") setRecipeId(id);
            else setProjectId(id);
            setFilterMenu("");
          }}
          projects={(filterMenu === "recipe" ? filterCatalog.recipes : filterCatalog.projects).map((row) => {
            const id = String(filterMenu === "recipe" ? row.recipe_id : row.project_id);
            const tone = projectColor(filterMenu === "recipe" ? id : row.project_id);
            const full = filterMenu === "recipe" ? recipeFilterLabel(row) : projectFilterLabel(row);
            return { id, label: full.replace(/\s*\(\d+\)\s*$/, ""), count: `${Number(row.job_count) || 0} iş`, wash: tone.wash || "#f8fafc", edge: tone.stripe };
          })}
        />
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
      <p className="self-start rounded-md px-1.5 py-0.5 text-xs text-slate-500" data-testid="shopfloor-color-note">Renk: istasyon = dolu etiket · proje = kartın sol kenarı + çerçeveli etiket</p>
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
            {Number(fin.scrap_qty) > 0 ? (
              <div className="flex flex-wrap gap-2" data-testid="wo-finish-scrap-reasons">
                <div className="w-full text-sm font-semibold">Fire neden oldu?</div>
                {normalizeScrapReasons(shopSettings.scrap_reasons).map((reason) => (
                  <button
                    key={reason.code}
                    type="button"
                    onClick={() => setScrapReason(reason)}
                    className={`min-h-11 rounded-lg border px-3 py-2 text-sm font-semibold ${scrapReason?.code === reason.code ? "border-blue-600 bg-blue-50 text-blue-700" : "border-slate-300 bg-white"}`}
                    data-testid={`wo-scrap-reason-${reason.code}`}
                  >
                    {reason.label}
                  </button>
                ))}
              </div>
            ) : null}
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
            <div className="flex gap-2"><button onClick={() => setFinishing(null)} className="flex-1 py-3 border-2 rounded-xl font-semibold">İptal</button><button onClick={() => act(finishing, "finish", { produced_qty: Number(fin.produced_qty), scrap_qty: Number(fin.scrap_qty), notes: fin.notes, ...(scrapReason ? { scrap_reason_code: scrapReason.code, scrap_reason_label: scrapReason.label } : {}) })} className="flex-1 py-3 bg-emerald-600 text-white rounded-xl font-bold" data-testid="wo-finish-confirm">Tamamla</button></div>
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
      {partialJob ? (
        <PartialCountDialog
          job={partialJob}
          unit={workOrderFinishPlan(partialJob).unit}
          busy={partialBusy}
          onClose={() => { if (!partialBusy) setPartialJob(null); }}
          onSubmit={submitPartial}
        />
      ) : null}
      {takeover ? (
        <TakeoverDialog
          job={takeover.w}
          detail={takeover.detail}
          onClose={() => setTakeover(null)}
          onConfirm={() => act(takeover.w, takeover.action, { ...(takeover.body || {}), confirm_takeover: true })}
        />
      ) : null}
      {drawing ? (
        <DrawingViewer
          title={drawing.title}
          filename={drawing.filename}
          expiresIn={drawing.expiresIn}
          url={drawing.url}
          contentType={drawing.contentType}
          onClose={() => setDrawing(null)}
        />
      ) : null}
      {undoToast && undoCountdown(undoToast.finishedAt, shopSettings.undo_finish_minutes, now) ? (
        <UndoToast
          text={undoToast.text}
          countdown={undoCountdown(undoToast.finishedAt, shopSettings.undo_finish_minutes, now)}
          onUndo={() => undoWork(undoToast.workOrder)}
        />
      ) : null}
      {idleLocked && operatorSession ? (
        <IdleLock
          name={operatorSession.operator_name || operator}
          code={personnelCode(operators.find((row) => String(row.id) === String(operatorSession.operator_id)))}
          minutes={Number(shopSettings.idle_lock_minutes) || 30}
          error={idleErr}
          busy={idleBusy}
          onSubmit={submitIdlePin}
          onSwitch={() => { setIdleLocked(false); setIdleErr(""); logoutOperator(); }}
        />
      ) : null}
      {focusOpen ? (() => {
        const picked = focusJob(wos, operator);
        const job = picked?.job || null;
        const plan = job ? workOrderFinishPlan(job) : null;
        const qtyLabel = job ? (workOrderQtyLabel(job, plan) || `${formatTrQty(plan.qty)} ${plan.unit}`) : "";
        return (
          <FocusBoard
            mode={picked?.mode || "next"}
            job={job}
            title={job ? cardTitle(job).text : "Sıradaki iş yok"}
            qtyLabel={qtyLabel}
            passive={!mayOperate || !job || (atolye && !operator)}
            onBack={() => setFocusOpen(false)}
            onStart={() => { if (job) act(job, "start"); }}
            onFinish={() => { if (!job) return; setFocusOpen(false); openFinish(job); }}
            onDrawing={() => { if (job) openDrawing(job); }}
          />
        );
      })() : null}
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
