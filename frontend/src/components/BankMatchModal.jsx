import React, { useEffect, useState } from "react";
import { createPortal } from "react-dom";
import axios from "axios";
import { toast } from "sonner";
import { Loader2, Link2, X } from "lucide-react";
import { API_URL } from "../context/AuthContext";
import { formatTrAmount, fmtDate } from "../utils/money";
import { PaymentTargetSelect } from "./PaymentTargetSelect";
import { ContactSearchSelect } from "./ContactSearchSelect";
import { backdropDismissProps } from "../utils/modalBackdrop";
import {
  BANK_MATCH_MODES,
  DEFAULT_PERSONNEL_PAY_KIND,
  PERSONNEL_EXPENSE_CATEGORY,
  PERSONNEL_PAY_KINDS,
  expenseCategoryOptionLabel,
  isPersonnelExpenseCategory,
} from "../utils/bankMatchModes";
import { expensePersonnelDebtOpen } from "../utils/employeePay";
import {
  POS_COMMISSION_CATEGORY,
  calcCommission,
  commissionRate,
  formatSummary,
  grossFromRate,
  isPosAccount,
  round2,
  validatePosSettlement,
} from "../utils/posSettlement";

const fmt = (n) => formatTrAmount(n || 0);
const sel = "w-full bg-slate-50 border border-slate-200 rounded-lg p-2 text-xs";

function initialMatchMode(tx) {
  const contact = tx?.suggested_contact_id || tx?.contact_id;
  const target = tx?.suggested_target_account_id || tx?.target_account_id;
  const matched = String(tx?.match_status || "") === "matched";
  if (tx?.type === "inflow" && (tx?.suggested_match_kind === "pos_settlement" || tx?.match_kind === "pos_settlement")) {
    return "pos_settlement";
  }
  if (tx?.expense_id || tx?.as_expense) return "expense";
  if (target && !contact && tx?.match_kind !== "pos_settlement") return "transfer";
  if (matched && !contact && String(tx?.category || "").trim()) return "category";
  return "contact";
}

function seedPosAmounts(tx, accounts, accountId) {
  const account = (accounts || []).find((a) => (a.id || a._id) === accountId && isPosAccount(a));
  const net = round2(tx?.amount);
  const rate = Number(tx?.suggested_pos_commission_rate);
  const suggestedId = tx?.suggested_target_account_id || "";
  const useRate = Number.isFinite(rate) && rate > 0 && rate < 1 && (!suggestedId || suggestedId === accountId || !accountId);
  if (useRate && (accountId || suggestedId)) {
    const g = grossFromRate(net, rate);
    return { gross: g, commission: calcCommission(g, net) };
  }
  if (account && (account.current_balance || account.current_balance === 0)) {
    const g = round2(account.current_balance);
    return { gross: g, commission: calcCommission(g, net) };
  }
  return { gross: "", commission: "" };
}

/** Banka hareketi eşleştirme / düzeltme modalı — hareketler listesi ve entegrasyon paneli ortak. */
export function BankMatchModal({ tx, contacts = [], accounts = [], companyId, onClose, onDone, replace = false }) {
  const txId = tx?.id || tx?._id;
  const isIn = tx?.type === "inflow";
  const [mode, setMode] = useState(() => initialMatchMode(tx));
  const [contactId, setContactId] = useState(tx?.suggested_contact_id || tx?.contact_id || "");
  const [targetId, setTargetId] = useState(tx?.suggested_target_account_id || tx?.target_account_id || "");
  const posStart = tx?.type === "inflow" && (tx?.suggested_match_kind === "pos_settlement" || tx?.match_kind === "pos_settlement");
  const [category, setCategory] = useState(
    posStart ? (tx?.suggested_category || POS_COMMISSION_CATEGORY) : (tx?.category || ""),
  );
  const [expenseCats, setExpenseCats] = useState([]);
  const [employees, setEmployees] = useState([]);
  const [employeeId, setEmployeeId] = useState("");
  const [personnelPayKind, setPersonnelPayKind] = useState(DEFAULT_PERSONNEL_PAY_KIND);
  const [expenseId, setExpenseId] = useState("");
  const [openDebts, setOpenDebts] = useState([]);
  const [learn, setLearn] = useState(true);
  const [busy, setBusy] = useState(false);
  const initialPosId = posStart ? (tx?.suggested_target_account_id || tx?.target_account_id || "") : "";
  const initialPosSeed = posStart ? seedPosAmounts(tx, accounts, initialPosId) : { gross: "", commission: "" };
  const [posAccountId, setPosAccountId] = useState(initialPosId);
  const [posGross, setPosGross] = useState(initialPosSeed.gross);
  const [posCommission, setPosCommission] = useState(initialPosSeed.commission);

  const needEmployee = mode === "expense" && isPersonnelExpenseCategory(category);
  const personnelCategoryOnly = mode === "category" && isPersonnelExpenseCategory(category);

  useEffect(() => {
    if ((mode !== "expense" && mode !== "pos_settlement") || !companyId) return;
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

  const targets = accounts.filter((a) => (a.id || a._id) !== tx?.account_id && !a.is_integrated);
  const posAccounts = accounts.filter((a) => isPosAccount(a));
  const selectedPos = posAccounts.find((a) => (a.id || a._id) === posAccountId);
  const netAmount = round2(tx?.amount);
  const posErrors = mode === "pos_settlement"
    ? [
      ...(posAccountId ? [] : ["POS hesabı seçin."]),
      ...validatePosSettlement({
        gross: posGross,
        net: tx?.amount,
        commission: posCommission,
        posBalance: selectedPos ? selectedPos.current_balance : null,
        isInflow: isIn,
      }),
    ]
    : [];
  const posCats = expenseCats.includes(POS_COMMISSION_CATEGORY)
    ? expenseCats
    : [POS_COMMISSION_CATEGORY, ...expenseCats];
  const rateHint = commissionRate(posGross, posCommission);
  let canSubmit = false;
  if (personnelCategoryOnly) canSubmit = false;
  else if (mode === "pos_settlement") canSubmit = posErrors.length === 0 && !!category.trim();
  else if (mode === "category" || mode === "expense") {
    canSubmit = !!category.trim() && (!needEmployee || (!!employeeId && !!personnelPayKind));
  } else if (mode === "transfer") canSubmit = !!targetId;
  else canSubmit = true;

  const resetPersonnel = () => {
    setEmployeeId("");
    setPersonnelPayKind(DEFAULT_PERSONNEL_PAY_KIND);
    setExpenseId("");
    setOpenDebts([]);
  };

  const onModeChange = (next) => {
    setMode(next);
    if (next !== "contact") setContactId("");
    if (next !== "expense" && next !== "category" && next !== "pos_settlement") setCategory("");
    if (next !== "expense") resetPersonnel();
    if (next !== "transfer") setTargetId(tx?.suggested_target_account_id || tx?.target_account_id || "");
    if (next === "pos_settlement") {
      const nextId = tx?.suggested_target_account_id || (tx?.match_kind === "pos_settlement" ? (tx?.target_account_id || "") : "");
      setPosAccountId(nextId);
      const seeded = seedPosAmounts(tx, accounts, nextId);
      setPosGross(seeded.gross);
      setPosCommission(seeded.commission);
      setCategory(tx?.suggested_category || POS_COMMISSION_CATEGORY);
    }
  };

  const goExpenseMode = () => {
    const cat = category.trim() || PERSONNEL_EXPENSE_CATEGORY;
    setMode("expense");
    setCategory(cat);
    setPersonnelPayKind(DEFAULT_PERSONNEL_PAY_KIND);
  };

  const submit = async (e) => {
    e.preventDefault();
    if (!txId || !canSubmit) return;
    setBusy(true);
    try {
      const body = mode === "pos_settlement"
        ? {
          learn,
          mode: "pos_settlement",
          target_account_id: posAccountId,
          pos_gross: round2(posGross),
          pos_commission: round2(posCommission),
          category: category || POS_COMMISSION_CATEGORY,
        }
        : {
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
      if (replace) body.replace = true;
      const { data: matched } = await axios.post(`${API_URL}/banking/transactions/${txId}/match`, body);
      const kindLabel = PERSONNEL_PAY_KINDS.find(([k]) => k === personnelPayKind)?.[1];
      const empName = employees.find((row) => (row.id || row._id) === employeeId)?.full_name
        || employees.find((row) => (row.id || row._id) === employeeId)?.name
        || "";
      toast.success(mode === "expense"
        ? (needEmployee
          ? `${empName ? `${empName} · ` : ""}${kindLabel || "ödeme"} kaydedildi${learn ? " ve öğrenildi" : ""}.`
          : (learn ? "Masraf kaydedildi ve kural olarak öğrenildi." : "Masraf kaydedildi."))
        : (learn ? "Eşleştirildi ve kural olarak öğrenildi." : "Eşleştirildi."));
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
        className="bg-white rounded-2xl max-w-md w-full max-h-[90vh] overflow-y-auto p-5 space-y-3 text-xs shadow-2xl border border-slate-200"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-start justify-between gap-3 border-b pb-2">
          <div className="min-w-0">
            <h3 className="text-sm font-bold text-slate-900 flex items-center gap-1.5">
              <Link2 className="w-4 h-4 text-violet-600 shrink-0" /> {replace ? "Eşleştirmeyi değiştir" : "Eşleşme"}
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
            {BANK_MATCH_MODES.filter(([k]) => k !== "pos_settlement" || isIn).map(([k, l]) => <option key={k} value={k}>{l}</option>)}
          </select>
        </div>

        {mode === "contact" && (
          <div>
            <label className="block font-semibold mb-1">Cari</label>
            <ContactSearchSelect
              companyId={companyId}
              value={contactId}
              onChange={(id) => setContactId(id || "")}
              valueLabel={(() => {
                if (!contactId) return "";
                const hit = (contacts || []).find((c) => (c.id || c._id) === contactId);
                if (hit?.name) return hit.name;
                if (contactId === (tx.suggested_contact_id || tx.contact_id)) {
                  return tx.suggested_contact_name || tx.contact_name || "";
                }
                return "";
              })()}
              placeholder="Cari seçin (boş = sadece onayla)"
              emptyLabel="Cari seçin (boş = sadece onayla)"
              searchPlaceholder="Cari adı, ünvan, VKN, telefon veya cari kodu"
              suggestText={tx.description || ""}
              counterparty={tx.counterparty || ""}
              clearable
              testId={`tx-match-contact-${txId}`}
            />
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
            {personnelCategoryOnly && (
              <div className="mt-2 rounded-lg border border-amber-200 bg-amber-50 text-amber-900 px-2 py-2 space-y-1.5" data-testid={`tx-match-personnel-warn-${txId}`}>
                <p>Personel ödemesi için Masraf modunda personel seçin.</p>
                <button type="button" onClick={goExpenseMode} className="px-2 py-1 bg-violet-600 text-white rounded-lg font-semibold" data-testid={`tx-match-goto-expense-${txId}`}>
                  Masraf moduna geç
                </button>
              </div>
            )}
          </div>
        )}

        {mode === "expense" && (
          <div>
            <label className="block font-semibold mb-1">Masraf kategorisi (zorunlu)</label>
            <select
              value={category}
              onChange={(e) => { setCategory(e.target.value); setEmployeeId(""); setPersonnelPayKind(DEFAULT_PERSONNEL_PAY_KIND); setExpenseId(""); }}
              className={sel}
              data-testid={`tx-match-expense-cat-${txId}`}
            >
              <option value="">Kategori seçin…</option>
              {expenseCats.map((c) => <option key={c} value={c}>{expenseCategoryOptionLabel(c)}</option>)}
            </select>
          </div>
        )}

        {mode === "pos_settlement" && (
          <div className="space-y-2" data-testid={`tx-match-pos-${txId}`}>
            <div>
              <label className="block font-semibold mb-1">POS hesabı</label>
              <select
                value={posAccountId}
                onChange={(e) => {
                  const nextId = e.target.value;
                  setPosAccountId(nextId);
                  const seeded = seedPosAmounts(
                    nextId && nextId === (tx?.suggested_target_account_id || "") ? tx : { ...tx, suggested_pos_commission_rate: undefined, suggested_target_account_id: "" },
                    accounts,
                    nextId,
                  );
                  setPosGross(seeded.gross);
                  setPosCommission(seeded.commission);
                }}
                className={`${sel} ${posErrors.length ? "border-rose-400 bg-rose-50" : ""}`}
                data-testid={`tx-match-pos-account-${txId}`}
              >
                <option value="">POS hesabı seçin…</option>
                {posAccounts.map((a) => {
                  const id = a.id || a._id;
                  return (
                    <option key={id} value={id}>
                      {a.account_name} — bloke bakiye {fmt(a.current_balance)}
                    </option>
                  );
                })}
              </select>
            </div>
            <div>
              <label className="block font-semibold mb-1">Brüt tutar</label>
              <input
                type="number"
                step="0.01"
                min="0"
                value={posGross}
                onChange={(e) => {
                  const raw = e.target.value;
                  setPosGross(raw);
                  const g = Number(raw);
                  if (raw !== "" && Number.isFinite(g)) setPosCommission(calcCommission(g, netAmount));
                }}
                className={`${sel} ${posErrors.length ? "border-rose-400 bg-rose-50" : ""}`}
                data-testid={`tx-match-pos-gross-${txId}`}
              />
            </div>
            <div>
              <label className="block font-semibold mb-1">Bankaya gelen (net)</label>
              <input
                readOnly
                value={Number.isFinite(netAmount) ? netAmount : ""}
                className={`${sel} bg-slate-100 text-slate-600`}
                data-testid={`tx-match-pos-net-${txId}`}
              />
            </div>
            <div>
              <label className="block font-semibold mb-1">
                Komisyon/masraf
                <span className="ml-1 font-normal text-slate-500" data-testid={`tx-match-pos-rate-${txId}`}>
                  (%{((rateHint || 0) * 100).toLocaleString("tr-TR", { maximumFractionDigits: 2 })})
                </span>
              </label>
              <input
                type="number"
                step="0.01"
                value={posCommission}
                onChange={(e) => {
                  const raw = e.target.value;
                  setPosCommission(raw);
                  const c = Number(raw);
                  if (raw !== "" && Number.isFinite(c) && Number.isFinite(netAmount)) {
                    setPosGross(round2(netAmount + c));
                  }
                }}
                className={`${sel} ${posErrors.length ? "border-rose-400 bg-rose-50" : ""}`}
                data-testid={`tx-match-pos-commission-${txId}`}
              />
              <p className="mt-1 text-[11px] text-slate-500" data-testid={`tx-match-pos-bsmv-${txId}`}>BSMV dahil</p>
            </div>
            <div>
              <label className="block font-semibold mb-1">Masraf kategorisi</label>
              <select
                value={category}
                onChange={(e) => setCategory(e.target.value)}
                className={`${sel} ${posErrors.length && !category.trim() ? "border-rose-400 bg-rose-50" : ""}`}
                data-testid={`tx-match-pos-cat-${txId}`}
              >
                {posCats.map((c) => <option key={c} value={c}>{c}</option>)}
              </select>
            </div>
            <div className="rounded-lg border border-slate-200 bg-slate-50 px-2 py-2 text-slate-700" data-testid={`tx-match-pos-summary-${txId}`}>
              {formatSummary({ posName: selectedPos?.account_name, gross: posGross, net: tx?.amount })}
            </div>
            {posErrors.length > 0 && (
              <div className="rounded-lg border border-rose-200 bg-rose-50 text-rose-800 px-2 py-2 space-y-0.5" data-testid={`tx-match-pos-errors-${txId}`}>
                {posErrors.map((err) => <p key={err}>{err}</p>)}
              </div>
            )}
          </div>
        )}

        {needEmployee && (
          <>
            <div>
              <label className="block font-semibold mb-1">Ödeme türü (zorunlu)</label>
              <select
                value={personnelPayKind}
                onChange={(e) => { setPersonnelPayKind(e.target.value); setExpenseId(""); }}
                className={sel}
                data-testid={`tx-match-pay-kind-${txId}`}
              >
                {PERSONNEL_PAY_KINDS.map(([k, l]) => <option key={k} value={k}>{l}</option>)}
              </select>
              {personnelPayKind === "expense" && (
                <p className="mt-1 text-[11px] text-slate-500" data-testid={`tx-match-expense-note-${txId}`}>
                  Şirket masrafı personel bakiyesini değiştirmez.
                </p>
              )}
            </div>
            <div>
              <label className="block font-semibold mb-1">Personel (zorunlu)</label>
              <select
                value={employeeId}
                onChange={(e) => { setEmployeeId(e.target.value); setExpenseId(""); }}
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
            {personnelPayKind === "reimburse" && employeeId && (
              <div>
                <label className="block font-semibold mb-1">Açık masraf borcu (isteğe bağlı)</label>
                <select
                  value={expenseId}
                  onChange={(e) => setExpenseId(e.target.value)}
                  className={sel}
                  data-testid={`tx-match-msr-${txId}`}
                >
                  <option value="">Tarihe göre kapat (FIFO)</option>
                  {openDebts.map((exp) => {
                    const id = exp.id || exp._id;
                    const label = [exp.expense_number || "MSR", exp.description || exp.category || ""].filter(Boolean).join(" · ");
                    return <option key={id} value={id}>{label}</option>;
                  })}
                </select>
              </div>
            )}
          </>
        )}

        <label className="flex items-center gap-2 text-[11px] text-slate-600 cursor-pointer">
          <input type="checkbox" checked={learn} onChange={(e) => setLearn(e.target.checked)} data-testid={`tx-match-learn-${txId}`} />
          {mode === "pos_settlement"
            ? "Bu açıklama tekrar gelirse POS hesabını ve komisyon oranını öner (öğren)"
            : "Bu açıklama tekrar gelirse otomatik eşleştir (öğren)"}
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
