import React, { useState, useEffect, useCallback } from "react";
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
import { EmployeeAssignTaskModal } from "../components/EmployeeAssignTaskModal";
import { AssignOvertimeModal } from "../components/AssignOvertimeModal";
import { GeoAttendanceCard } from "../components/GeoAttendanceCard";
import { QuickPayModal } from "../components/QuickPayModal";
import { PaymentTargetSelect, splitPaymentTarget } from "../components/PaymentTargetSelect";
import { EmployeeRequestChips, PersonnelRequestsInbox } from "../components/PersonnelRequestsInbox";
import { empIdOf } from "../utils/personnelIds";
import { isDailyWage, payrollWageLine, totalMonthlyLoad } from "../utils/personnelWage";

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
  Wallet,
  Banknote,
  ClipboardList,
  Timer,
  UtensilsCrossed,
  Bus,
  Bell,
  Upload,
  Image as ImageIcon,
  ChevronDown,
  ChevronUp,
} from "lucide-react";
import { notifyDataChanged, useDataRefresh } from "../utils/dataRefresh";

const hasSgk = (emp) => Boolean(String(emp?.sgk_number || "").trim());
const isBankAcc = (a) => {
  const t = String(a?.type || "").toLowerCase();
  return t === "bank" || (!t && (a?.iban || a?.bank_name));
};

export default function PersonnelPage() {
  const { activeCompany } = useAuth();
  const [employees, setEmployees] = useState([]);
  const [searchParams, setSearchParams] = useSearchParams();
  const tab = searchParams.get("tab") || "payroll";
  const setTab = (t) => setSearchParams({ tab: t }, { replace: true });
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
  const [busySalaryId, setBusySalaryId] = useState(null);
  const [otAssign, setOtAssign] = useState(null);
  const [taskEmp, setTaskEmp] = useState(null);

  const companyId = activeCompany?.id || activeCompany?._id || "comp_nexus_main_01";

  const emptyEmployee = {
    full_name: "",
    tc_kimlik: "",
    department: "Satış & Pazarlama",
    position: "Uzman",
    phone: "",
    email: "",
    salary: 35000,
    pay_type: "monthly",
    daily_wage: "",
    start_date: new Date().toISOString().split("T")[0],
    photo_url: "",
    sgk_number: "",
    iban: "",
    meal_allowance: "",
    transport_allowance: "",
    birth_date: "",
    address: "",
    emergency_contact: "",
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
      start_date: emp.start_date || new Date().toISOString().split("T")[0],
      photo_url: emp.photo_url || "",
      sgk_number: emp.sgk_number || "",
      iban: emp.iban || "",
      meal_allowance: emp.meal_allowance ?? "",
      transport_allowance: emp.transport_allowance ?? "",
      birth_date: emp.birth_date || "",
      address: emp.address || "",
      emergency_contact: emp.emergency_contact || "",
      notes: emp.notes || "",
    });
    setShowEmpDetails(Boolean(emp.sgk_number || emp.iban || emp.meal_allowance || emp.transport_allowance || emp.address || emp.birth_date || emp.emergency_contact || emp.notes));
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
      const r = await axios.post(`${API_URL}/files/upload?entity=employee_photo&entity_id=${encodeURIComponent(eid)}&company_id=${encodeURIComponent(companyId)}`, fd);
      setNewEmployee((prev) => ({ ...prev, photo_url: r.data.url }));
      toast.success(r.data?.saved_pct ? `Fotoğraf yüklendi (≈%${r.data.saved_pct} küçültüldü).` : "Fotoğraf yüklendi.");
    } catch (err) {
      toast.error(err.response?.data?.detail || "Fotoğraf yüklenemedi.");
    }
  };

  const loadPersonnelData = useCallback(async () => {
    try {
      setLoading(true);
      const [empRes, payRes, bankRes] = await Promise.all([
        axios.get(`${API_URL}/personnel/employees?company_id=${companyId}`),
        axios.get(`${API_URL}/personnel/payrolls?company_id=${companyId}`),
        axios.get(`${API_URL}/banking/accounts?company_id=${companyId}`)
      ]);
      setEmployees(empRes.data);
      setPayrolls(payRes.data);
      setBankAccounts(bankRes.data);
      if (bankRes.data.length > 0) setSelectedBankId(bankRes.data[0].id || bankRes.data[0]._id);
    } catch (err) {
      toast.error("Personel verileri yüklenemedi.");
    } finally {
      setLoading(false);
    }
  }, [companyId]);
  useEffect(() => { loadPersonnelData(); }, [loadPersonnelData]);
  const refreshPersonnelSilent = useCallback(() => loadPersonnelData(), [loadPersonnelData]);
  useDataRefresh(refreshPersonnelSilent, { companyId, scopes: ["cash", "expenses", "contacts"] });

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
  useDataRefresh(loadPendingReqs, { companyId, scopes: ["personnel", "attendance"] });

  const handleSaveEmployee = async (e) => {
    e.preventDefault();
    if (!newEmployee.full_name || !newEmployee.tc_kimlik) {
      toast.error("Lütfen ad soyad ve TC kimlik no girin.");
      return;
    }
    const sgk = String(newEmployee.sgk_number || "").trim();
    const iban = String(newEmployee.iban || "").trim();
    if (sgk && !iban) {
      setShowEmpDetails(true);
      toast.error("SGK sicil numarası girildiğinde IBAN zorunludur — maaş yalnız bankadan ödenir.");
      return;
    }
    const daily = Number(newEmployee.daily_wage || 0);
    const monthly = Number(newEmployee.salary || 0);
    const isDaily = newEmployee.pay_type === "daily";
    const body = {
      ...newEmployee,
      pay_type: isDaily ? "daily" : "monthly",
      daily_wage: isDaily ? daily : 0,
      salary: isDaily ? Math.round(daily * 26 * 100) / 100 : monthly,
      sgk_number: sgk || null,
      iban: iban || null,
      meal_allowance: Number(newEmployee.meal_allowance || 0) || 0,
      transport_allowance: Number(newEmployee.transport_allowance || 0) || 0,
      birth_date: newEmployee.birth_date || null,
      address: String(newEmployee.address || "").trim() || null,
      emergency_contact: String(newEmployee.emergency_contact || "").trim() || null,
      notes: String(newEmployee.notes || "").trim() || null,
    };
    try {
      if (editingEmp) {
        const id = editingEmp.id || editingEmp._id;
        await axios.put(`${API_URL}/personnel/employees/${id}`, body);
        toast.success("Personel güncellendi.");
      } else {
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
    try {
      const currentMonth = new Date().toISOString().slice(0, 7);
      const res = await axios.post(`${API_URL}/personnel/generate-payroll`, {
        company_id: activeCompany?.id || activeCompany?._id || "comp_nexus_main_01",
        period: currentMonth
      });
      toast.success(res.data.message);
      loadPersonnelData();
    } catch (err) {
      toast.error("Bordro hesaplanamadı.");
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

  const payrollStubFor = (emp) => {
    const eid = empIdOf(emp);
    const list = payrolls.filter((p) => empIdOf(p) === eid || String(p.employee_id || "") === eid);
    return list.find((p) => p.status !== "paid") || list[0] || {
      employee_id: eid,
      employee_name: emp.full_name,
      period: new Date().toISOString().slice(0, 7),
    };
  };

  const openAdvanceFor = (emp) => setQuickPay({ p: payrollStubFor(emp), type: "advance" });
  const openBonusFor = (emp) => {
    const due = Number(emp?.balance?.bonus_pending || 0) || 0;
    setQuickPay({ p: payrollStubFor(emp), type: "bonus", amount: due > 0 ? due : "" });
  };
  const openOtPayFor = (emp) => {
    const due = Number(emp?.balance?.overtime_due ?? emp?.balance?.overtime_pay ?? 0) || 0;
    setQuickPay({ p: payrollStubFor(emp), type: "overtime", amount: due > 0 ? due : "" });
  };

  const openMealExpenseFor = (emp) => {
    const bal = emp?.balance || {};
    const due = Number(bal.meal_due ?? emp.meal_allowance ?? 0) || 0;
    setQuickPay({
      p: payrollStubFor(emp),
      type: "expense",
      category: "Yemek",
      description: "Yemek ücreti",
      amount: due > 0 ? due : "",
      initialMode: "new",
    });
  };

  const openTransportExpenseFor = (emp) => {
    const bal = emp?.balance || {};
    const due = Number(bal.transport_due ?? emp.transport_allowance ?? 0) || 0;
    setQuickPay({
      p: payrollStubFor(emp),
      type: "expense",
      category: "Yol / Ulaşım",
      description: "Yol / ulaşım ödemesi",
      amount: due > 0 ? due : "",
      initialMode: "new",
    });
  };

  const openSalaryFor = async (emp) => {
    const eid = empIdOf(emp);
    let item = payrolls.find((p) => (empIdOf(p) === eid || String(p.employee_id || "") === eid) && p.status !== "paid");
    if (!item) {
      setBusySalaryId(eid);
      try {
        const period = new Date().toISOString().slice(0, 7);
        await axios.post(`${API_URL}/personnel/generate-payroll`, { company_id: companyId, period });
        const payRes = await axios.get(`${API_URL}/personnel/payrolls?company_id=${companyId}`);
        setPayrolls(payRes.data);
        item = (payRes.data || []).find((p) => (empIdOf(p) === eid || String(p.employee_id || "") === eid) && p.status !== "paid");
        if (!item) {
          toast.success("Bu dönemin maaşı zaten ödenmiş.");
          return;
        }
      } catch (err) {
        toast.error(err.response?.data?.detail || "Bordro hazırlanamadı.");
        return;
      } finally {
        setBusySalaryId(null);
      }
    }
    setPayPayrollItem(item);
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

  const decideEarly = async (id, decision) => {
    setBusyReqId(id);
    try {
      const r = await axios.post(`${API_URL}/personnel/attendance/${id}/early-leave-decision`, { decision });
      toast.success(r.data?.message || (decision === "approve" ? "Onaylandı" : "Reddedildi"));
      await afterRequestDecision();
    } catch (err) {
      toast.error(err.response?.data?.detail || "İşlem başarısız.");
    } finally {
      setBusyReqId(null);
    }
  };

  const decideIntraday = async (id, decision) => {
    setBusyReqId(id);
    try {
      const r = await axios.post(`${API_URL}/personnel/attendance/${id}/intraday-leave-decision`, { decision });
      toast.success(r.data?.message || (decision === "approve" ? "Onaylandı" : "Reddedildi"));
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

  return (
    <div className="space-y-6" data-testid="personnel-page">
      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div>
          <h1 className="text-xl sm:text-2xl font-bold text-slate-900 tracking-tight">Personel & Bordro Modülü</h1>
          <p className="text-xs sm:text-sm text-slate-500">
            Aylık Toplam Net Maaş Yükü: <span className="font-bold text-slate-900">{totalMonthlyPayroll.toLocaleString('tr-TR')} ₺</span>
            {hasDaily ? <span className="text-slate-400"> · yevmiye × 26 gün tahmini</span> : null}
          </p>
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

      <GeoAttendanceCard companyId={activeCompany?.id || activeCompany?._id || "comp_nexus_main_01"} onChanged={loadPersonnelData} />

      <PersonnelRequestsInbox
        companyId={companyId}
        onChanged={() => { loadPersonnelData(); loadPendingReqs(); }}
      />

      <div className="flex items-center gap-1 border-b border-slate-200 overflow-x-auto">
        {[["payroll", "Çalışanlar & Bordro", UserCheck], ["attendance", "Puantaj", Clock],
          ["leaves", "İzin Talepleri", CalendarDays], ["salary", "Maaş Hesaplama", Calculator], ["bonus", "Prim / İkinci Maaş", Gift]].map(([k, l, Icon]) => (
          <button key={k} onClick={() => setTab(k)} className={`flex items-center gap-1.5 px-3 py-2.5 text-xs font-semibold border-b-2 -mb-px whitespace-nowrap ${tab === k ? "border-emerald-600 text-emerald-700" : "border-transparent text-slate-500 hover:text-slate-800"}`} data-testid={`personnel-tab-${k}`}><Icon className="w-3.5 h-3.5" /> {l}</button>
        ))}
      </div>
      {tab === "attendance" && <AttendancePanel companyId={activeCompany?.id || activeCompany?._id || "comp_nexus_main_01"} />}
      {tab === "leaves" && <LeaveRequestsPanel companyId={activeCompany?.id || activeCompany?._id || "comp_nexus_main_01"} employees={employees} onChanged={loadPersonnelData} />}
      {tab === "salary" && <SalaryCalculator />}
      {tab === "bonus" && <BonusPanel companyId={activeCompany?.id || activeCompany?._id || "comp_nexus_main_01"} employees={employees} accounts={bankAccounts} onChanged={loadPersonnelData} />}
      {tab === "payroll" && (<>
      {/* Employees Cards Grid */}
      <div className="grid grid-cols-1 md:grid-cols-3 gap-5">
        {employees.map((emp) => {
            const empKey = empIdOf(emp);
            const empReqs = requestsFor(emp);
            return (
          <div
            key={empKey}
            className="bg-white p-5 rounded-2xl border border-slate-200/90 shadow-sm space-y-3 flex flex-col justify-between"
            data-testid={`employee-card-${emp.tc_kimlik}`}
          >
            <div className="space-y-2">
              <div className="flex items-start justify-between gap-2">
                <div className="flex items-start gap-2.5 min-w-0">
                  <div className="w-10 h-10 rounded-xl overflow-hidden bg-slate-100 border border-slate-200 flex items-center justify-center shrink-0 text-[11px] font-black text-slate-500" data-testid={`employee-photo-${emp.tc_kimlik || empKey}`}>
                    {emp.photo_url ? <img src={resolveImageUrl(emp.photo_url)} alt="" className="w-full h-full object-cover" /> : (emp.full_name || "?").split(" ").map((w) => w[0]).filter(Boolean).slice(0, 2).join("").toUpperCase()}
                  </div>
                  <div className="min-w-0">
                  <h3 className="font-bold text-slate-900 text-sm">{emp.full_name}</h3>
                  {isDailyWage(emp) ? <span className="inline-block mt-0.5 text-[10px] font-bold px-1.5 py-0.5 rounded-full bg-amber-50 text-amber-800 border border-amber-200" data-testid={`employee-yevmiye-badge-${empKey}`}>Yevmiye</span> : null}
                  <div className="text-xs text-indigo-600 font-semibold">{emp.position}</div>
                  <div className="text-[11px] text-slate-400">{emp.department}</div>
                  </div>
                </div>
                <div className="flex items-center gap-1 shrink-0">
                  {empReqs.length > 0 && (
                    <span className="relative mr-0.5" title={`${empReqs.length} bekleyen talep`}>
                      <Bell className="w-3.5 h-3.5 text-amber-600" />
                      <span className="absolute -top-1.5 -right-1.5 min-w-[0.9rem] h-3.5 px-0.5 rounded-full bg-rose-600 text-white text-[8px] font-bold flex items-center justify-center">
                        {empReqs.length}
                      </span>
                    </span>
                  )}
                  <button
                    type="button"
                    onClick={() => openEditEmployee(emp)}
                    className="p-1.5 border border-slate-200 rounded-lg text-slate-500 hover:bg-slate-50 hover:text-slate-800"
                    title="Düzenle"
                    data-testid={`employee-edit-${emp.tc_kimlik || emp.id || emp._id}`}
                  >
                    <Pencil className="w-3.5 h-3.5" />
                  </button>
                  <button
                    type="button"
                    onClick={() => handleDeleteEmployee(emp)}
                    className="p-1.5 border border-rose-200 text-rose-600 rounded-lg hover:bg-rose-50"
                    title="Sil"
                    data-testid={`employee-delete-${emp.tc_kimlik || emp.id || emp._id}`}
                  >
                    <Trash2 className="w-3.5 h-3.5" />
                  </button>
                  <span className="text-[10px] bg-emerald-50 text-emerald-700 px-2 py-0.5 rounded-full font-semibold">
                    Aktif
                  </span>
                </div>
              </div>

              <div className="text-xs text-slate-600 space-y-1 pt-2 border-t border-slate-100">
                <div className="flex items-center gap-1.5">
                  <Phone className="w-3.5 h-3.5 text-slate-400" />
                  <span>{emp.phone || '-'}</span>
                </div>
                <div className="flex items-center gap-1.5">
                  <Mail className="w-3.5 h-3.5 text-slate-400" />
                  <span>{emp.email || '-'}</span>
                </div>
              </div>
            </div>

            <EmployeeRequestChips
              items={empReqs}
              testId={`employee-card-requests-${emp.tc_kimlik || empKey}`}
              busyId={busyReqId}
              onDecideLeave={decideLeave}
              onDecideEarly={decideEarly}
              onDecideIntraday={decideIntraday}
              onDecideAdvance={decideAdvance}
              onViewDispute={() => setTab("attendance")}
            />

            <div className="pt-2 border-t border-slate-100 space-y-1">
              <div className="flex items-center justify-between text-xs">
                <span className="text-slate-400">{isDailyWage(emp) ? "Yevmiye:" : "Net Maaş:"}</span>
                <span className="text-sm font-bold text-slate-900">{isDailyWage(emp) ? `${Number(emp.daily_wage || 0).toLocaleString("tr-TR")} ₺ / gün` : `${emp.salary?.toLocaleString("tr-TR")} ₺`}</span>
              </div>
              <div className="flex items-center justify-between text-xs" data-testid={`employee-receivable-${emp.tc_kimlik || empKey}`}>
                <span className="text-slate-400">Kalan Alacak:</span>
                <span className={`text-sm font-bold ${(Number(emp.balance?.remaining) || 0) < 0 ? "text-rose-700" : "text-emerald-700"}`}>
                  {Number(emp.balance?.remaining || 0).toLocaleString("tr-TR", { minimumFractionDigits: 0, maximumFractionDigits: 2 })} ₺
                </span>
              </div>
              <div className="flex items-center justify-between text-xs" data-testid={`employee-bonus-due-${emp.tc_kimlik || empKey}`}>
                <span className="text-slate-400">{isDailyWage(emp) ? "Yevmiye hakedişi:" : "Prim hakedişi:"}</span>
                <span className="text-sm font-bold text-amber-800">{Number(emp.balance?.bonus_pending || 0).toLocaleString("tr-TR", { minimumFractionDigits: 0, maximumFractionDigits: 2 })} ₺</span>
              </div>
              <div className="flex items-center justify-between text-xs" data-testid={`employee-ot-due-${emp.tc_kimlik || empKey}`}>
                <span className="text-slate-400">Fazla mesai ücreti:</span>
                <span className="text-sm font-bold text-violet-800">{Number(emp.balance?.overtime_due ?? emp.balance?.overtime_pay ?? 0).toLocaleString("tr-TR", { minimumFractionDigits: 0, maximumFractionDigits: 2 })} ₺</span>
              </div>
            </div>
            <div className="space-y-1.5">
            <div className="grid grid-cols-2 gap-1.5">
              <button
                type="button"
                onClick={() => openAdvanceFor(emp)}
                className="flex items-center justify-center gap-1 py-1.5 rounded-lg text-[11px] font-semibold bg-amber-50 hover:bg-amber-100 text-amber-800 border border-amber-200"
                data-testid={`employee-advance-btn-${emp.tc_kimlik || empKey}`}
              >
                <Wallet className="w-3.5 h-3.5" /> Avans
              </button>
              <button
                type="button"
                onClick={() => openSalaryFor(emp)}
                disabled={busySalaryId === empKey}
                className="flex items-center justify-center gap-1 py-1.5 rounded-lg text-[11px] font-semibold bg-emerald-50 hover:bg-emerald-100 text-emerald-800 border border-emerald-200 disabled:opacity-50"
                data-testid={`employee-salary-btn-${emp.tc_kimlik || empKey}`}
              >
                <Banknote className="w-3.5 h-3.5" /> Maaş
              </button>
              <button
                type="button"
                onClick={() => openMealExpenseFor(emp)}
                className="flex items-center justify-center gap-1 py-1.5 rounded-lg text-[11px] font-semibold bg-orange-50 hover:bg-orange-100 text-orange-800 border border-orange-200"
                title="Yemek ücreti — masraf olarak kaydedilir"
                data-testid={`employee-meal-btn-${emp.tc_kimlik || empKey}`}
              >
                <UtensilsCrossed className="w-3.5 h-3.5" /> Yemek
              </button>
              <button
                type="button"
                onClick={() => openTransportExpenseFor(emp)}
                className="flex items-center justify-center gap-1 py-1.5 rounded-lg text-[11px] font-semibold bg-cyan-50 hover:bg-cyan-100 text-cyan-800 border border-cyan-200"
                title="Yol ödemesi — masraf olarak kaydedilir"
                data-testid={`employee-transport-btn-${emp.tc_kimlik || empKey}`}
              >
                <Bus className="w-3.5 h-3.5" /> Yol
              </button>
              <button
                type="button"
                onClick={() => openBonusFor(emp)}
                className="flex items-center justify-center gap-1 py-1.5 rounded-lg text-[11px] font-semibold bg-amber-50 hover:bg-amber-100 text-amber-900 border border-amber-200"
                data-testid={`employee-bonus-btn-${emp.tc_kimlik || empKey}`}
              >
                <Gift className="w-3.5 h-3.5" /> Prim öde
              </button>
              <button
                type="button"
                onClick={() => openOtPayFor(emp)}
                className="flex items-center justify-center gap-1 py-1.5 rounded-lg text-[11px] font-semibold bg-violet-50 hover:bg-violet-100 text-violet-800 border border-violet-200"
                data-testid={`employee-otpay-btn-${emp.tc_kimlik || empKey}`}
              >
                <Timer className="w-3.5 h-3.5" /> Mesai öde
              </button>
              </div>
              <div className="grid grid-cols-2 gap-1.5" data-testid={`employee-work-actions-${emp.tc_kimlik || empKey}`}>
              <button
                type="button"
                onClick={() => setTaskEmp(emp)}
                className="flex items-center justify-center gap-1 py-1.5 rounded-lg text-[11px] font-semibold bg-indigo-50 hover:bg-indigo-100 text-indigo-800 border border-indigo-200"
                data-testid={`employee-task-btn-${emp.tc_kimlik || empKey}`}
              >
                <ClipboardList className="w-3.5 h-3.5" /> Görev
              </button>
              <button
                type="button"
                onClick={() => openOvertimeFor(emp)}
                className="flex items-center justify-center gap-1 py-1.5 rounded-lg text-[11px] font-semibold bg-violet-50 hover:bg-violet-100 text-violet-800 border-violet-200"
                data-testid={`employee-overtime-btn-${emp.tc_kimlik || empKey}`}
              >
                <Timer className="w-3.5 h-3.5" /> F. Mesai
              </button>
              </div>
            </div>
            <button onClick={() => setCardEmp(emp)} className="w-full py-1.5 bg-slate-900 hover:bg-slate-800 text-white rounded-lg text-xs font-semibold" data-testid={`employee-card-btn-${emp.tc_kimlik}`}>Personel Kartı</button>
          </div>
            );
          })}
      </div>

      {/* Payrolls Table */}
      <div className="bg-white rounded-2xl border border-slate-200/90 shadow-sm overflow-hidden space-y-3 p-5">
        <div className="flex items-center justify-between border-b pb-3">
          <div className="flex items-center gap-2">
            <DollarSign className="w-4 h-4 text-emerald-600" />
            <h2 className="text-base font-bold text-slate-900">Bordro & Maaş Ödeme Geçmişi</h2>
          </div>
        </div>

        <div className="overflow-x-auto">
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
              {payrolls.map((p) => (
                <tr key={p.id || p._id} className="hover:bg-slate-50/70 transition">
                  <td className="px-4 py-2.5">
                    <div className="font-bold text-slate-900">{p.employee_name}{isDailyWage(p) ? <span className="ml-1.5 text-[10px] font-bold px-1.5 py-0.5 rounded-full bg-amber-50 text-amber-800 border border-amber-200">Yevmiye</span> : null}</div>
                    <div className="text-slate-400 text-[11px] font-mono">{p.period} Dönemi</div>
                  </td>
                  <td className="px-4 py-2.5 text-right text-slate-700 font-medium">
                    {p.net_salary?.toLocaleString('tr-TR')} ₺
                    {(isDailyWage(p) || p.overtime_pay > 0 || p.second_salary > 0) && <div className="text-[10px] font-normal text-slate-500" data-testid={`payroll-breakdown-${p.id || p._id}`}>{isDailyWage(p) ? <span className="text-amber-700">{payrollWageLine(p)}</span> : null}{isDailyWage(p) && (p.overtime_pay > 0 || p.second_salary > 0) ? " · " : null}{p.overtime_pay > 0 && <span className="text-indigo-700">+{p.overtime_pay.toLocaleString('tr-TR')} ₺ mesai ({p.overtime_hours} sa)</span>}{p.overtime_pay > 0 && p.second_salary > 0 && " · "}{p.second_salary > 0 && <span className="text-amber-700">+{p.second_salary.toLocaleString('tr-TR')} ₺ 2. maaş</span>}</div>}
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
                    <button onClick={() => openQuickPay(p, "advance")} className="px-2.5 py-1 mr-1 bg-amber-50 hover:bg-amber-100 text-amber-800 border border-amber-200 rounded-lg text-xs font-semibold" title="Avans ver (maaştan mahsup edilir)" data-testid={`advance-btn-${p.employee_name}`}>Avans</button>
                    <button onClick={() => openQuickPay(p, "expense")} className="px-2.5 py-1 mr-1 bg-sky-50 hover:bg-sky-100 text-sky-800 border border-sky-200 rounded-lg text-xs font-semibold" title="Masraf ödemesi (yol, yemek, harcama)" data-testid={`expense-btn-${p.employee_name}`}>Masraf</button>
                    <button onClick={() => printPayslip(p, activeCompany)} className="px-2.5 py-1 mr-1 bg-slate-50 hover:bg-slate-100 text-slate-700 border border-slate-200 rounded-lg text-xs font-semibold" title="Maaş bordrosu PDF (yazdır / kaydet)" data-testid={`payslip-btn-${p.id || p._id}`}>Bordro PDF</button>
                    {p.status !== 'paid' ? (
                      <button
                        onClick={() => openSalaryPayModal(p)}
                        className="px-3 py-1 bg-emerald-600 hover:bg-emerald-700 text-white rounded-lg text-xs font-semibold shadow-sm"
                        data-testid={`pay-salary-btn-${p.employee_name}`}
                      >
                        Maaşı Öde
                      </button>
                    ) : (
                      <span className="text-emerald-700 font-semibold text-[11px]">Tamamlandı</span>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
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
                  companyId={activeCompany?.id || activeCompany?._id || "comp_nexus_main_01"}
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
                  <input
                    type="number"
                    value={newEmployee.daily_wage}
                    onChange={(e) => setNewEmployee({ ...newEmployee, daily_wage: e.target.value })}
                    className="w-full bg-slate-50 border border-slate-200 rounded-lg p-2 font-bold text-slate-900"
                    data-testid="employee-daily-wage-input"
                    placeholder="Örn: 1500"
                  />
                  <p className="text-[10px] text-slate-400 mt-1">Bordro = yevmiye × o ay gelen gün. Tahmini ay: {((Number(newEmployee.daily_wage) || 0) * 26).toLocaleString("tr-TR")} ₺ (26 gün).</p>
                </div>
              ) : (
                <div>
                  <label className="block font-semibold text-slate-700 mb-1">Net maaş (₺)</label>
                  <input
                    type="number"
                    value={newEmployee.salary}
                    onChange={(e) => setNewEmployee({ ...newEmployee, salary: e.target.value })}
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
                  <input
                    type="text"
                    value={newEmployee.position}
                    onChange={(e) => setNewEmployee({ ...newEmployee, position: e.target.value })}
                    className="w-full bg-slate-50 border border-slate-200 rounded-lg p-2"
                    data-testid="employee-position-input"
                  />
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
                    <label className="block font-semibold text-slate-700 mb-1">IBAN {String(newEmployee.sgk_number || "").trim() ? <span className="text-rose-600">(zorunlu)</span> : null}</label>
                    <input
                      type="text"
                      placeholder="TR.."
                      value={newEmployee.iban}
                      onChange={(e) => setNewEmployee({ ...newEmployee, iban: e.target.value.toUpperCase() })}
                      className="w-full bg-white border border-slate-200 rounded-lg p-2 font-mono"
                      data-testid="employee-iban-input"
                    />
                    {String(newEmployee.sgk_number || "").trim() ? (
                      <p className="text-[10px] text-sky-800 mt-1" data-testid="employee-sgk-bank-hint">SGK sicili girildiğinde ana maaş yalnız banka hesabından ödenir.</p>
                    ) : null}
                  </div>
                  <div className="grid grid-cols-2 gap-2">
                    <div>
                      <label className="block font-semibold text-slate-700 mb-1">Yemek ücreti (aylık ₺)</label>
                      <input
                        type="number"
                        min="0"
                        step="0.01"
                        value={newEmployee.meal_allowance}
                        onChange={(e) => setNewEmployee({ ...newEmployee, meal_allowance: e.target.value })}
                        className="w-full bg-white border border-slate-200 rounded-lg p-2"
                        data-testid="employee-meal-allowance-input"
                      />
                    </div>
                    <div>
                      <label className="block font-semibold text-slate-700 mb-1">Yol ödemesi (aylık ₺)</label>
                      <input
                        type="number"
                        min="0"
                        step="0.01"
                        value={newEmployee.transport_allowance}
                        onChange={(e) => setNewEmployee({ ...newEmployee, transport_allowance: e.target.value })}
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
      {cardEmp && <EmployeeCardModal employee={cardEmp} companyId={companyId} accounts={bankAccounts} onClose={() => setCardEmp(null)} onChanged={loadPersonnelData} />}
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
          onSaved={() => notifyDataChanged({ companyId, scopes: ["personnel"] })}
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
