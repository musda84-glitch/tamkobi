import React, { useEffect, useState } from "react";
import { createPortal } from "react-dom";
import axios from "axios";
import { toast } from "sonner";
import { Loader2, Link2, X } from "lucide-react";
import { API_URL } from "../context/AuthContext";
import { formatTrAmount, fmtDate } from "../utils/money";
import { PaymentTargetSelect } from "./PaymentTargetSelect";
import { backdropDismissProps } from "../utils/modalBackdrop";
import { BANK_MATCH_MODES, isPersonnelExpenseCategory } from "../utils/bankMatchModes";

const fmt = (n) => formatTrAmount(n || 0);
const sel = "w-full bg-slate-50 border border-slate-200 rounded-lg p-2 text-xs";

/** Banka hareketi eşleştirme / düzeltme modalı — hareketler listesi ve entegrasyon paneli ortak. */
export function BankMatchModal({ tx, contacts = [], accounts = [], companyId, onClose, onDone }) {
  const txId = tx?.id || tx?._id;
  const isIn = tx?.type === "inflow";
  const [mode, setMode] = useState("contact");
  const [contactId, setContactId] = useState(tx?.suggested_contact_id || tx?.contact_id || "");
  const [targetId, setTargetId] = useState(tx?.suggested_target_account_id || "");
  const [category, setCategory] = useState(tx?.category || "");
  const [expenseCats, setExpenseCats] = useState([]);
  const [employees, setEmployees] = useState([]);
  const [employeeId, setEmployeeId] = useState("");
  const [learn, setLearn] = useState(true);
  const [busy, setBusy] = useState(false);

  const needEmployee = mode === "expense" && isPersonnelExpenseCategory(category);

  useEffect(() => {
    if (mode !== "expense" || !companyId) return;
    axios.get(`${API_URL}/expenses/categories`, { params: { company_id: companyId } })
      .then((r) => setExpenseCats((r.data || []).map((c) => c.name || c).filter(Boolean)))
      .catch(() => setExpenseCats([]));
  }, [mode, companyId]);

  useEffect(() => {
    if (!needEmployee || !companyId) return;
    axios.get(`${API_URL}/personnel/employees`, { params: { company_id: companyId } })
      .then((r) => setEmployees((r.data || []).filter((e) => e.is_active !== false)))
      .catch(() => setEmployees([]));
  }, [needEmployee, companyId]);

  const targets = accounts.filter((a) => (a.id || a._id) !== tx?.account_id && !a.is_integrated);
  const canSubmit = mode === "category" || mode === "expense"
    ? !!category.trim() && (!needEmployee || !!employeeId)
    : mode === "transfer" ? !!targetId
    : true;

  const onModeChange = (next) => {
    setMode(next);
    if (next !== "contact") setContactId("");
    if (next !== "expense" && next !== "category") setCategory("");
    if (next !== "expense") setEmployeeId("");
    if (next !== "transfer") setTargetId(tx?.suggested_target_account_id || "");
  };

  const submit = async (e) => {
    e.preventDefault();
    if (!txId || !canSubmit) return;
    setBusy(true);
    try {
      const body = {
        learn,
        category: mode === "category" || mode === "expense" ? (category || null) : null,
        contact_id: mode === "contact" ? contactId || null : null,
        invoice_id: null,
        target_account_id: mode === "transfer" ? targetId : null,
        as_expense: mode === "expense",
        employee_id: mode === "expense" && needEmployee ? employeeId || null : null,
      };
      const { data: matched } = await axios.post(`${API_URL}/banking/transactions/${txId}/match`, body);
      toast.success(mode === "expense"
        ? (learn ? "Masraf kaydedildi ve kural olarak öğrenildi." : "Masraf kaydedildi.")
        : (learn ? "Eşleştirildi ve kural olarak öğrenildi." : "Eşleştirildi."));
      // Eşleşmiş satır hesap hareketlerinde kalsın — önce yerel güncelleme, sonra yenileme.
      onDone?.(matched || { ...(tx || {}), id: txId, match_status: "matched" });
      onClose?.();
    } catch (err) {
      toast.error(err.response?.data?.detail || "Eşleştirilemedi.");
    } finally {
      setBusy(false);
    }
  };

  if (!tx) return null;

  return createPortal(
    <div className="fixed inset-0 z-[95] bg-slate-900/50 flex items-center justify-center p-4" {...backdropDismissProps(onClose)} data-testid={`tx-match-modal-${txId}`}>
      <form
        onSubmit={submit}
        className="bg-white rounded-2xl max-w-md w-full p-5 space-y-3 text-xs shadow-2xl border border-slate-200"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-start justify-between gap-3 border-b pb-2">
          <div className="min-w-0">
            <h3 className="text-sm font-bold text-slate-900 flex items-center gap-1.5">
              <Link2 className="w-4 h-4 text-violet-600 shrink-0" /> Eşleşme
            </h3>
            <p className="text-[11px] text-slate-500 mt-0.5 truncate" title={tx.description}>
              {fmtDate(tx.date)} · {isIn ? "+" : "-"}{fmt(tx.amount)} ₺ · {tx.description}
            </p>
          </div>
          <button type="button" onClick={onClose} className="text-slate-400 hover:text-slate-700" data-testid="tx-match-close">
            <X className="w-5 h-5" />
          </button>
        </div>

        <div>
          <label className="block font-semibold mb-1">Eşleşme türü</label>
          <select value={mode} onChange={(e) => onModeChange(e.target.value)} className={sel} data-testid={`tx-match-mode-${txId}`}>
            {BANK_MATCH_MODES.map(([k, l]) => <option key={k} value={k}>{l}</option>)}
          </select>
        </div>

        {mode === "contact" && (
          <div>
            <label className="block font-semibold mb-1">Cari</label>
            <select
              value={contactId}
              onChange={(e) => setContactId(e.target.value)}
              className={sel}
              data-testid={`tx-match-contact-${txId}`}
            >
              <option value="">Cari seçin (boş = sadece onayla)</option>
              {contacts.map((c) => {
                const id = c.id || c._id;
                return <option key={id} value={id}>{c.name}</option>;
              })}
            </select>
          </div>
        )}

        {mode === "transfer" && (
          <div>
            <label className="block font-semibold mb-1">{isIn ? "Para nereden geldi?" : "Para nereye gitti?"}</label>
            <PaymentTargetSelect
              companyId={companyId}
              accounts={targets}
              value={targetId}
              onChange={setTargetId}
              testId={`tx-match-target-${txId}`}
              excludeIntegrated
              includePartners
              collectableOnly={isIn}
              emptyLabel="Hesap / ortak seçin"
            />
          </div>
        )}

        {mode === "category" && (
          <div>
            <label className="block font-semibold mb-1">Kategori (zorunlu)</label>
            <input value={category} onChange={(e) => setCategory(e.target.value)} className={sel} data-testid={`tx-match-category-${txId}`} />
          </div>
        )}

        {mode === "expense" && (
          <div>
            <label className="block font-semibold mb-1">Masraf kategorisi (zorunlu)</label>
            <select
              value={category}
              onChange={(e) => { setCategory(e.target.value); setEmployeeId(""); }}
              className={sel}
              data-testid={`tx-match-expense-cat-${txId}`}
            >
              <option value="">Kategori seçin…</option>
              {expenseCats.map((c) => <option key={c} value={c}>{c}</option>)}
            </select>
          </div>
        )}

        {needEmployee && (
          <div>
            <label className="block font-semibold mb-1">Personel (zorunlu)</label>
            <select
              value={employeeId}
              onChange={(e) => setEmployeeId(e.target.value)}
              className={sel}
              data-testid={`tx-match-employee-${txId}`}
            >
              <option value="">Personel seçin…</option>
              {employees.map((e) => {
                const id = e.id || e._id;
                return <option key={id} value={id}>{e.full_name || e.name || id}</option>;
              })}
            </select>
          </div>
        )}

        <label className="flex items-center gap-2 text-[11px] text-slate-600 cursor-pointer">
          <input type="checkbox" checked={learn} onChange={(e) => setLearn(e.target.checked)} data-testid={`tx-match-learn-${txId}`} />
          Bu açıklama tekrar gelirse otomatik eşleştir (öğren)
        </label>

        <div className="flex justify-end gap-2 pt-2 border-t">
          <button type="button" onClick={onClose} className="px-3 py-1.5 border rounded-lg">İptal</button>
          <button
            type="submit"
            disabled={busy || !canSubmit}
            className="px-4 py-1.5 bg-violet-600 text-white rounded-lg font-semibold disabled:opacity-40 flex items-center gap-1.5"
            data-testid={`tx-match-save-${txId}`}
          >
            {busy && <Loader2 className="w-3.5 h-3.5 animate-spin" />} Eşleştir
          </button>
        </div>
      </form>
    </div>,
    document.body
  );
}
