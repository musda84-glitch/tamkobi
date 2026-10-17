import React, { useEffect, useMemo, useState } from "react";
import axios from "axios";
import { toast } from "sonner";
import { Loader2, Sparkles } from "lucide-react";
import { API_URL } from "../context/AuthContext";
import { formatTrAmount, fmtDate } from "../utils/money";
import { txDescriptionLabel } from "../utils/bankMatchLabel";
import { PaymentTargetSelect } from "./PaymentTargetSelect";
import { ContactSearchSelect } from "./ContactSearchSelect";
import {
  BANK_MATCH_MODES,
  DEFAULT_PERSONNEL_PAY_KIND,
  PERSONNEL_EXPENSE_CATEGORY,
  PERSONNEL_PAY_KINDS,
  expenseCategoryOptionLabel,
  isPersonnelExpenseCategory,
} from "../utils/bankMatchModes";
import { expensePersonnelDebtOpen } from "../utils/employeePay";

const fmt = (n) => formatTrAmount((n || 0));
const sel = "bg-slate-50 border border-slate-200 rounded-lg p-1.5 text-xs";

export const BankMatchRow = ({ tx, contacts, accounts, invoices: _invoices, companyId, onDone }) => {
  const isIn = tx.type === "inflow";
  const [mode, setMode] = useState("contact");
  const [contactId, setContactId] = useState(tx.suggested_contact_id || "");
  const [targetId, setTargetId] = useState(tx.suggested_target_account_id || "");
  const [category, setCategory] = useState("");
  const [expenseCats, setExpenseCats] = useState([]);
  const [employees, setEmployees] = useState([]);
  const [employeeId, setEmployeeId] = useState("");
  const [personnelPayKind, setPersonnelPayKind] = useState(DEFAULT_PERSONNEL_PAY_KIND);
  const [expenseId, setExpenseId] = useState("");
  const [openDebts, setOpenDebts] = useState([]);
  const [learn, setLearn] = useState(true);
  const [busy, setBusy] = useState(false);

  const needEmployee = mode === "expense" && isPersonnelExpenseCategory(category);
  const personnelCategoryOnly = mode === "category" && isPersonnelExpenseCategory(category);

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

  useEffect(() => {
    if (!needEmployee || personnelPayKind !== "reimburse" || !employeeId) {
      setOpenDebts([]);
      return undefined;
    }
    let cancel = false;
    axios.get(`${API_URL}/personnel/employees/${employeeId}/card`)
      .then((r) => {
        const rows = r.data?.expenses || r.data?.open_personnel_debts || [];
        const open = (Array.isArray(rows) ? rows : []).filter(expensePersonnelDebtOpen);
        open.sort((a, b) => String(a.date || "").localeCompare(String(b.date || "")));
        if (!cancel) setOpenDebts(open);
      })
      .catch(() => { if (!cancel) setOpenDebts([]); });
    return () => { cancel = true; };
  }, [needEmployee, personnelPayKind, employeeId]);

  const targets = useMemo(
    () => (accounts || []).filter((a) => (a.id || a._id) !== tx.account_id && !a.is_integrated),
    [accounts, tx.account_id],
  );
  const contactLabel = (c) => (tx.suggested_contact_id === (c.id || c._id) ? `${c.name} ★` : (c.name || "—"));
  const selectedContactName = (() => {
    if (!contactId) return "";
    const hit = (contacts || []).find((c) => (c.id || c._id) === contactId);
    return hit ? contactLabel(hit) : (tx.suggested_contact_name || "");
  })();
  const canSubmit = personnelCategoryOnly ? false : (mode === "category" || mode === "expense"
    ? !!category.trim() && (!needEmployee || (!!employeeId && !!personnelPayKind))
    : mode === "transfer" ? !!targetId
    : true);

  const onModeChange = (next) => {
    setMode(next);
    if (next !== "contact") setContactId("");
    if (next !== "expense" && next !== "category") setCategory("");
    if (next !== "expense") {
      setEmployeeId("");
      setPersonnelPayKind(DEFAULT_PERSONNEL_PAY_KIND);
      setExpenseId("");
      setOpenDebts([]);
    }
  };

  const submit = async () => {
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
        personnel_pay_kind: mode === "expense" && needEmployee ? personnelPayKind || DEFAULT_PERSONNEL_PAY_KIND : null,
        expense_id: mode === "expense" && needEmployee && personnelPayKind === "reimburse" && expenseId ? expenseId : null,
      };
      await axios.post(`${API_URL}/banking/transactions/${tx.id}/match`, body);
      const kindLabel = PERSONNEL_PAY_KINDS.find(([k]) => k === personnelPayKind)?.[1];
      const empName = employees.find((row) => (row.id || row._id) === employeeId)?.full_name
        || employees.find((row) => (row.id || row._id) === employeeId)?.name
        || "";
      toast.success(mode === "expense"
        ? (needEmployee
          ? `${empName ? `${empName} · ` : ""}${kindLabel || "ödeme"} kaydedildi${learn ? " ve öğrenildi" : ""}.`
          : (learn ? "Masraf kaydedildi ve kural olarak öğrenildi." : "Masraf kaydedildi."))
        : (learn ? "Eşleştirildi ve kural olarak öğrenildi." : "Eşleştirildi."));
      onDone?.();
    } catch (err) { toast.error(err.response?.data?.detail || "Eşleştirilemedi."); } finally { setBusy(false); }
  };
  return (
    <tr data-testid={`unmatched-tx-${tx.id}`} className="align-top">
      <td className="px-4 py-2 font-mono text-slate-500 whitespace-nowrap">{fmtDate(tx.date)}</td>
      <td className="px-4 py-2 font-semibold text-slate-900">{tx.account_name}</td>
      <td className="px-4 py-2 max-w-[260px]">
        <span className="font-medium text-slate-800">{txDescriptionLabel(tx)}</span>
        {tx.is_simulated && <span className="ml-1 text-[9px] bg-amber-100 text-amber-700 px-1 rounded font-bold">SİMÜLE</span>}
        {tx.suggested_contact_name && <div className="text-[10px] text-violet-700 flex items-center gap-1 mt-0.5"><Sparkles className="w-3 h-3" /> Öneri: {tx.suggested_contact_name}</div>}
      </td>
      <td className={`px-4 py-2 text-right font-bold whitespace-nowrap ${isIn ? "text-emerald-600" : "text-rose-600"}`}>{isIn ? "+" : "-"}{fmt(tx.amount)} ₺</td>
      <td className="px-4 py-2">
        <div className="flex flex-wrap gap-1.5 items-center">
          <select value={mode} onChange={(e) => onModeChange(e.target.value)} className={sel} data-testid={`match-mode-${tx.id}`}>{BANK_MATCH_MODES.map(([k, l]) => <option key={k} value={k}>{l}</option>)}</select>
          {mode === "contact" && (
            <ContactSearchSelect
              companyId={companyId}
              value={contactId}
              onChange={(id) => setContactId(id || "")}
              valueLabel={selectedContactName}
              placeholder="Cari seçin (boş = onayla)"
              emptyLabel="Cari seçin (boş = onayla)"
              searchPlaceholder="Cari adı, ünvan, VKN, telefon veya cari kodu"
              suggestText={tx.description || ""}
              counterparty={tx.counterparty || ""}
              clearable
              className="w-44"
              testId={`match-contact-select-${tx.id}`}
            />
          )}
          {mode === "transfer" && (
            <PaymentTargetSelect
              companyId={companyId}
              accounts={targets}
              value={targetId}
              onChange={setTargetId}
              testId={`match-target-select-${tx.id}`}
              excludeIntegrated
              includePartners
              collectableOnly={isIn}
              emptyLabel={isIn ? "Para nereden geldi?" : "Para nereye gitti?"}
              className="w-56"
            />
          )}
          {mode === "expense" && (
            <select
              value={category}
              onChange={(e) => { setCategory(e.target.value); setEmployeeId(""); setPersonnelPayKind(DEFAULT_PERSONNEL_PAY_KIND); setExpenseId(""); }}
              className={`${sel} w-40`}
              data-testid={`match-expense-cat-${tx.id}`}
            >
              <option value="">Masraf kategorisi…</option>
              {expenseCats.map((c) => <option key={c} value={c}>{expenseCategoryOptionLabel(c)}</option>)}
            </select>
          )}
          {mode === "category" && (
            <>
              <input value={category} onChange={(e) => setCategory(e.target.value)} placeholder="Kategori (zorunlu)" className={`${sel} w-36`} data-testid={`match-category-${tx.id}`} />
              {personnelCategoryOnly && (
                <span className="text-[10px] text-amber-800" data-testid={`match-personnel-warn-${tx.id}`}>
                  Personel ödemesi için Masraf modunda personel seçin.
                  <button type="button" className="ml-1 underline font-semibold" data-testid={`match-goto-expense-${tx.id}`} onClick={() => { setMode("expense"); setCategory(category.trim() || PERSONNEL_EXPENSE_CATEGORY); setPersonnelPayKind(DEFAULT_PERSONNEL_PAY_KIND); }}>Masraf moduna geç</button>
                </span>
              )}
            </>
          )}
          {needEmployee && (
            <>
              <select
                value={personnelPayKind}
                onChange={(e) => { setPersonnelPayKind(e.target.value); setExpenseId(""); }}
                className={`${sel} w-28`}
                data-testid={`match-pay-kind-${tx.id}`}
              >
                {PERSONNEL_PAY_KINDS.map(([k, l]) => <option key={k} value={k}>{l}</option>)}
              </select>
              {personnelPayKind === "expense" && (
                <span className="text-[10px] text-slate-500" data-testid={`match-expense-note-${tx.id}`}>personel bakiyesini değiştirmez</span>
              )}
              <select
                value={employeeId}
                onChange={(e) => { setEmployeeId(e.target.value); setExpenseId(""); }}
                className={`${sel} w-40`}
                data-testid={`match-employee-${tx.id}`}
              >
                <option value="">Personel seçin…</option>
                {employees.map((e) => {
                  const id = e.id || e._id;
                  return <option key={id} value={id}>{e.full_name || e.name || id}</option>;
                })}
              </select>
              {personnelPayKind === "reimburse" && employeeId && (
                <select
                  value={expenseId}
                  onChange={(e) => setExpenseId(e.target.value)}
                  className={`${sel} w-44`}
                  data-testid={`match-msr-${tx.id}`}
                >
                  <option value="">FIFO kapat</option>
                  {openDebts.map((exp) => {
                    const id = exp.id || exp._id;
                    const label = [exp.expense_number || "MSR", exp.description || exp.category || ""].filter(Boolean).join(" · ");
                    return <option key={id} value={id}>{label}</option>;
                  })}
                </select>
              )}
            </>
          )}
          <label className="flex items-center gap-1 text-[10px] text-slate-500 cursor-pointer" title="Bu açıklama tekrar gelirse aynı işlemi otomatik yap"><input type="checkbox" checked={learn} onChange={(e) => setLearn(e.target.checked)} data-testid={`match-learn-${tx.id}`} /> Öğren</label>
        </div>
      </td>
      <td className="px-4 py-2"><button onClick={submit} disabled={busy || !canSubmit} className="px-3 py-1.5 bg-emerald-600 text-white rounded-lg text-[11px] font-semibold hover:bg-emerald-700 disabled:opacity-40 flex items-center gap-1" data-testid={`match-btn-${tx.id}`}>{busy && <Loader2 className="w-3 h-3 animate-spin" />} Eşleştir</button></td>
    </tr>
  );
};
