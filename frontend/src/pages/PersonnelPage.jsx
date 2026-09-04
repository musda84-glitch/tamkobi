import React, { useState, useEffect, useCallback } from "react";
import axios from "axios";
import { API_URL, useAuth } from "../context/AuthContext";
import { toast } from "sonner";
import {
  UserCheck,
  Plus,
  DollarSign,
  Calculator,
  Calendar,
  CheckCircle2,
  Clock,
  Building,
  Phone,
  Mail,
  X,
  CreditCard
  , CalendarDays, Gift
} from "lucide-react";
import { LeaveRequestsPanel, SalaryCalculator, BonusPanel } from "../components/PersonnelExtras";
import { AttendancePanel } from "../components/AttendancePanel";

export default function PersonnelPage() {
  const { activeCompany } = useAuth();
  const [employees, setEmployees] = useState([]);
  const [tab, setTab] = useState("payroll");
  const [payrolls, setPayrolls] = useState([]);
  const [bankAccounts, setBankAccounts] = useState([]);
  const [loading, setLoading] = useState(true);

  // Modals
  const [showAddModal, setShowAddModal] = useState(false);
  const [showPayrollModal, setShowPayrollModal] = useState(false);
  const [payPayrollItem, setPayPayrollItem] = useState(null);
  const [selectedBankId, setSelectedBankId] = useState("");

  const [newEmployee, setNewEmployee] = useState({
    full_name: "",
    tc_kimlik: "",
    department: "Satış & Pazarlama",
    position: "Uzman",
    phone: "",
    email: "",
    salary: 35000,
    start_date: new Date().toISOString().split("T")[0]
  });

  const loadPersonnelData = useCallback(async () => {
    try {
      setLoading(true);
      const [empRes, payRes, bankRes] = await Promise.all([
        axios.get(`${API_URL}/personnel/employees?company_id=${activeCompany?.id || activeCompany?._id || 'comp_nexus_main_01'}`),
        axios.get(`${API_URL}/personnel/payrolls?company_id=${activeCompany?.id || activeCompany?._id || 'comp_nexus_main_01'}`),
        axios.get(`${API_URL}/banking/accounts?company_id=${activeCompany?.id || activeCompany?._id || 'comp_nexus_main_01'}`)
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
  }, [activeCompany]);
  useEffect(() => { loadPersonnelData(); }, [loadPersonnelData]);

  const handleSaveEmployee = async (e) => {
    e.preventDefault();
    if (!newEmployee.full_name || !newEmployee.tc_kimlik) {
      toast.error("Lütfen ad soyad ve TC kimlik no girin.");
      return;
    }
    try {
      await axios.post(`${API_URL}/personnel/employees`, {
        company_id: activeCompany?.id || activeCompany?._id || "comp_nexus_main_01",
        ...newEmployee,
        salary: Number(newEmployee.salary)
      });
      toast.success("Personel başarıyla kaydedildi.");
      setShowAddModal(false);
      loadPersonnelData();
    } catch (err) {
      toast.error("Personel kaydedilemedi.");
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
    try {
      const res = await axios.post(`${API_URL}/personnel/payrolls/${payPayrollItem.id || payPayrollItem._id}/pay`, {
        account_id: selectedBankId
      });
      toast.success(res.data.message);
      setPayPayrollItem(null);
      loadPersonnelData();
    } catch (err) {
      toast.error("Maaş ödemesi gerçekleştirilemedi.");
    }
  };

  const totalMonthlyPayroll = employees.reduce((sum, e) => sum + (e.salary || 0), 0);

  return (
    <div className="space-y-6" data-testid="personnel-page">
      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div>
          <h1 className="text-xl sm:text-2xl font-bold text-slate-900 tracking-tight">Personel & Bordro Modülü</h1>
          <p className="text-xs sm:text-sm text-slate-500">
            Aylık Toplam Net Maaş Yükü: <span className="font-bold text-slate-900">{totalMonthlyPayroll.toLocaleString('tr-TR')} ₺</span>
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
            onClick={() => setShowAddModal(true)}
            className="flex items-center gap-1.5 bg-emerald-600 hover:bg-emerald-700 text-white px-3.5 py-2 rounded-xl text-xs sm:text-sm font-semibold shadow-md shadow-emerald-600/20 transition"
            data-testid="add-employee-btn"
          >
            <Plus className="w-4 h-4" />
            <span>Yeni Çalışan Ekle</span>
          </button>
        </div>
      </div>

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
        {employees.map((emp) => (
          <div
            key={emp.id || emp._id}
            className="bg-white p-5 rounded-2xl border border-slate-200/90 shadow-sm space-y-3 flex flex-col justify-between"
            data-testid={`employee-card-${emp.tc_kimlik}`}
          >
            <div className="space-y-2">
              <div className="flex items-start justify-between">
                <div>
                  <h3 className="font-bold text-slate-900 text-sm">{emp.full_name}</h3>
                  <div className="text-xs text-indigo-600 font-semibold">{emp.position}</div>
                  <div className="text-[11px] text-slate-400">{emp.department}</div>
                </div>
                <span className="text-[10px] bg-emerald-50 text-emerald-700 px-2 py-0.5 rounded-full font-semibold">
                  Aktif
                </span>
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

            <div className="pt-2 border-t border-slate-100 flex items-center justify-between text-xs">
              <span className="text-slate-400">Net Maaş:</span>
              <span className="text-sm font-bold text-slate-900">{emp.salary?.toLocaleString('tr-TR')} ₺</span>
            </div>
          </div>
        ))}
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
                    <div className="font-bold text-slate-900">{p.employee_name}</div>
                    <div className="text-slate-400 text-[11px] font-mono">{p.period} Dönemi</div>
                  </td>
                  <td className="px-4 py-2.5 text-right text-slate-700 font-medium">
                    {p.net_salary?.toLocaleString('tr-TR')} ₺
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
                  <td className="px-4 py-2.5 text-center">
                    {p.status !== 'paid' ? (
                      <button
                        onClick={() => setPayPayrollItem(p)}
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
      {payPayrollItem && (
        <div className="fixed inset-0 z-50 bg-slate-900/60 backdrop-blur-sm flex items-center justify-center p-4">
          <div className="bg-white rounded-2xl max-w-md w-full p-6 space-y-4 shadow-2xl border border-slate-200">
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
              <div>
                <label className="block font-semibold text-slate-700 mb-1">Ödemenin Yapılacağı Banka Hesabı</label>
                <select
                  value={selectedBankId}
                  onChange={(e) => setSelectedBankId(e.target.value)}
                  className="w-full bg-slate-50 border border-slate-200 rounded-lg p-2 font-medium"
                >
                  {bankAccounts.map(b => (
                    <option key={b.id || b._id} value={b.id || b._id}>
                      {b.bank_name} - {b.account_name} ({b.current_balance?.toLocaleString('tr-TR')} ₺)
                    </option>
                  ))}
                </select>
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
      )}

      {/* ADD EMPLOYEE MODAL */}
      {showAddModal && (
        <div className="fixed inset-0 z-50 bg-slate-900/60 backdrop-blur-sm flex items-center justify-center p-4">
          <div className="bg-white rounded-2xl max-w-md w-full p-6 space-y-4 shadow-2xl border border-slate-200">
            <div className="flex items-center justify-between border-b pb-2">
              <h3 className="text-base font-bold text-slate-900">Yeni Personel Ekle</h3>
              <button onClick={() => setShowAddModal(false)} className="text-slate-400">
                <X className="w-5 h-5" />
              </button>
            </div>
            <form onSubmit={handleSaveEmployee} className="space-y-3 text-xs">
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
                  />
                </div>
                <div>
                  <label className="block font-semibold text-slate-700 mb-1">Net Maaş (₺)</label>
                  <input
                    type="number"
                    value={newEmployee.salary}
                    onChange={(e) => setNewEmployee({ ...newEmployee, salary: e.target.value })}
                    className="w-full bg-slate-50 border border-slate-200 rounded-lg p-2 font-bold text-slate-900"
                    data-testid="employee-salary-input"
                  />
                </div>
              </div>
              <div className="grid grid-cols-2 gap-2">
                <div>
                  <label className="block font-semibold text-slate-700 mb-1">Departman</label>
                  <input
                    type="text"
                    value={newEmployee.department}
                    onChange={(e) => setNewEmployee({ ...newEmployee, department: e.target.value })}
                    className="w-full bg-slate-50 border border-slate-200 rounded-lg p-2"
                  />
                </div>
                <div>
                  <label className="block font-semibold text-slate-700 mb-1">Pozisyon / Görev</label>
                  <input
                    type="text"
                    value={newEmployee.position}
                    onChange={(e) => setNewEmployee({ ...newEmployee, position: e.target.value })}
                    className="w-full bg-slate-50 border border-slate-200 rounded-lg p-2"
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
                  />
                </div>
                <div>
                  <label className="block font-semibold text-slate-700 mb-1">E-Posta</label>
                  <input
                    type="email"
                    placeholder="ornek@nexus.com"
                    value={newEmployee.email}
                    onChange={(e) => setNewEmployee({ ...newEmployee, email: e.target.value })}
                    className="w-full bg-slate-50 border border-slate-200 rounded-lg p-2"
                  />
                </div>
              </div>
              <div className="flex justify-end gap-2 pt-2 border-t">
                <button
                  type="button"
                  onClick={() => setShowAddModal(false)}
                  className="px-3 py-1.5 border rounded-lg text-xs"
                >
                  İptal
                </button>
                <button
                  type="submit"
                  className="px-4 py-1.5 bg-emerald-600 text-white rounded-lg text-xs font-semibold"
                  data-testid="save-employee-btn"
                >
                  Personeli Kaydet
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
}
