import React, { useState, useEffect, useCallback, useRef } from "react";
import { useSearchParams } from "react-router-dom";
import axios from "axios";
import { API_URL, useAuth } from "../context/AuthContext";
import { printPayslip } from "../utils/payslip";
import { toast } from "sonner";
import { resolveImageUrl } from "../utils/imageUrl";
import { compressImageFile } from "../utils/compressImage";
import { LeaveRequestsPanel, SalaryCalculator, BonusPanel } from "../components/PersonnelExtras";
import { AttendancePanel } from "../components/AttendancePanel";
import { EmployeeCardModal } from "../components/EmployeeCardModal";
import { EmployeePayModal } from "../components/EmployeePayModal";
import { EmployeeMovesModal } from "../components/EmployeeMovesModal";
import { EmployeeAssignTaskModal } from "../components/EmployeeAssignTaskModal";
import { AssignOvertimeModal } from "../components/AssignOvertimeModal";
import { QuickPayModal } from "../components/QuickPayModal";
import { MoneyInput } from "../components/MoneyInput";
import { PaymentTargetSelect, splitPaymentTarget } from "../components/PaymentTargetSelect";
import { EmployeeRequestChips, PersonnelRequestsInbox } from "../components/PersonnelRequestsInbox";
import { empIdOf } from "../utils/personnelIds";
import { assignedOvertimeCellCaption, cardPunchAttempts, cardPunchConfirmMessage, cardPunchDraftTime, cardPunchPayload, cardPunchRequiresTime, cardPunchTimeHint, locationControllerLabel, locationTrackingTogglePayload, todayAttendanceParts } from "../utils/employeeCardStatus";
import { employeeCompGroups, employeeCompRowCaption, employeeCompRows, employeePayButtonLabel, fmtCardMoney, formatLeaveRemainingLine, payMoveCanDelete, payMoveDeleteConfirm, payMoveDeletePath, presenceTodayOf } from "../utils/personnelCard";
import { balanceView, filterEmployees, presenceChip, presenceState, teamNetView, teamSummary, todayWorkLabel } from "../utils/personnelCardView";
import { punchLabelClass } from "../utils/punchLabels";
import { positionOptionsFromRoles } from "../utils/employeePosition";
import { EmployeeLedgerModal } from "../components/EmployeeLedgerModal";
import { EmployeeYevmiyeModal } from "../components/EmployeeYevmiyeModal";
import { isDailyWage, payrollWageLine, totalMonthlyLoad, yevmiyeDaysOf } from "../utils/personnelWage";
import { BLOOD_TYPE_OPTIONS, hasExtraEmployeeDetails, MARITAL_STATUS_OPTIONS } from "../utils/employeeDetails";
import { annualLeaveDaysError, parseAnnualLeaveDays } from "../utils/employeeCardSummary";
import { hasPayStartDate, PAY_START_MISSING_MSG } from "../utils/employeePay";
import { workplaceShort } from "../utils/workplace";
import { useInfiniteRows } from "../hooks/useInfiniteRows";
import { TxMobileCard, TxResponsiveList, TxTypeBadge, TX_WRAP_CLASS } from "../components/TxMobileCard";

import {
  UserCheck,
  Plus,
  DollarSign,
  Calculator,
  CheckCircle2,
  Clock,
  Phone,
  Mail,
  X,
  Pencil,
  Trash2,
  CalendarDays,
  Gift,
  Banknote,
  ClipboardList,
  Timer,
  Bell,
  Upload,
  Image as ImageIcon,
  ChevronDown,
  ChevronUp,
  Users,
  Receipt,
  MoreHorizontal,
} from "lucide-react";
import { notifyDataChanged, useDataRefresh } from "../utils/dataRefresh";
import { MISSING_RECORD } from "../utils/notificationTarget";
import { activeCompanyId } from "../utils/activeCompanyId";
import NoCompanyNotice from "../components/NoCompanyNotice";

const BALANCE_BOX = {
  pay: "border-emerald-200 bg-emerald-50 text-emerald-900",
  owes: "border-rose-200 bg-rose-50 text-rose-900",
  zero: "border-slate-200 bg-slate-50 text-slate-700",
};

const PRESENCE_PILL = {
  in: { label: "● Mesaide", box: "border-emerald-200 bg-emerald-50 text-emerald-800", dot: "bg-emerald-500" },
  overtime: { label: "Fazla mesaide", box: "border-indigo-200 bg-indigo-50 text-indigo-800", dot: "bg-indigo-500" },
  out: { label: "Mesai dışı", box: "border-slate-200 bg-slate-100 text-slate-600", dot: "bg-slate-400" },
};

const MENU_ITEM = "flex h-9 w-full items-center gap-2 px-3 text-left text-[12px] font-semibold text-slate-700 hover:bg-slate-50";

function cardInitials(name) {
  return String(name || "?").split(" ").map((w) => w[0]).filter(Boolean).slice(0, 2).join("").toUpperCase();
}

function stopCardToggle(event) {
  event.stopPropagation();
}

function cardToggleBlocked(event) {
  return Boolean(event.target?.closest?.("button, input, textarea, select, a, label"));
}

function CardMoreMenu({ empKey, open, onOpen, onClose, children }) {
  const ref = useRef(null);
  useEffect(() => {
    if (!open) return undefined;
    const onPointer = (event) => {
      if (!ref.current || ref.current.contains(event.target)) return;
      onClose();
    };
    const onKey = (event) => {
      if (event.key === "Escape") onClose();
    };
    document.addEventListener("mousedown", onPointer);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onPointer);
      document.removeEventListener("keydown", onKey);
    };
  }, [open, onClose]);
  return (
    <div className="relative" ref={ref} data-menu-root="" onClick={stopCardToggle} onKeyDown={stopCardToggle}>
      <button
        type="button"
        aria-haspopup="menu"
        aria-expanded={open}
        data-testid={`employee-more-btn-${empKey}`}
        onClick={(event) => {
          stopCardToggle(event);
          if (open) onClose();
          else onOpen();
        }}
        className="inline-flex h-9 w-9 items-center justify-center rounded-lg border border-slate-200 bg-white text-slate-600 hover:bg-slate-50"
        title="Diğer işlemler"
      >
        <MoreHorizontal className="w-4 h-4" />
      </button>
      {open ? (
        <div role="menu" data-testid={`employee-more-menu-${empKey}`} className="absolute right-0 top-full z-30 mt-1 min-w-[11.5rem] rounded-xl border border-slate-200 bg-white py-1 shadow-lg">
          {children}
        </div>
      ) : null}
    </div>
  );
}

const hasSgk = (emp) => Boolean(emp?.sgk_insured) || Boolean(String(emp?.sgk_number || "").trim());
const isBankAcc = (a) => {
  const t = String(a?.type || "").toLowerCase();
  return t === "bank" || (!t && (a?.iban || a?.bank_name));
};

export default function PersonnelPage() {
  const { activeCompany, can, user } = useAuth();
  const isCompanyAdmin = Boolean(user?.is_super_admin) || ["admin", "owner"].includes(String(user?.role || "").toLowerCase());
  const [sgkSalaryBankOnly, setSgkSalaryBankOnly] = useState(true);
  const canDeletePersonnel = can("/personnel", "delete");
  const [employees, setEmployees] = useState([]);
  const [attToday, setAttToday] = useState({});
  const [attWork, setAttWork] = useState({});
  const [movesEmp, setMovesEmp] = useState(null);
  const [locBusyId, setLocBusyId] = useState(null);
  const [punchConfirm, setPunchConfirm] = useState(null);
  const [punchBusyId, setPunchBusyId] = useState(null);
  const [searchParams, setSearchParams] = useSearchParams();
  const tab = searchParams.get("tab") || "payroll";
  const setTab = (t) => setSearchParams({ tab: t }, { replace: true });
  const focusLeave = searchParams.get("leave") || "";
  const focusAdvance = searchParams.get("advance") || "";
  const focusOvertime = searchParams.get("overtime") || "";
  const [openLeaveId, setOpenLeaveId] = useState("");
  const [openAdvanceId, setOpenAdvanceId] = useState("");
  const [openOvertimeId, setOpenOvertimeId] = useState("");
  const [payrolls, setPayrolls] = useState([]);
  const [bankAccounts, setBankAccounts] = useState([]);
  const [loading, setLoading] = useState(true);

  // Modals
  const [showAddModal, setShowAddModal] = useState(false);
  const [editingEmp, setEditingEmp] = useState(null);
  const [cardEmp, setCardEmp] = useState(null);
  const [quickPay, setQuickPay] = useState(null);
  const openQuickPay = (p, type) => setQuickPay({ p, type });

  const [payPayrollItem, setPayPayrollItem] = useState(null);
  const [selectedBankId, setSelectedBankId] = useState("");
  const [pendingReqs, setPendingReqs] = useState([]);
  const [busyReqId, setBusyReqId] = useState(null);
  const [otAssign, setOtAssign] = useState(null);
  const [taskEmp, setTaskEmp] = useState(null);
  const [ledgerEmp, setLedgerEmp] = useState(null);
  const [yevmiyeEmp, setYevmiyeEmp] = useState(null);
  const [settlePay, setSettlePay] = useState(null);
  const [roleOptions, setRoleOptions] = useState([]);
  const [expandedCards, setExpandedCards] = useState({});
  const [empFilter, setEmpFilter] = useState("all");
  const [menuKey, setMenuKey] = useState("");
  const closeMenu = useCallback(() => setMenuKey(""), []);

  const companyId = activeCompanyId(activeCompany);

  const toggleCardExpanded = useCallback((key) => {
    setExpandedCards((prev) => ({ ...prev, [key]: !prev[key] }));
  }, []);

  const emptyEmployee = {
    full_name: "",
    tc_kimlik: "",
    department: "",
    position: "",
    phone: "",
    email: "",
    salary: 35000,
    pay_type: "monthly",
    daily_wage: "",
    annual_leave_days: 14,
    start_date: new Date().toISOString().split("T")[0],
    photo_url: "",
    sgk_number: "",
    sgk_insured: false,
    official_salary: "",
    iban: "",
    meal_allowance: "",
    transport_allowance: "",
    birth_date: "",
    address: "",
    emergency_contact: "",
    marital_status: "",
    blood_type: "",
    illnesses: "",
    safety_info: "",
    notes: "",
  };
  const [newEmployee, setNewEmployee] = useState(emptyEmployee);
  const [showEmpDetails, setShowEmpDetails] = useState(false);

  const openAddEmployee = () => {
    setEditingEmp(null);
    setNewEmployee({ ...emptyEmployee, start_date: new Date().toISOString().split("T")[0] });
    setShowEmpDetails(false);
    setShowAddModal(true);
  };
  const openEditEmployee = (emp) => {
    setEditingEmp(emp);
    setNewEmployee({
      full_name: emp.full_name || "",
      tc_kimlik: emp.tc_kimlik || "",
      department: emp.department || "",
      position: emp.position || "",
      phone: emp.phone || "",
      email: emp.email || "",
      salary: emp.salary ?? 0,
      pay_type: emp.pay_type === "daily" ? "daily" : "monthly",
      daily_wage: emp.daily_wage ?? "",
      annual_leave_days: emp.annual_leave_days ?? emp.leave_balance?.annual ?? 14,
      start_date: emp.start_date || new Date().toISOString().split("T")[0],
      photo_url: emp.photo_url || "",
      sgk_number: emp.sgk_number || "",
      sgk_insured: Boolean(emp.sgk_insured),
      official_salary: emp.official_salary ?? "",
      iban: emp.iban || "",
      meal_allowance: emp.meal_allowance ?? "",
      transport_allowance: emp.transport_allowance ?? "",
      birth_date: emp.birth_date || "",
      address: emp.address || "",
      emergency_contact: emp.emergency_contact || "",
      marital_status: emp.marital_status || "",
      blood_type: emp.blood_type || "",
      illnesses: emp.illnesses || "",
      safety_info: emp.safety_info || "",
      notes: emp.notes || "",
    });
    setShowEmpDetails(Boolean(
      emp.sgk_number || emp.iban || emp.meal_allowance || emp.transport_allowance || emp.address
      || emp.birth_date || emp.emergency_contact || emp.notes || hasExtraEmployeeDetails(emp)
    ));
    setShowAddModal(true);
  };
  const closeEmployeeModal = () => {
    setShowAddModal(false);
    setEditingEmp(null);
  };

  const uploadEmployeePhoto = async (e) => {
    const raw = e.target.files?.[0];
    e.target.value = "";
    if (!raw) return;
    try {
      const file = await compressImageFile(raw);
      const fd = new FormData();
      fd.append("file", file);
      const eid = editingEmp?.id || editingEmp?._id || "";
      if (!companyId) { toast.error("Firma seçili değil"); return; }
      const r = await axios.post(`${API_URL}/files/upload?entity=employee_photo&entity_id=${encodeURIComponent(eid)}&company_id=${encodeURIComponent(companyId)}`, fd);
      setNewEmployee((prev) => ({ ...prev, photo_url: r.data.url }));
      toast.success(r.data?.saved_pct ? `Fotoğraf yüklendi (≈%${r.data.saved_pct} küçültüldü).` : "Fotoğraf yüklendi.");
    } catch (err) {
      toast.error(err.response?.data?.detail || "Fotoğraf yüklenemedi.");
    }
  };

  const loadPersonnelData = useCallback(async () => {
    if (!companyId) {
      setLoading(false);
      return;
    }
    try {
      setLoading(true);
      const [empRes, payRes, bankRes, attRes] = await Promise.all([
        axios.get(`${API_URL}/personnel/employees?company_id=${companyId}`),
        axios.get(`${API_URL}/personnel/payrolls?company_id=${companyId}`),
        axios.get(`${API_URL}/banking/accounts?company_id=${companyId}`),
        axios.get(`${API_URL}/personnel/attendance?company_id=${companyId}`).catch(() => ({ data: { summary: [] } })),
      ]);
      setEmployees(empRes.data);
      setPayrolls(payRes.data);
      setBankAccounts(bankRes.data);
      const todayMap = {};
      const workMap = {};
      for (const s of attRes.data?.summary || []) {
        if (s.employee_id) {
          todayMap[s.employee_id] = presenceTodayOf(s);
          workMap[s.employee_id] = s.workplace || null;
        }
      }
      setAttToday(todayMap);
      setAttWork(workMap);
      if (bankRes.data.length > 0) setSelectedBankId(bankRes.data[0].id || bankRes.data[0]._id);
    } catch (err) {
      toast.error("Personel verileri yüklenemedi.");
    } finally {
      setLoading(false);
    }
  }, [companyId]);
  useEffect(() => { loadPersonnelData(); }, [loadPersonnelData]);

  useEffect(() => {
    if (!companyId) return undefined;
    let cancel = false;
    axios.get(`${API_URL}/companies/${companyId}`)
      .then((r) => {
        if (cancel) return;
        const flag = r.data?.settings?.sgk_salary_bank_only;
        setSgkSalaryBankOnly(flag === undefined ? true : Boolean(flag));
      })
      .catch(() => {});
    return () => { cancel = true; };
  }, [companyId]);

  const saveSgkRule = async (next) => {
    const prev = sgkSalaryBankOnly;
    setSgkSalaryBankOnly(next);
    try {
      await axios.put(`${API_URL}/companies/${companyId}/personnel-settings`, { sgk_salary_bank_only: next });
      toast.success(next ? "SGK maaş kuralı açık." : "SGK maaş kuralı kapatıldı.");
    } catch (err) {
      setSgkSalaryBankOnly(prev);
      toast.error(err.response?.data?.detail || "Ayar kaydedilemedi.");
    }
  };

  const toggleCardLocation = async (emp, enabled) => {
    const id = empIdOf(emp);
    if (!id) return;
    setLocBusyId(id);
    try {
      await axios.put(`${API_URL}/personnel/employees/${id}`, {
        location_tracking: locationTrackingTogglePayload(emp.location_tracking, enabled),
      });
      toast.success(`${emp.full_name}: ${locationControllerLabel(enabled)}.`);
      await loadPersonnelData();
    } catch (err) {
      toast.error(err.response?.data?.detail || "Konum ayarı kaydedilemedi.");
    } finally {
      setLocBusyId(null);
    }
  };

  const cardPunch = async (emp, action, time) => {
    const id = empIdOf(emp);
    if (!id) return;
    const invalid = cardPunchRequiresTime(time);
    if (invalid) {
      toast.error(invalid);
      return;
    }
    setPunchBusyId(id);
    try {
      const r = await axios.post(`${API_URL}/personnel/attendance`, { employee_id: id, ...cardPunchPayload(action, time) });
      toast.success(r.data?.message || (action === "check_in" ? "Giriş kaydedildi." : "Çıkış kaydedildi."));
      if (r.data?.overtime_hours) toast.info(`${r.data.overtime_hours} sa fazla mesai otomatik yazıldı.`);
      setPunchConfirm(null);
      await loadPersonnelData();
    } catch (err) {
      toast.error(err.response?.data?.detail || "Puantaj kaydedilemedi.");
    } finally {
      setPunchBusyId(null);
    }
  };
  const refreshPersonnelSilent = useCallback(() => loadPersonnelData(), [loadPersonnelData]);
  useDataRefresh(refreshPersonnelSilent, { companyId, scopes: ["cash", "expenses", "contacts"] });

  useEffect(() => {
    if (!companyId) return;
    axios.get(`${API_URL}/personnel/role-options`, { params: { company_id: companyId } })
      .then((r) => setRoleOptions(r.data?.roles || []))
      .catch(() => setRoleOptions([]));
  }, [companyId]);

  const loadPendingReqs = useCallback(async () => {
    if (!companyId) return;
    try {
      const r = await axios.get(`${API_URL}/personnel/pending-requests`, { params: { company_id: companyId } });
      setPendingReqs(r.data?.items || []);
    } catch {
      /* inbox zaten yükler */
    }
  }, [companyId]);
  useEffect(() => { loadPendingReqs(); }, [loadPendingReqs]);

  useEffect(() => {
    if (!companyId) return undefined;
    let cancel = false;
    const rowsOf = (data) => (Array.isArray(data) ? data : (data?.items || data?.records || []));
    const hasId = (rows, id) => rows.some((row) => String(row?.id || row?._id || "") === String(id));
    const openOrToast = (setter, id, ok) => {
      if (cancel) return;
      if (ok) setter(id);
      else {
        setter("");
        toast.error(MISSING_RECORD);
      }
    };
    if (focusLeave) {
      axios.get(`${API_URL}/personnel/leaves?company_id=${companyId}`)
        .then((r) => openOrToast(setOpenLeaveId, focusLeave, hasId(rowsOf(r.data), focusLeave)))
        .catch(() => { if (!cancel) toast.error(MISSING_RECORD); });
    } else setOpenLeaveId("");
    if (focusAdvance) {
      axios.get(`${API_URL}/personnel/bonuses?company_id=${companyId}`)
        .then((r) => openOrToast(setOpenAdvanceId, focusAdvance, hasId(rowsOf(r.data), focusAdvance)))
        .catch(() => { if (!cancel) toast.error(MISSING_RECORD); });
    } else setOpenAdvanceId("");
    if (focusOvertime) {
      const month = new Date().toISOString().slice(0, 7);
      Promise.all([
        axios.get(`${API_URL}/personnel/pending-requests`, { params: { company_id: companyId } }).catch(() => ({ data: { items: [] } })),
        axios.get(`${API_URL}/personnel/attendance?company_id=${companyId}&month=${month}`).catch(() => ({ data: { records: [] } })),
      ]).then(([pending, att]) => {
        const items = rowsOf(pending.data);
        const records = att.data?.records || att.data?.summary || [];
        openOrToast(setOpenOvertimeId, focusOvertime, hasId(items, focusOvertime) || hasId(records, focusOvertime));
      }).catch(() => { if (!cancel) toast.error(MISSING_RECORD); });
    } else setOpenOvertimeId("");
    return () => { cancel = true; };
  }, [focusLeave, focusAdvance, focusOvertime, companyId]);
  useDataRefresh(loadPendingReqs, { companyId, scopes: ["personnel", "attendance"] });

  const handleSaveEmployee = async (e) => {
    e.preventDefault();
    if (!newEmployee.full_name || !newEmployee.tc_kimlik) {
      toast.error("Lütfen ad soyad ve TC kimlik no girin.");
      return;
    }
    const sgk = String(newEmployee.sgk_number || "").trim();
    const iban = String(newEmployee.iban || "").trim();
    if ((sgk || newEmployee.sgk_insured) && !iban) {
      setShowEmpDetails(true);
      toast.error("SGK sicil numarası girildiğinde IBAN zorunludur — maaş yalnız bankadan ödenir.");
      return;
    }
    const daily = Number(newEmployee.daily_wage || 0);
    const monthly = Number(newEmployee.salary || 0);
    const isDaily = newEmployee.pay_type === "daily";
    const leaveErr = annualLeaveDaysError(newEmployee.annual_leave_days);
    if (leaveErr) {
      toast.error(leaveErr);
      return;
    }
    const annualLeave = parseAnnualLeaveDays(newEmployee.annual_leave_days);
    const body = {
      ...newEmployee,
      pay_type: isDaily ? "daily" : "monthly",
      daily_wage: isDaily ? daily : 0,
      salary: isDaily ? Math.round(daily * 26 * 100) / 100 : monthly,
      annual_leave_days: annualLeave,
      sgk_number: sgk || null,
      sgk_insured: Boolean(newEmployee.sgk_insured),
      official_salary: newEmployee.official_salary === "" || newEmployee.official_salary == null ? null : Number(newEmployee.official_salary),
      iban: iban || null,
      meal_allowance: Number(newEmployee.meal_allowance || 0) || 0,
      transport_allowance: Number(newEmployee.transport_allowance || 0) || 0,
      birth_date: newEmployee.birth_date || null,
      address: String(newEmployee.address || "").trim() || null,
      emergency_contact: String(newEmployee.emergency_contact || "").trim() || null,
      marital_status: String(newEmployee.marital_status || "").trim() || null,
      blood_type: String(newEmployee.blood_type || "").trim() || null,
      illnesses: String(newEmployee.illnesses || "").trim() || null,
      safety_info: String(newEmployee.safety_info || "").trim() || null,
      notes: String(newEmployee.notes || "").trim() || null,
    };
    try {
      if (editingEmp) {
        const id = editingEmp.id || editingEmp._id;
        await axios.put(`${API_URL}/personnel/employees/${id}`, body);
        toast.success("Personel güncellendi.");
      } else {
        if (!companyId) { toast.error("Firma seçili değil"); return; }
        await axios.post(`${API_URL}/personnel/employees`, { company_id: companyId, ...body });
        toast.success("Personel başarıyla kaydedildi.");
      }
      closeEmployeeModal();
      loadPersonnelData();
    } catch (err) {
      toast.error(err.response?.data?.detail || (editingEmp ? "Personel güncellenemedi." : "Personel kaydedilemedi."));
    }
  };

  const handleDeleteEmployee = async (emp) => {
    if (!window.confirm(`${emp.full_name} personel kaydı silinsin mi? (Çöp kutusuna taşınır)`)) return;
    try {
      const id = emp.id || emp._id;
      await axios.delete(`${API_URL}/personnel/employees/${id}`);
      toast.success("Personel çöp kutusuna taşındı.");
      if (cardEmp && (cardEmp.id || cardEmp._id) === id) setCardEmp(null);
      loadPersonnelData();
    } catch (err) {
      toast.error(err.response?.data?.detail || "Personel silinemedi.");
    }
  };

  const handleGeneratePayroll = async () => {
    if (!companyId) { toast.error("Firma seçili değil"); return; }
    try {
      const currentMonth = new Date().toISOString().slice(0, 7);
      const res = await axios.post(`${API_URL}/personnel/generate-payroll`, {
        company_id: companyId,
        period: currentMonth
      });
      toast.success(res.data.message);
      loadPersonnelData();
    } catch (err) {
      toast.error("Bordro hesaplanamadı.");
    }
  };

  const handleDeletePayroll = async (p) => {
    const row = { id: p.id || p._id, kind: "payroll", status: p.status };
    const path = payMoveDeletePath(row);
    if (!payMoveCanDelete(row) || !path) return;
    const ask = payMoveDeleteConfirm(row);
    if (!window.confirm(`${ask.title}\n${ask.message}`)) return;
    try {
      await axios.delete(`${API_URL}${path}`);
      toast.success("Maaş kaydı çöp kutusuna taşındı.");
      loadPersonnelData();
    } catch (err) {
      toast.error(err.response?.data?.detail || "Maaş kaydı silinemedi.");
    }
  };

  const handleExecuteSalaryPayment = async () => {
    if (!payPayrollItem) return;
    const emp = employees.find((x) => empIdOf(x) === String(payPayrollItem.employee_id || ""));
    if (hasSgk(emp)) {
      if (!selectedBankId || String(selectedBankId).startsWith("partner:")) {
        toast.error("SGK’lı personelin maaşı yalnız banka hesabından ödenir.");
        return;
      }
      const acc = bankAccounts.find((a) => (a.id || a._id) === selectedBankId);
      if (!acc || !isBankAcc(acc)) {
        toast.error("SGK’lı personelin maaşı yalnız banka hesabından ödenir.");
        return;
      }
      if (!String(emp.iban || "").trim()) {
        toast.error("SGK’lı personel için önce personel kartına IBAN girin.");
        return;
      }
    }
    try {
      const res = await axios.post(`${API_URL}/personnel/payrolls/${payPayrollItem.id || payPayrollItem._id}/pay`, {
        ...splitPaymentTarget(selectedBankId)
      });
      toast.success(res.data.message);
      await notifyDataChanged({ companyId, scopes: ["cash", "expenses", "contacts"] });
      setPayPayrollItem(null);
      loadPersonnelData();
    } catch (err) {
      toast.error(err.response?.data?.detail || "Maaş ödemesi gerçekleştirilemedi.");
    }
  };

  const openSalaryPayModal = (p) => {
    const emp = employees.find((x) => empIdOf(x) === String(p.employee_id || ""));
    if (hasSgk(emp)) {
      const bank = bankAccounts.find((a) => isBankAcc(a) && !a.is_integrated);
      setSelectedBankId(bank ? (bank.id || bank._id) : "");
    } else if (bankAccounts[0]) {
      setSelectedBankId(bankAccounts[0].id || bankAccounts[0]._id);
    }
    setPayPayrollItem(p);
  };

  const openSettleFor = (emp, kind) => {
    if (kind === "bonus" && isDailyWage(emp)) {
      setYevmiyeEmp(emp);
      return;
    }
    setSettlePay({ emp, kind });
  };

  const openOvertimeFor = (emp) => setOtAssign({
    employee_id: empIdOf(emp),
    employee_name: emp.full_name,
    hours: "",
    start: "",
    end: "",
    date: new Date().toISOString().slice(0, 10),
    note: "",
  });

  const saveOvertime = async () => {
    if (!otAssign) return;
    try {
      const r = await axios.put(`${API_URL}/personnel/attendance/assign-overtime`, {
        employee_id: otAssign.employee_id,
        date: otAssign.date,
        hours: Number(otAssign.hours) || 0,
        start_time: otAssign.start || undefined,
        end_time: otAssign.end || undefined,
        note: otAssign.note || "",
      });
      toast.success(r.data.message || "Fazla mesai atandı.");
      setOtAssign(null);
      await notifyDataChanged({ companyId, scopes: ["personnel", "attendance"] });
    } catch (err) {
      toast.error(err.response?.data?.detail || "Atama kaydedilemedi.");
    }
  };

  const afterRequestDecision = async () => {
    await loadPendingReqs();
    await notifyDataChanged({ companyId, scopes: ["personnel", "attendance"] });
    loadPersonnelData();
  };

  const decideLeave = async (id, status) => {
    setBusyReqId(id);
    try {
      await axios.post(`${API_URL}/personnel/leaves/${id}/decide`, { status });
      toast.success(status === "approved" ? "İzin onaylandı." : "İzin reddedildi.");
      await afterRequestDecision();
    } catch (err) {
      toast.error(err.response?.data?.detail || "İşlem başarısız.");
    } finally {
      setBusyReqId(null);
    }
  };

  const decideEarly = async (id, decision, wageDeduction = false) => {
    setBusyReqId(id);
    try {
      const r = await axios.post(`${API_URL}/personnel/attendance/${id}/early-leave-decision`, {
        decision,
        wage_deduction: decision === "approve" ? !!wageDeduction : false,
      });
      toast.success(r.data?.message || (decision === "approve" ? "Onaylandı" : "Reddedildi"));
      await afterRequestDecision();
    } catch (err) {
      toast.error(err.response?.data?.detail || "İşlem başarısız.");
    } finally {
      setBusyReqId(null);
    }
  };

  const decideIntraday = async (id, decision, wageDeduction = false) => {
    setBusyReqId(id);
    try {
      const r = await axios.post(`${API_URL}/personnel/attendance/${id}/intraday-leave-decision`, {
        decision,
        wage_deduction: decision === "approve" ? !!wageDeduction : false,
      });
      toast.success(r.data?.message || (decision === "approve" ? "Onaylandı" : "Reddedildi"));
      await afterRequestDecision();
    } catch (err) {
      toast.error(err.response?.data?.detail || "İşlem başarısız.");
    } finally {
      setBusyReqId(null);
    }
  };

  const decideYevmiye = async (id, decision) => {
    setBusyReqId(id);
    try {
      const r = await axios.post(`${API_URL}/personnel/attendance/${id}/yevmiye-decision`, { decision });
      toast.success(r.data?.message || (decision === "approve" ? "Ücret kesildi." : "Ücret kesilmedi."));
      await afterRequestDecision();
    } catch (err) {
      toast.error(err.response?.data?.detail || "İşlem başarısız.");
    } finally {
      setBusyReqId(null);
    }
  };

  const decideDispute = async (id, decision) => {
    setBusyReqId(id);
    try {
      const r = await axios.post(`${API_URL}/personnel/attendance/${id}/dispute-decision`, { decision });
      toast.success(r.data?.message || (decision === "approve" ? "İtiraz düzeltildi." : "İtiraz reddedildi."));
      await afterRequestDecision();
    } catch (err) {
      toast.error(err.response?.data?.detail || "İşlem başarısız.");
    } finally {
      setBusyReqId(null);
    }
  };

  const decideWorkOrderTrash = async (id, status) => {
    setBusyReqId(id);
    try {
      const r = await axios.post(`${API_URL}/production/work-orders/trash-requests/${id}/decide`, { status });
      toast.success(r.data?.message || (status === "approved" ? "Silme onaylandı." : "Silme reddedildi."));
      await afterRequestDecision();
    } catch (err) {
      toast.error(err.response?.data?.detail || "İşlem başarısız.");
    } finally {
      setBusyReqId(null);
    }
  };

  const decideGeoConfirm = async (id, decision) => {
    setBusyReqId(id);
    try {
      const r = await axios.post(`${API_URL}/personnel/attendance/${id}/geo-confirm-decision`, { decision });
      toast.success(r.data?.message || (decision === "approve" ? "Teyit edildi." : "Reddedildi."));
      await afterRequestDecision();
    } catch (err) {
      toast.error(err.response?.data?.detail || "İşlem başarısız.");
    } finally {
      setBusyReqId(null);
    }
  };

  const decideLocationExit = async (id, decision, wageDeduction) => {
    setBusyReqId(id);
    try {
      const r = await axios.post(`${API_URL}/personnel/attendance/${id}/location-exit-decision`, { decision, wage_deduction: !!wageDeduction });
      toast.success(r.data?.message || "Konum dışı çıkış yanıtlandı.");
      await afterRequestDecision();
    } catch (err) {
      toast.error(err.response?.data?.detail || "İşlem başarısız.");
    } finally {
      setBusyReqId(null);
    }
  };

  const decideOvertimeConfirm = async (id, decision) => {
    setBusyReqId(id);
    try {
      const r = await axios.post(`${API_URL}/personnel/attendance/${id}/overtime-confirm-decision`, { decision });
      toast.success(r.data?.message || (decision === "yes" ? "Fazla mesai yazıldı." : "Fazla mesai yazılmadı."));
      await afterRequestDecision();
    } catch (err) {
      toast.error(err.response?.data?.detail || "İşlem başarısız.");
    } finally {
      setBusyReqId(null);
    }
  };

  const decideAdvance = async (id, status) => {
    setBusyReqId(id);
    try {
      await axios.post(`${API_URL}/personnel/bonuses/${id}/decide`, { status });
      toast.success(status === "approved" ? "Avans talebi onaylandı." : "Avans talebi reddedildi.");
      await afterRequestDecision();
    } catch (err) {
      toast.error(err.response?.data?.detail || "İşlem başarısız.");
    } finally {
      setBusyReqId(null);
    }
  };

  const requestsFor = (emp) => pendingReqs.filter((it) => empIdOf(it) === empIdOf(emp));

  const totalMonthlyPayroll = totalMonthlyLoad(employees);
  const hasDaily = employees.some(isDailyWage);
  const { visible: pagedEmployees, hasMore: employeesHasMore, sentinelRef: employeesSentinelRef } = useInfiniteRows(employees, {
    resetKey: employees.length,
  });
  const { visible: pagedPayrolls, hasMore: payrollsHasMore, sentinelRef: payrollsSentinelRef } = useInfiniteRows(payrolls, {
    resetKey: payrolls.length,
  });
  const employeeForPresence = (emp) => {
    const key = empIdOf(emp);
    const workplace = emp.workplace || attWork[key];
    if (!workplace || workplace === emp.workplace) return emp;
    return { ...emp, workplace };
  };
  const presenceEmployees = employees.map(employeeForPresence);
  const team = teamSummary(presenceEmployees, attToday);
  const netTeam = teamNetView(team.netRemaining);
  const shownEmployees = filterEmployees(pagedEmployees.map(employeeForPresence), empFilter, attToday);

  return (
    <div className="space-y-6" data-testid="personnel-page">
      {!companyId && <NoCompanyNotice />}
      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div>
          <h1 className="text-xl sm:text-2xl font-bold text-slate-900 tracking-tight flex items-center gap-2">
            <Users className="w-6 h-6 text-indigo-600" />
            Personel & Bordro Modülü
          </h1>
          <p className="text-xs sm:text-sm text-slate-500">
            Aylık Toplam Net Maaş Yükü: <span className="font-bold text-slate-900">{totalMonthlyPayroll.toLocaleString('tr-TR')} ₺</span>
            {hasDaily ? <span className="text-slate-400"> · yevmiye × 26 gün tahmini</span> : null}
          </p>
          {isCompanyAdmin ? (
            <label className="mt-2 inline-flex items-center gap-2 text-xs text-slate-700" data-testid="sgk-salary-bank-toggle">
              <input type="checkbox" checked={sgkSalaryBankOnly} onChange={(ev) => saveSgkRule(ev.target.checked)} />
              SGK&apos;lı personelin resmi maaşı yalnız bankadan ödensin
            </label>
          ) : null}
        </div>
        <div className="flex items-center gap-2 self-start sm:self-auto">
          <button
            onClick={handleGeneratePayroll}
            className="flex items-center gap-1.5 bg-indigo-600 hover:bg-indigo-700 text-white px-3.5 py-2 rounded-xl text-xs sm:text-sm font-semibold shadow-md shadow-indigo-600/20 transition"
            data-testid="generate-payroll-btn"
          >
            <Calculator className="w-4 h-4" />
            <span>Aylık Bordro Hesapla</span>
          </button>
          <button
            onClick={openAddEmployee}
            className="flex items-center gap-1.5 bg-emerald-600 hover:bg-emerald-700 text-white px-3.5 py-2 rounded-xl text-xs sm:text-sm font-semibold shadow-md shadow-emerald-600/20 transition"
            data-testid="add-employee-btn"
          >
            <Plus className="w-4 h-4" />
            <span>Yeni Çalışan Ekle</span>
          </button>
        </div>
      </div>

      <PersonnelRequestsInbox
        companyId={companyId}
        onChanged={() => { loadPersonnelData(); loadPendingReqs(); }}
        focusId={openLeaveId || openAdvanceId || openOvertimeId}
        focusKind={openLeaveId ? "leave" : openAdvanceId ? "advance" : openOvertimeId ? "overtime" : ""}
      />

      <div className="flex items-center gap-1 border-b border-slate-200 overflow-x-auto">
        {[["payroll", "Çalışanlar & Bordro", UserCheck], ["attendance", "Puantaj", Clock],
          ["leaves", "İzin Talepleri", CalendarDays], ["salary", "Maaş Hesaplama", Calculator], ["bonus", "Prim / İkinci Maaş", Gift]].map(([k, l, Icon]) => (
          <button key={k} onClick={() => setTab(k)} className={`flex items-center gap-1.5 px-3 py-2.5 text-xs font-semibold border-b-2 -mb-px whitespace-nowrap ${tab === k ? "border-emerald-600 text-emerald-700" : "border-transparent text-slate-500 hover:text-slate-800"}`} data-testid={`personnel-tab-${k}`}><Icon className="w-3.5 h-3.5" /> {l}</button>
        ))}
      </div>
      {tab === "attendance" && <AttendancePanel companyId={activeCompanyId(activeCompany)} focusId={openOvertimeId} />}
      {tab === "leaves" && <LeaveRequestsPanel companyId={activeCompanyId(activeCompany)} employees={employees} onChanged={loadPersonnelData} focusId={openLeaveId} />}
      {tab === "salary" && <SalaryCalculator />}
      {tab === "bonus" && <BonusPanel companyId={activeCompanyId(activeCompany)} employees={employees} accounts={bankAccounts} onChanged={loadPersonnelData} />}
      {tab === "payroll" && (<>
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between rounded-2xl border border-slate-200 bg-white px-4 py-3" data-testid="personnel-team-summary">
        <div className="text-sm font-bold text-slate-900">
          <span className="text-emerald-700">{team.inCount}</span>
          <span className="text-slate-400"> / {team.total}</span>
          {" "}şu an mesaide
        </div>
        <div className="text-left sm:text-right">
          <div className={`text-[11px] font-bold uppercase tracking-wide ${netTeam.tone === "owes" ? "text-rose-700" : netTeam.tone === "pay" ? "text-emerald-700" : "text-slate-500"}`}>{netTeam.label}</div>
          <div className={`text-base font-black ${netTeam.tone === "owes" ? "text-rose-800" : netTeam.tone === "pay" ? "text-emerald-800" : "text-slate-700"}`}>{fmtCardMoney(netTeam.amount)}</div>
        </div>
      </div>
      <div className="flex flex-wrap items-center gap-2">
        {[["all", "Tümü"], ["in", "Mesaide"], ["balance", "Bakiyesi olan"]].map(([id, label]) => (
          <button
            key={id}
            type="button"
            data-testid={`personnel-filter-${id}`}
            aria-pressed={empFilter === id}
            onClick={() => { setEmpFilter(id); setMenuKey(""); }}
            className={`rounded-full border px-3 py-1.5 text-xs font-semibold ${empFilter === id ? "border-slate-900 bg-slate-900 text-white" : "border-slate-200 bg-white text-slate-600 hover:bg-slate-50"}`}
          >
            {label}
          </button>
        ))}
      </div>
      <div className="flex flex-col gap-2" data-testid="employee-cards-grid">
        {shownEmployees.map((emp) => {
            const empKey = empIdOf(emp);
            const empReqs = requestsFor(emp);
            const cardOpen = Boolean(expandedCards[empKey]);
            const today = attToday[empKey];
            const view = balanceView(emp.balance);
            const state = presenceState(emp, today);
            const pill = PRESENCE_PILL[state];
            const presence = presenceChip(emp, today);
            const roleLine = [emp.position, emp.department].filter(Boolean).join(" · ") || "—";
            const punch = todayAttendanceParts(today);
            const otCap = assignedOvertimeCellCaption(today);
            const otOn = otCap !== "--:--";
            const menuOpen = menuKey === empKey;
            const idSuffix = emp.tc_kimlik || empKey;
            return (
          <div
            key={empKey}
            className={`min-w-0 bg-white rounded-2xl border border-slate-200/90 shadow-sm flex flex-col ${menuOpen ? "relative z-20" : ""} ${cardOpen ? "[contain-intrinsic-size:auto_480px]" : "[contain-intrinsic-size:auto_88px]"}`}
            data-testid={`employee-card-${emp.tc_kimlik}`}
            data-expanded={cardOpen ? "1" : "0"}
          >
          <div className="px-3 py-2 flex flex-col gap-3" data-testid={`employee-card-strip-${empKey}`}>
            <div
              role="button"
              tabIndex={0}
              aria-expanded={cardOpen}
              data-expanded={cardOpen ? "1" : "0"}
              data-testid={`employee-card-expand-${idSuffix}`}
              onClick={(event) => {
                if (cardToggleBlocked(event)) return;
                toggleCardExpanded(empKey);
              }}
              onKeyDown={(event) => {
                if (event.target !== event.currentTarget) return;
                if (event.key !== "Enter" && event.key !== " ") return;
                event.preventDefault();
                toggleCardExpanded(empKey);
              }}
              className="flex w-full min-w-0 cursor-pointer flex-col items-stretch gap-3.5 text-left md:flex-row md:flex-nowrap md:items-center min-h-[72px]"
            >
              <div className="contents items-center min-w-0" data-testid={`employee-card-identity-${empKey}`}>
                <div className="flex w-full min-w-0 shrink-0 items-center gap-3 md:w-[250px]">
                  <div className="relative shrink-0">
                    <div className="flex h-12 w-12 items-center justify-center overflow-hidden rounded-full border border-slate-200 bg-slate-100 text-sm font-black text-slate-500" data-testid={`employee-photo-${idSuffix}`}>
                      {emp.photo_url ? <img src={resolveImageUrl(emp.photo_url)} alt="" className="h-full w-full object-cover" /> : cardInitials(emp.full_name)}
                    </div>
                    <span className={`absolute bottom-0 right-0 h-3.5 w-3.5 rounded-full border-2 border-white ${pill.dot}`} />
                  </div>
                  <div className="min-w-0 flex-1 leading-tight">
                    <div className="flex items-center gap-1.5 min-w-0">
                      <h3 className="truncate text-sm font-bold text-slate-900">{emp.full_name}</h3>
                      {isDailyWage(emp) ? <span className="shrink-0 text-[9px] font-bold px-1 py-px rounded-full bg-amber-50 text-amber-800 border border-amber-200" data-testid={`employee-yevmiye-badge-${empKey}`}>Yevmiye</span> : null}
                      {empReqs.length > 0 ? (
                        <span className="relative shrink-0" title={`${empReqs.length} bekleyen talep`}>
                          <Bell className="w-3.5 h-3.5 text-amber-600" />
                          <span className="absolute -top-1.5 -right-1.5 min-w-[0.9rem] h-3.5 px-0.5 rounded-full bg-rose-600 text-white text-[8px] font-bold flex items-center justify-center">
                            {empReqs.length}
                          </span>
                        </span>
                      ) : null}
                    </div>
                    <div className="truncate text-[12px] text-slate-500">{roleLine}</div>
                    {presence ? (
                      <span
                        data-testid={`emp-presence-${empKey}`}
                        className="mt-0.5 inline-flex text-[9px] px-1.5 py-px rounded-full font-semibold border"
                        style={{ color: presence.color, backgroundColor: presence.bg, borderColor: presence.border }}
                      >
                        {presence.label}
                      </span>
                    ) : null}
                    {emp.workplace?.kind === "task" ? (
                      <div className="text-[10px] font-semibold text-indigo-700 truncate" data-testid={`employee-workplace-${empKey}`}>
                        Görev · {workplaceShort(emp.workplace)}
                      </div>
                    ) : null}
                  </div>
                  <span
                    data-testid={`employee-status-pill-${empKey}`}
                    className={`shrink-0 rounded-full border px-2 py-1 text-[11px] font-bold ${pill.box}`}
                  >
                    {pill.label}
                  </span>
                </div>

                <div className="flex min-w-0 flex-1 flex-wrap items-center gap-2">
                <div className={`w-full max-w-full shrink-0 rounded-2xl border px-3 py-3 md:w-[280px] ${BALANCE_BOX[view.tone]}`} data-testid={`employee-receivable-${idSuffix}`}>
                  <div className="flex items-start justify-between gap-3">
                    <div className="min-w-0">
                      <div className="text-xl font-black leading-none">{fmtCardMoney(view.amount)}</div>
                      <div className="mt-1 text-[11px] font-bold uppercase tracking-wide">{view.label}</div>
                    </div>
                    <div className="text-right text-[11px] font-semibold">
                      {emp.balance?.advances ? (
                        <div className="font-extrabold text-amber-800">Avans {fmtCardMoney(emp.balance.advances)}</div>
                      ) : null}
                      <div data-testid={`employee-leave-${empKey}`} className={view.tone === "zero" ? "text-slate-600" : "opacity-80"}>
                        {formatLeaveRemainingLine(emp)}
                        {emp.performance?.overall != null ? ` · %${emp.performance.overall}` : ""}
                      </div>
                    </div>
                  </div>
                  {!hasPayStartDate(emp) ? (
                    <span className="mt-1 block text-[11px] font-semibold text-amber-800" data-testid={`employee-no-pay-start-${idSuffix}`}>{PAY_START_MISSING_MSG}</span>
                  ) : null}
                </div>

                      <div className="w-[6.75rem] shrink-0" data-testid={`employee-card-today-${empKey}`}>
                        <button
                          type="button"
                          onClick={(event) => {
                            stopCardToggle(event);
                            setPunchConfirm({ id: empKey, action: "check_in", name: emp.full_name || "", time: cardPunchDraftTime("check_in", today) });
                          }}
                          disabled={punchBusyId === empKey}
                          className={`w-full rounded-xl border px-2 py-1.5 text-left disabled:opacity-50 ${punchConfirm?.id === empKey && punchConfirm.action === "check_in" ? "border-emerald-300 bg-emerald-100" : "border-slate-200 bg-white"}`}
                          data-testid={`employee-card-today-in-${empKey}`}
                          title="Unutulan giriş kaydı"
                        >
                          <div className="text-[8px] font-bold uppercase tracking-wide leading-none text-emerald-700">Giriş</div>
                          <div className="text-[13px] font-black leading-tight text-emerald-800">
                            {punch.checkIn}{punch.late ? ` · ${punch.late}dk` : ""}
                          </div>
                        </button>
                        {punchConfirm?.id === empKey && punchConfirm.action === "check_in" ? (
                          <div className="mt-1 flex flex-col gap-1" data-testid={`employee-card-punch-confirm-${empKey}`} onClick={stopCardToggle} onKeyDown={stopCardToggle}>
                            <label className={`text-[10px] font-bold ${punchLabelClass("Giriş saati")}`}>
                              Giriş saati
                              <input
                                type="time"
                                autoFocus
                                value={punchConfirm.time || ""}
                                onChange={(e) => setPunchConfirm((cur) => (cur ? { ...cur, time: e.target.value } : cur))}
                                className="mt-0.5 block w-full border rounded-lg p-1.5 bg-white"
                                data-testid={`employee-card-punch-time-${empKey}`}
                              />
                            </label>
                            <span className="min-w-0 text-[10px] text-slate-600">{cardPunchConfirmMessage(punchConfirm.action, punchConfirm.name)}</span>
                            <span className="text-[10px] font-semibold text-amber-700" data-testid={`employee-card-punch-hint-${empKey}`}>{cardPunchTimeHint(cardPunchAttempts(today, punchConfirm.action), punchConfirm.action)}</span>
                            <div className="flex items-center gap-1.5">
                              <button
                                type="button"
                                onClick={(event) => { stopCardToggle(event); cardPunch(emp, punchConfirm.action, punchConfirm.time); }}
                                disabled={punchBusyId === empKey}
                                className="shrink-0 px-2 py-0.5 rounded-md text-[10px] font-bold text-white disabled:opacity-50 bg-emerald-600"
                                data-testid={`employee-card-punch-yes-${empKey}`}
                              >
                                {punchBusyId === empKey ? "…" : "Kaydet"}
                              </button>
                              <button
                                type="button"
                                onClick={(event) => { stopCardToggle(event); setPunchConfirm(null); }}
                                className="shrink-0 px-2 py-0.5 rounded-md text-[10px] font-bold bg-slate-100 text-slate-700"
                                data-testid={`employee-card-punch-no-${empKey}`}
                              >
                                Vazgeç
                              </button>
                            </div>
                          </div>
                        ) : null}
                      </div>
                      <div className="w-[6.75rem] shrink-0 rounded-xl border border-slate-200 bg-white px-2 py-1.5" data-testid={`employee-card-today-work-${empKey}`}>
                        <div className="text-[8px] font-bold uppercase tracking-wide leading-none text-slate-400">Bugün mesai</div>
                        <div className="text-[13px] font-black leading-tight text-slate-800">{todayWorkLabel(today)}</div>
                      </div>
                      {otOn ? (
                      <div
                        className="w-[6.75rem] shrink-0 rounded-xl border border-indigo-200 bg-indigo-50 px-2 py-1.5 text-indigo-700"
                        data-testid={`employee-card-loc-${empKey}`}
                        title={`Atanan fazla mesai ${otCap}`}
                      >
                        <div data-testid={`employee-card-assigned-ot-${empKey}`}>
                          <div className="text-[8px] font-bold uppercase tracking-wide leading-none text-indigo-600">Mesai</div>
                          <div className="text-[13px] font-black leading-tight text-indigo-800">{otCap}</div>
                        </div>
                      </div>
                      ) : null}
                </div>

                <div className="flex shrink-0 flex-row flex-wrap items-center gap-1.5 md:ml-auto md:flex-nowrap" data-testid={`employee-card-right-${empKey}`}>
                    <div className="flex min-w-0 flex-1 flex-row flex-wrap items-center gap-1.5 md:flex-nowrap" data-testid={`employee-card-mid-${empKey}`} onClick={stopCardToggle} onKeyDown={stopCardToggle}>
                      {empReqs.length > 0 ? (
                      <div onClick={stopCardToggle}>
                        <EmployeeRequestChips
                          items={empReqs}
                          compact
                          testId={`employee-card-requests-${idSuffix}`}
                          busyId={busyReqId}
                          onDecideLeave={decideLeave}
                          onDecideEarly={decideEarly}
                          onDecideIntraday={decideIntraday}
                          onDecideAdvance={decideAdvance}
                          onDecideYevmiye={decideYevmiye}
                          onDecideLocationExit={decideLocationExit}
                          onDecideOvertimeConfirm={decideOvertimeConfirm}
                          onDecideGeoConfirm={decideGeoConfirm}
                          onDecideDispute={decideDispute}
                          onDecideWorkOrderTrash={decideWorkOrderTrash}
                          onViewDispute={() => setTab("attendance")}
                        />
                      </div>
                      ) : null}
                      <div className="flex shrink-0 flex-wrap items-center gap-1.5 md:flex-nowrap" data-testid={`employee-card-actions-${empKey}`}>
                        <button
                          type="button"
                          onClick={(event) => { stopCardToggle(event); openSettleFor(emp); }}
                          className="inline-flex h-9 items-center justify-center gap-1 rounded-lg bg-emerald-600 px-3 text-[11px] font-semibold text-white hover:bg-emerald-700 whitespace-nowrap"
                          title="Maaş, mesai, prim, yemek, yol, masraf ve avans"
                          data-testid={`employee-pay-btn-${idSuffix}`}
                        >
                          <Banknote className="w-3.5 h-3.5" /> {employeePayButtonLabel(emp)}
                        </button>
                        <button
                          type="button"
                          onClick={(event) => { stopCardToggle(event); setMovesEmp(emp); }}
                          className="inline-flex h-9 items-center justify-center gap-1 rounded-lg border border-slate-200 bg-white px-2.5 text-[11px] font-semibold text-slate-800 hover:bg-slate-50 whitespace-nowrap"
                          data-testid={`emp-card-moves-btn-${empKey}`}
                        >
                          <Receipt className="w-3.5 h-3.5" /> Hareketler
                        </button>
                        <CardMoreMenu empKey={empKey} open={menuOpen} onOpen={() => setMenuKey(empKey)} onClose={closeMenu}>
                          <span className="flex flex-col" data-testid={`employee-work-actions-${idSuffix}`}>
                            <button
                              type="button"
                              role="menuitem"
                              onClick={(event) => { stopCardToggle(event); setMenuKey(""); setTaskEmp(emp); }}
                              className={MENU_ITEM}
                              data-testid={`employee-task-btn-${idSuffix}`}
                            >
                              <ClipboardList className="w-3.5 h-3.5" /> Görev ata
                            </button>
                            <button
                              type="button"
                              role="menuitem"
                              onClick={(event) => { stopCardToggle(event); setMenuKey(""); openOvertimeFor(emp); }}
                              className={MENU_ITEM}
                              data-testid={`employee-overtime-btn-${idSuffix}`}
                            >
                              <Timer className="w-3.5 h-3.5" /> + Mesai
                            </button>
                          </span>
                          <button
                            type="button"
                            role="menuitem"
                            onClick={(event) => { stopCardToggle(event); setMenuKey(""); setCardEmp(emp); }}
                            className={MENU_ITEM}
                            data-testid={`employee-card-btn-${emp.tc_kimlik}`}
                          >
                            Kart
                          </button>
                          <button
                            type="button"
                            role="menuitem"
                            onClick={(event) => { stopCardToggle(event); setMenuKey(""); openEditEmployee(emp); }}
                            className={MENU_ITEM}
                            data-testid={`employee-edit-${emp.tc_kimlik || emp.id || emp._id}`}
                          >
                            <Pencil className="w-3.5 h-3.5" /> Düzenle
                          </button>
                          {canDeletePersonnel ? (
                            <button
                              type="button"
                              role="menuitem"
                              onClick={(event) => { stopCardToggle(event); setMenuKey(""); handleDeleteEmployee(emp); }}
                              className={`${MENU_ITEM} text-rose-700 hover:bg-rose-50`}
                              data-testid={`employee-delete-${emp.tc_kimlik || emp.id || emp._id}`}
                            >
                              <Trash2 className="w-3.5 h-3.5" /> Sil
                            </button>
                          ) : null}
                        </CardMoreMenu>
                      </div>
                    </div>
                  </div>
                </div>
            </div>

            {cardOpen ? (
                  <div className="w-full basis-full space-y-2 pt-1 border-t border-slate-100" data-testid={`employee-card-details-${idSuffix}`} onClick={stopCardToggle}>
                    <div className="flex flex-wrap gap-x-4 gap-y-1 text-xs text-slate-600">
                      <div className="flex items-center gap-1.5">
                        <Phone className="w-3.5 h-3.5 text-slate-400" />
                        <span>{emp.phone || '-'}</span>
                      </div>
                      <div className="flex items-center gap-1.5">
                        <Mail className="w-3.5 h-3.5 text-slate-400" />
                        <span>{emp.email || '-'}</span>
                      </div>
                    </div>

                    <div className="flex flex-col gap-1" data-testid={`employee-comp-${empKey}`}>
                      {employeeCompGroups(employeeCompRows(emp, emp.balance)).map((group) => (
                        <div
                          key={group.key}
                          className="min-w-0 rounded-lg bg-slate-50 px-2.5 py-1.5 space-y-0.5"
                          data-testid={`employee-comp-group-${group.key}-${empKey}`}
                        >
                          <div className="text-[9px] font-extrabold uppercase tracking-wide text-slate-400">{group.title}</div>
                          {group.rows.map((row) => (
                            <div key={row.key} className="flex items-baseline justify-between gap-2">
                              <span
                                className="min-w-0 truncate text-[10px] text-slate-500"
                                data-testid={row.key === "bonus" && row.days != null ? `employee-comp-bonus-days-${empKey}` : undefined}
                              >
                                {employeeCompRowCaption(row, isDailyWage(emp))}
                              </span>
                              <span
                                className={`shrink-0 text-[11px] font-extrabold ${row.key === "total" ? "text-emerald-700" : "text-slate-900"}`}
                                data-testid={
                                  row.key === "total" ? `employee-remaining-${empKey}`
                                    : row.key === "bonus" ? `employee-bonus-due-${idSuffix}`
                                      : row.key === "overtime" ? `employee-ot-due-${idSuffix}`
                                        : `employee-comp-${row.key}-${empKey}`
                                }
                              >
                                {fmtCardMoney(row.value)}
                              </span>
                            </div>
                          ))}
                        </div>
                      ))}
                    </div>
                  </div>
                ) : null}
          </div>
          </div>
            );
          })}
        {shownEmployees.length === 0 ? (
          <div className="w-full rounded-2xl border border-dashed border-slate-200 px-4 py-8 text-center text-sm text-slate-500">Bu filtrede personel yok.</div>
        ) : null}
      </div>
      {employeesHasMore && (
        <div ref={employeesSentinelRef} className="py-3 text-center text-[11px] text-slate-400" data-testid="personnel-load-more">
          Daha fazla personel yükleniyor…
        </div>
      )}

      {/* Payrolls Table */}
      <div className="bg-white rounded-2xl border border-slate-200/90 shadow-sm overflow-x-hidden min-w-0 space-y-3 p-5">
        <div className="flex items-center justify-between border-b pb-3">
          <div className="flex items-center gap-2">
            <DollarSign className="w-4 h-4 text-emerald-600" />
            <h2 className="text-base font-bold text-slate-900">Bordro & Maaş Ödeme Geçmişi</h2>
          </div>
        </div>

        {(() => {
          const payrollActions = (p, prefix) => {
            const pid = p.id || p._id;
            return (
              <>
                <button onClick={() => openQuickPay(p, "advance")} className="px-2.5 py-1 bg-amber-50 hover:bg-amber-100 text-amber-800 border border-amber-200 rounded-lg text-xs font-semibold" title="Avans ver (maaştan mahsup edilir)" data-testid={`${prefix}advance-btn-${p.employee_name}`}>Avans</button>
                <button onClick={() => openQuickPay(p, "expense")} className="px-2.5 py-1 bg-sky-50 hover:bg-sky-100 text-sky-800 border border-sky-200 rounded-lg text-xs font-semibold" title="Masraf ödemesi (yol, yemek, harcama)" data-testid={`${prefix}expense-btn-${p.employee_name}`}>Masraf</button>
                <button onClick={() => printPayslip(p, activeCompany)} className="px-2.5 py-1 bg-slate-50 hover:bg-slate-100 text-slate-700 border border-slate-200 rounded-lg text-xs font-semibold" title="Maaş bordrosu PDF (yazdır / kaydet)" data-testid={`${prefix}payslip-btn-${pid}`}>Bordro PDF</button>
                {p.status !== "paid" ? (
                  <button onClick={() => openSalaryPayModal(p)} className="px-3 py-1 bg-emerald-600 hover:bg-emerald-700 text-white rounded-lg text-xs font-semibold shadow-sm" data-testid={`${prefix}pay-salary-btn-${p.employee_name}`}>Maaşı Öde</button>
                ) : (
                  <span className="text-emerald-700 font-semibold text-[11px]">Tamamlandı</span>
                )}
                {payMoveCanDelete({ id: pid, kind: "payroll", status: p.status }) ? (
                  <button type="button" onClick={() => handleDeletePayroll(p)} className="px-2.5 py-1 bg-rose-50 hover:bg-rose-100 text-rose-700 border border-rose-200 rounded-lg text-xs font-semibold" title="Maaş kaydını sil (çöp kutusu)" data-testid={`${prefix}payroll-delete-btn-${pid}`}>Sil</button>
                ) : null}
              </>
            );
          };
          const payrollDesc = (p) => [
            `Net ${p.net_salary?.toLocaleString("tr-TR")} ₺`,
            `Brüt ${p.gross_salary?.toLocaleString("tr-TR")} ₺`,
            isDailyWage(p) ? payrollWageLine(p) : "",
            p.overtime_pay > 0 ? `+${p.overtime_pay.toLocaleString("tr-TR")} ₺ mesai (${p.overtime_hours} sa)` : "",
            p.second_salary > 0 ? `+${p.second_salary.toLocaleString("tr-TR")} ₺ 2. maaş` : "",
          ].filter(Boolean).join(" · ");
          const cards = pagedPayrolls.map((p) => {
            const pid = p.id || p._id;
            return (
              <TxMobileCard
                key={`card-${pid}`}
                testId={`payroll-card-${pid}`}
                date={`${p.period} Dönemi`}
                party={p.employee_name}
                badge={<TxTypeBadge label={p.status === "paid" ? "Giriş" : "Bekliyor"} kind={p.status === "paid" ? "giriş" : "other"} />}
                amount={`${p.final_payable?.toLocaleString("tr-TR")} ₺`}
                amountClassName="text-slate-900"
                description={payrollDesc(p)}
                actions={payrollActions(p, "card-")}
              />
            );
          });
          const table = (
          <table className="w-full text-left text-xs text-slate-600">
            <thead className="bg-slate-50 border-b border-slate-200 text-slate-500 uppercase font-semibold">
              <tr>
                <th className="px-4 py-2.5">Dönem & Personel</th>
                <th className="px-4 py-2.5 text-right">Net Maaş</th>
                <th className="px-4 py-2.5 text-right">Brüt (SGK Dahil)</th>
                <th className="px-4 py-2.5 text-right">Ödenecek Tutar</th>
                <th className="px-4 py-2.5">Durum</th>
                <th className="px-4 py-2.5 text-center">İşlem</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {pagedPayrolls.map((p) => (
                <tr key={p.id || p._id} className="hover:bg-slate-50/70 transition [content-visibility:auto] [contain-intrinsic-size:auto_48px]">
                  <td className={`px-4 py-2.5 ${TX_WRAP_CLASS}`}>
                    <div className="font-bold text-slate-900">{p.employee_name}{isDailyWage(p) ? <span className="ml-1.5 text-[10px] font-bold px-1.5 py-0.5 rounded-full bg-amber-50 text-amber-800 border border-amber-200">Yevmiye</span> : null}</div>
                    <div className="text-slate-400 text-[11px] font-mono">{p.period} Dönemi</div>
                  </td>
                  <td className="px-4 py-2.5 text-right text-slate-700 font-medium">
                    {p.net_salary?.toLocaleString('tr-TR')} ₺
                    {(isDailyWage(p) || p.overtime_pay > 0 || p.second_salary > 0) && <div className={`text-[10px] font-normal text-slate-500 ${TX_WRAP_CLASS}`} data-testid={`payroll-breakdown-${p.id || p._id}`}>{isDailyWage(p) ? <span className="text-amber-700">{payrollWageLine(p)}</span> : null}{isDailyWage(p) && (p.overtime_pay > 0 || p.second_salary > 0) ? " · " : null}{p.overtime_pay > 0 && <span className="text-indigo-700">+{p.overtime_pay.toLocaleString('tr-TR')} ₺ mesai ({p.overtime_hours} sa)</span>}{p.overtime_pay > 0 && p.second_salary > 0 && " · "}{p.second_salary > 0 && <span className="text-amber-700">+{p.second_salary.toLocaleString('tr-TR')} ₺ 2. maaş</span>}</div>}
                  </td>
                  <td className="px-4 py-2.5 text-right text-slate-500 font-mono">
                    {p.gross_salary?.toLocaleString('tr-TR')} ₺
                  </td>
                  <td className="px-4 py-2.5 text-right font-bold text-slate-900">
                    {p.final_payable?.toLocaleString('tr-TR')} ₺
                  </td>
                  <td className="px-4 py-2.5">
                    <span className={`inline-flex items-center gap-1 text-[11px] font-semibold px-2 py-0.5 rounded-full ${
                      p.status === 'paid' ? 'bg-emerald-50 text-emerald-700' : 'bg-amber-50 text-amber-700'
                    }`}>
                      {p.status === 'paid' ? <CheckCircle2 className="w-3 h-3" /> : <Clock className="w-3 h-3" />}
                      {p.status === 'paid' ? `Ödendi (${p.paid_date})` : 'Ödeme Bekliyor'}
                    </span>
                  </td>
                  <td className="px-4 py-2.5 text-center whitespace-nowrap">
                    {payrollActions(p, "")}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
          );
          return (
            <TxResponsiveList
              cards={cards}
              table={table}
              cardsTestId="payroll-tx-cards"
              tableWrapTestId="payroll-tx-table-wrap"
            />
          );
        })()}
        {payrollsHasMore && (
          <div ref={payrollsSentinelRef} className="pt-2 text-center text-[11px] text-slate-400" data-testid="payrolls-load-more">
            Daha fazla bordro yükleniyor…
          </div>
        )}
      </div>

      </>)}

      {/* SALARY PAYMENT MODAL */}
      {payPayrollItem && (() => {
        const payEmp = employees.find((x) => empIdOf(x) === String(payPayrollItem.employee_id || ""));
        const sgkPay = hasSgk(payEmp);
        return (
        <div className="fixed inset-0 z-50 bg-slate-900/60 backdrop-blur-sm flex items-center justify-center p-4">
          <div className="bg-white rounded-2xl max-w-md w-full p-6 space-y-4 shadow-2xl border border-slate-200" data-testid="salary-pay-modal">
            <div className="flex items-center justify-between border-b pb-2">
              <h3 className="text-base font-bold text-slate-900">Maaş Ödemesi Onayı</h3>
              <button onClick={() => setPayPayrollItem(null)} className="text-slate-400">
                <X className="w-5 h-5" />
              </button>
            </div>
            <div className="text-xs text-slate-700 space-y-3">
              <p>
                <strong>{payPayrollItem.employee_name}</strong> için <strong>{payPayrollItem.period}</strong> dönemi <strong>{payPayrollItem.final_payable?.toLocaleString('tr-TR')} ₺</strong> maaş ödemesi yapılacaktır.
              </p>
              {sgkPay && (
                <div className="rounded-lg border border-sky-200 bg-sky-50 px-3 py-2 text-sky-900" data-testid="salary-sgk-bank-hint">
                  SGK sicil no kayıtlı — ana maaş yalnız <b>banka hesabı</b>ndan ödenir.
                  {payEmp?.iban ? <div className="mt-1 font-mono text-[11px]">Personel IBAN: {payEmp.iban}</div> : <div className="mt-1 text-rose-700 font-semibold">Personel IBAN eksik — önce kartı güncelleyin.</div>}
                </div>
              )}
              <div>
                <label className="block font-semibold text-slate-700 mb-1">{sgkPay ? "Banka hesabı" : "Ödemenin yapılacağı hesap"}</label>
                <PaymentTargetSelect
                  companyId={activeCompanyId(activeCompany)}
                  accounts={bankAccounts}
                  value={selectedBankId}
                  onChange={setSelectedBankId}
                  testId="salary-pay-account"
                  allowedTypes={sgkPay ? ["bank"] : null}
                  includePartners={!sgkPay}
                  includeCreditCards={!sgkPay}
                />
              </div>
            </div>
            <div className="flex justify-end gap-2 pt-2 border-t">
              <button
                onClick={() => setPayPayrollItem(null)}
                className="px-3 py-1.5 border rounded-lg text-xs"
              >
                İptal
              </button>
              <button
                onClick={handleExecuteSalaryPayment}
                className="px-4 py-1.5 bg-emerald-600 text-white rounded-lg text-xs font-semibold"
                data-testid="confirm-salary-pay-btn"
              >
                Ödemeyi Tamamla
              </button>
            </div>
          </div>
        </div>
        );
      })()}

      {/* ADD / EDIT EMPLOYEE MODAL */}
      {showAddModal && (
        <div className="fixed inset-0 z-50 bg-slate-900/60 backdrop-blur-sm flex items-center justify-center p-4">
          <div className="bg-white rounded-2xl max-w-lg w-full p-6 space-y-4 shadow-2xl border border-slate-200 max-h-[92vh] overflow-y-auto" data-testid="employee-form-modal">
            <div className="flex items-center justify-between border-b pb-2">
              <h3 className="text-base font-bold text-slate-900">{editingEmp ? "Personeli Düzenle" : "Yeni Personel Ekle"}</h3>
              <button onClick={closeEmployeeModal} className="text-slate-400">
                <X className="w-5 h-5" />
              </button>
            </div>
            <form onSubmit={handleSaveEmployee} className="space-y-3 text-xs">
              <div className="flex items-center gap-3">
                <div className="w-16 h-16 rounded-2xl border border-dashed border-slate-300 bg-slate-50 flex items-center justify-center overflow-hidden shrink-0" data-testid="employee-photo-preview">
                  {newEmployee.photo_url ? <img src={resolveImageUrl(newEmployee.photo_url)} alt="" className="w-full h-full object-cover" /> : <ImageIcon className="w-7 h-7 text-slate-300" />}
                </div>
                <div className="space-y-1">
                  <label className="inline-flex items-center gap-1.5 px-3 py-2 border rounded-lg cursor-pointer hover:bg-slate-50 font-semibold">
                    <Upload className="w-3.5 h-3.5" /> Fotoğraf Yükle
                    <input type="file" accept="image/*" className="hidden" onChange={uploadEmployeePhoto} data-testid="employee-photo-input" />
                  </label>
                  {newEmployee.photo_url ? <button type="button" onClick={() => setNewEmployee({ ...newEmployee, photo_url: "" })} className="block text-[11px] text-slate-500 hover:text-rose-600 font-semibold" data-testid="employee-photo-clear">Fotoğrafı kaldır</button> : <p className="text-[11px] text-slate-500">Personel kartında görünür.</p>}
                </div>
              </div>
              <div>
                <label className="block font-semibold text-slate-700 mb-1">Ad Soyad</label>
                <input
                  type="text"
                  placeholder="Örn: Mehmet Özkan"
                  value={newEmployee.full_name}
                  onChange={(e) => setNewEmployee({ ...newEmployee, full_name: e.target.value })}
                  className="w-full bg-slate-50 border border-slate-200 rounded-lg p-2 font-medium"
                  data-testid="employee-name-input"
                />
              </div>
              <div className="grid grid-cols-2 gap-2">
                <div>
                  <label className="block font-semibold text-slate-700 mb-1">TC Kimlik No</label>
                  <input
                    type="text"
                    placeholder="11 haneli"
                    value={newEmployee.tc_kimlik}
                    onChange={(e) => setNewEmployee({ ...newEmployee, tc_kimlik: e.target.value })}
                    className="w-full bg-slate-50 border border-slate-200 rounded-lg p-2 font-mono"
                    data-testid="employee-tc-input"
                  />
                </div>
                <div>
                  <label className="block font-semibold text-slate-700 mb-1">Ücret tipi</label>
                  <div className="flex gap-1" data-testid="employee-pay-type">
                    <button type="button" onClick={() => setNewEmployee({ ...newEmployee, pay_type: "monthly" })} className={`flex-1 py-2 rounded-lg text-xs font-semibold border ${newEmployee.pay_type === "daily" ? "bg-white text-slate-600 border-slate-200" : "bg-emerald-600 text-white border-emerald-600"}`} data-testid="employee-pay-monthly">Aylık maaş</button>
                    <button type="button" onClick={() => setNewEmployee({ ...newEmployee, pay_type: "daily" })} className={`flex-1 py-2 rounded-lg text-xs font-semibold border ${newEmployee.pay_type === "daily" ? "bg-amber-500 text-white border-amber-500" : "bg-white text-slate-600 border-slate-200"}`} data-testid="employee-pay-daily">Günlük yevmiye</button>
                  </div>
                </div>
              </div>
              {newEmployee.pay_type === "daily" ? (
                <div>
                  <label className="block font-semibold text-slate-700 mb-1">Günlük yevmiye (₺)</label>
                  <MoneyInput
                    value={newEmployee.daily_wage}
                    onChange={(n) => setNewEmployee({ ...newEmployee, daily_wage: n ?? "" })}
                    className="w-full bg-slate-50 border border-slate-200 rounded-lg p-2 font-bold text-slate-900"
                    data-testid="employee-daily-wage-input"
                    placeholder="Örn: 1500"
                  />
                  <p className="text-[10px] text-slate-400 mt-1">Bordro = yevmiye × o ay gelen gün. Tahmini ay: {((Number(newEmployee.daily_wage) || 0) * 26).toLocaleString("tr-TR")} ₺ (26 gün).</p>
                </div>
              ) : (
                <div>
                  <label className="block font-semibold text-slate-700 mb-1">Net maaş (₺)</label>
                  <MoneyInput
                    value={newEmployee.salary}
                    onChange={(n) => setNewEmployee({ ...newEmployee, salary: n ?? "" })}
                    className="w-full bg-slate-50 border border-slate-200 rounded-lg p-2 font-bold text-slate-900"
                    data-testid="employee-salary-input"
                  />
                </div>
              )}
              <div className="grid grid-cols-2 gap-2">
                <div>
                  <label className="block font-semibold text-slate-700 mb-1">Departman</label>
                  <input
                    type="text"
                    value={newEmployee.department}
                    onChange={(e) => setNewEmployee({ ...newEmployee, department: e.target.value })}
                    className="w-full bg-slate-50 border border-slate-200 rounded-lg p-2"
                    data-testid="employee-department-input"
                  />
                </div>
                <div>
                  <label className="block font-semibold text-slate-700 mb-1">Pozisyon / Görev</label>
                  <select
                    value={newEmployee.position}
                    onChange={(e) => setNewEmployee({ ...newEmployee, position: e.target.value })}
                    className="w-full bg-slate-50 border border-slate-200 rounded-lg p-2"
                    data-testid="employee-position-input"
                  >
                    <option value="">Rol seçin…</option>
                    {positionOptionsFromRoles(roleOptions, newEmployee.position).map((o) => (
                      <option key={`${o.code}-${o.value}`} value={o.value}>{o.label}</option>
                    ))}
                  </select>
                </div>
              </div>
              <div className="grid grid-cols-2 gap-2">
                <div>
                  <label className="block font-semibold text-slate-700 mb-1">Telefon</label>
                  <input
                    type="text"
                    placeholder="05..."
                    value={newEmployee.phone}
                    onChange={(e) => setNewEmployee({ ...newEmployee, phone: e.target.value })}
                    className="w-full bg-slate-50 border border-slate-200 rounded-lg p-2"
                    data-testid="employee-phone-input"
                  />
                </div>
                <div>
                  <label className="block font-semibold text-slate-700 mb-1">E-Posta</label>
                  <input
                    type="email"
                    placeholder="ornek@tamkobi.com"
                    value={newEmployee.email}
                    onChange={(e) => setNewEmployee({ ...newEmployee, email: e.target.value })}
                    className="w-full bg-slate-50 border border-slate-200 rounded-lg p-2"
                    data-testid="employee-email-input"
                  />
                </div>
              </div>
              <div>
                <label className="block font-semibold text-slate-700 mb-1">Yıllık izin hakkı (gün)</label>
                <input
                  type="number"
                  min="0"
                  max="365"
                  step="1"
                  value={newEmployee.annual_leave_days}
                  onChange={(e) => setNewEmployee({ ...newEmployee, annual_leave_days: e.target.value })}
                  className="w-full bg-slate-50 border border-slate-200 rounded-lg p-2 font-bold text-slate-900"
                  data-testid="employee-annual-leave-input"
                />
                <p className="text-[10px] text-slate-400 mt-1">Personel kartı → İzinler sekmesinden de değiştirilebilir.</p>
              </div>

              <button
                type="button"
                onClick={() => setShowEmpDetails((v) => !v)}
                className="w-full flex items-center justify-between px-3 py-2 rounded-lg border border-slate-200 bg-slate-50 hover:bg-slate-100 font-semibold text-slate-800"
                data-testid="employee-details-toggle"
              >
                <span>Ayrıntılar {String(newEmployee.sgk_number || "").trim() ? "· SGK" : ""}</span>
                {showEmpDetails ? <ChevronUp className="w-4 h-4" /> : <ChevronDown className="w-4 h-4" />}
              </button>

              {showEmpDetails && (
                <div className="space-y-3 rounded-xl border border-slate-200 bg-slate-50/60 p-3" data-testid="employee-details-section">
                  <div className="grid grid-cols-2 gap-2">
                    <div className="col-span-2 flex flex-wrap items-end gap-3">
                      <label className="inline-flex items-center gap-2 font-semibold text-slate-700">
                        <input
                          type="checkbox"
                          checked={Boolean(newEmployee.sgk_insured)}
                          onChange={(e) => setNewEmployee({ ...newEmployee, sgk_insured: e.target.checked })}
                          data-testid="employee-sgk-insured"
                        />
                        SGK&apos;lı
                      </label>
                      <div className="flex-1 min-w-[8rem]">
                        <label className="block font-semibold text-slate-700 mb-1">Resmi maaş (₺)</label>
                        <MoneyInput
                          value={newEmployee.official_salary}
                          onChange={(n) => setNewEmployee({ ...newEmployee, official_salary: n ?? "" })}
                          className="w-full bg-white border border-slate-200 rounded-lg p-2"
                          data-testid="employee-official-salary"
                        />
                      </div>
                    </div>
                    <div>
                      <label className="block font-semibold text-slate-700 mb-1">SGK Sicil No</label>
                      <input
                        type="text"
                        inputMode="numeric"
                        placeholder="13 haneli"
                        value={newEmployee.sgk_number}
                        onChange={(e) => setNewEmployee({ ...newEmployee, sgk_number: e.target.value.replace(/\D/g, "").slice(0, 13) })}
                        className="w-full bg-white border border-slate-200 rounded-lg p-2 font-mono"
                        data-testid="employee-sgk-input"
                      />
                    </div>
                    <div>
                      <label className="block font-semibold text-slate-700 mb-1">İşe giriş</label>
                      <input
                        type="date"
                        value={newEmployee.start_date}
                        onChange={(e) => setNewEmployee({ ...newEmployee, start_date: e.target.value })}
                        className="w-full bg-white border border-slate-200 rounded-lg p-2"
                        data-testid="employee-start-date-input"
                      />
                    </div>
                  </div>
                  <div>
                    <label className="block font-semibold text-slate-700 mb-1">IBAN {(String(newEmployee.sgk_number || "").trim() || newEmployee.sgk_insured) ? <span className="text-rose-600">(zorunlu)</span> : null}</label>
                    <input
                      type="text"
                      placeholder="TR.."
                      value={newEmployee.iban}
                      onChange={(e) => setNewEmployee({ ...newEmployee, iban: e.target.value.toUpperCase() })}
                      className="w-full bg-white border border-slate-200 rounded-lg p-2 font-mono"
                      data-testid="employee-iban-input"
                    />
                    {(String(newEmployee.sgk_number || "").trim() || newEmployee.sgk_insured) ? (
                      <p className="text-[10px] text-sky-800 mt-1" data-testid="employee-sgk-bank-hint">SGK&apos;lı personelin resmi maaşı bankadan ödenmelidir. Resmi maaşı aşan kısım, avans, prim ve masraf kasadan ödenebilir.</p>
                    ) : null}
                  </div>
                  <div className="grid grid-cols-2 gap-2">
                    <div>
                      <label className="block font-semibold text-slate-700 mb-1">Yemek ücreti (aylık ₺)</label>
                      <MoneyInput
                        value={newEmployee.meal_allowance}
                        onChange={(n) => setNewEmployee({ ...newEmployee, meal_allowance: n ?? "" })}
                        className="w-full bg-white border border-slate-200 rounded-lg p-2"
                        data-testid="employee-meal-allowance-input"
                      />
                    </div>
                    <div>
                      <label className="block font-semibold text-slate-700 mb-1">Yol ödemesi (aylık ₺)</label>
                      <MoneyInput
                        value={newEmployee.transport_allowance}
                        onChange={(n) => setNewEmployee({ ...newEmployee, transport_allowance: n ?? "" })}
                        className="w-full bg-white border border-slate-200 rounded-lg p-2"
                        data-testid="employee-transport-allowance-input"
                      />
                    </div>
                  </div>
                  <div className="grid grid-cols-2 gap-2">
                    <div>
                      <label className="block font-semibold text-slate-700 mb-1">Doğum tarihi</label>
                      <input
                        type="date"
                        value={newEmployee.birth_date}
                        onChange={(e) => setNewEmployee({ ...newEmployee, birth_date: e.target.value })}
                        className="w-full bg-white border border-slate-200 rounded-lg p-2"
                        data-testid="employee-birth-date-input"
                      />
                    </div>
                    <div>
                      <label className="block font-semibold text-slate-700 mb-1">Acil durum iletişim</label>
                      <input
                        type="text"
                        placeholder="Ad · telefon"
                        value={newEmployee.emergency_contact}
                        onChange={(e) => setNewEmployee({ ...newEmployee, emergency_contact: e.target.value })}
                        className="w-full bg-white border border-slate-200 rounded-lg p-2"
                        data-testid="employee-emergency-input"
                      />
                    </div>
                  </div>
                  <div className="grid grid-cols-2 gap-2">
                    <div>
                      <label className="block font-semibold text-slate-700 mb-1">Medeni durum</label>
                      <select
                        value={newEmployee.marital_status}
                        onChange={(e) => setNewEmployee({ ...newEmployee, marital_status: e.target.value })}
                        className="w-full bg-white border border-slate-200 rounded-lg p-2"
                        data-testid="employee-marital-status-input"
                      >
                        {MARITAL_STATUS_OPTIONS.map((o) => (
                          <option key={o.value || "empty"} value={o.value}>{o.label}</option>
                        ))}
                      </select>
                    </div>
                    <div>
                      <label className="block font-semibold text-slate-700 mb-1">Kan grubu</label>
                      <select
                        value={newEmployee.blood_type}
                        onChange={(e) => setNewEmployee({ ...newEmployee, blood_type: e.target.value })}
                        className="w-full bg-white border border-slate-200 rounded-lg p-2"
                        data-testid="employee-blood-type-input"
                      >
                        {BLOOD_TYPE_OPTIONS.map((o) => (
                          <option key={o.value || "empty"} value={o.value}>{o.label}</option>
                        ))}
                      </select>
                    </div>
                  </div>
                  <div>
                    <label className="block font-semibold text-slate-700 mb-1">Hastalıkları</label>
                    <textarea
                      rows={2}
                      placeholder="Kronik hastalık, alerji, ilaç vb."
                      value={newEmployee.illnesses}
                      onChange={(e) => setNewEmployee({ ...newEmployee, illnesses: e.target.value })}
                      className="w-full bg-white border border-slate-200 rounded-lg p-2 resize-none"
                      data-testid="employee-illnesses-input"
                    />
                  </div>
                  <div>
                    <label className="block font-semibold text-slate-700 mb-1">İş güvenliği bilgileri</label>
                    <textarea
                      rows={2}
                      placeholder="İSG eğitimi, sertifika, ekipman notları vb."
                      value={newEmployee.safety_info}
                      onChange={(e) => setNewEmployee({ ...newEmployee, safety_info: e.target.value })}
                      className="w-full bg-white border border-slate-200 rounded-lg p-2 resize-none"
                      data-testid="employee-safety-info-input"
                    />
                  </div>
                  <div>
                    <label className="block font-semibold text-slate-700 mb-1">Adres</label>
                    <input
                      type="text"
                      value={newEmployee.address}
                      onChange={(e) => setNewEmployee({ ...newEmployee, address: e.target.value })}
                      className="w-full bg-white border border-slate-200 rounded-lg p-2"
                      data-testid="employee-address-input"
                    />
                  </div>
                  <div>
                    <label className="block font-semibold text-slate-700 mb-1">Notlar</label>
                    <textarea
                      rows={2}
                      value={newEmployee.notes}
                      onChange={(e) => setNewEmployee({ ...newEmployee, notes: e.target.value })}
                      className="w-full bg-white border border-slate-200 rounded-lg p-2 resize-none"
                      data-testid="employee-notes-input"
                    />
                  </div>
                </div>
              )}

              <div className="flex justify-end gap-2 pt-2 border-t">
                <button
                  type="button"
                  onClick={closeEmployeeModal}
                  className="px-3 py-1.5 border rounded-lg text-xs"
                >
                  İptal
                </button>
                <button
                  type="submit"
                  className="px-4 py-1.5 bg-emerald-600 text-white rounded-lg text-xs font-semibold"
                  data-testid="save-employee-btn"
                >
                  {editingEmp ? "Güncelle" : "Personeli Kaydet"}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
      {cardEmp && <EmployeeCardModal employee={cardEmp} companyId={companyId} accounts={bankAccounts} sgkSalaryBankOnly={sgkSalaryBankOnly} onClose={() => setCardEmp(null)} onChanged={loadPersonnelData} />}
      {settlePay ? (
        <EmployeePayModal
          employee={settlePay.emp}
          companyId={companyId}
          accounts={bankAccounts}
          card={{ employee: settlePay.emp, balance: settlePay.emp?.balance }}
          initialKind={settlePay.kind}
          sgkSalaryBankOnly={sgkSalaryBankOnly}
          onClose={() => setSettlePay(null)}
          onDone={() => { setSettlePay(null); loadPersonnelData(); }}
        />
      ) : null}
      {movesEmp ? (
        <EmployeeMovesModal
          employee={movesEmp}
          onClose={() => setMovesEmp(null)}
          onChanged={loadPersonnelData}
        />
      ) : null}
      {quickPay && <QuickPayModal
        payroll={quickPay.p}
        type={quickPay.type}
        companyId={companyId}
        accounts={bankAccounts}
        initialMode={quickPay.initialMode}
        initialCategory={quickPay.category}
        initialDescription={quickPay.description}
        initialAmount={quickPay.amount}
        allowances={(() => {
          const emp = employees.find((x) => empIdOf(x) === String(quickPay.p.employee_id || ""));
          return {
            meal: emp?.meal_allowance,
            transport: emp?.transport_allowance,
            mealDue: emp?.balance?.meal_due,
            transportDue: emp?.balance?.transport_due,
          };
        })()}
        onClose={() => setQuickPay(null)}
        onDone={loadPersonnelData}
      />}
      {taskEmp && (
        <EmployeeAssignTaskModal
          employee={taskEmp}
          companyId={companyId}
          onClose={() => setTaskEmp(null)}
          onSaved={() => { notifyDataChanged({ companyId, scopes: ["personnel"] }); loadPersonnelData(); }}
        />
      )}
      {ledgerEmp && (
        <EmployeeLedgerModal
          employee={ledgerEmp}
          companyId={companyId}
          accounts={bankAccounts}
          remaining={Number(ledgerEmp?.balance?.remaining) || 0}
          advances={Number(ledgerEmp?.balance?.advances) || 0}
          onClose={() => setLedgerEmp(null)}
          onDone={loadPersonnelData}
        />
      )}
      {yevmiyeEmp && (
        <EmployeeYevmiyeModal
          employee={yevmiyeEmp}
          companyId={companyId}
          accounts={bankAccounts}
          haveDays={yevmiyeDaysOf(yevmiyeEmp)}
          onClose={() => setYevmiyeEmp(null)}
          onDone={loadPersonnelData}
        />
      )}
      {otAssign && (
        <AssignOvertimeModal
          value={otAssign}
          onChange={setOtAssign}
          onClose={() => setOtAssign(null)}
          onSave={saveOvertime}
          testIdPrefix="emp-ot"
        />
      )}
    </div>
  );
}
