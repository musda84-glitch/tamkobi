import React, { useEffect, useState } from "react";
import axios from "axios";
import { toast } from "sonner";
import { Receipt, Wallet, X } from "lucide-react";
import { API_URL } from "../context/AuthContext";
import { PaymentTargetSelect, splitPaymentTarget } from "./PaymentTargetSelect";
import { useEscape } from "../utils/useEscape";
import { notifyDataChanged } from "../utils/dataRefresh";
import { formatTrAmount } from "../utils/money";

const fmt = (n) => formatTrAmount((Number(n) || 0));
const inputCls = "w-full border border-slate-200 rounded-lg p-2 text-xs bg-slate-50 focus:ring-2 focus:ring-emerald-500 outline-none";

const MEAL_CAT = "Yemek";
const TRANSPORT_CAT = "Yol / Ulaşım";

const presetTitle = (category) => {
  if (category === MEAL_CAT) return "Yemek Ücreti";
  if (category === TRANSPORT_CAT) return "Yol Ödemesi";
  return null;
};

export const QuickPayModal = ({ payroll: p, type, companyId, accounts, onClose, onDone, initialMode, initialCategory, initialDescription, initialAmount, allowances }) => {
  useEscape(onClose);
  const isExpense = type === "expense";
  const bonusKind = type === "bonus" || type === "overtime" ? type : null;
  const presetCat = initialCategory || "";
  const defaultCat = presetCat || "Personel Masrafı";
  const allowanceHint = (() => {
    if (!isExpense) return null;
    if (presetCat === MEAL_CAT) {
      const due = Number(allowances?.mealDue ?? allowances?.meal ?? 0) || 0;
      return due > 0 ? due : null;
    }
    if (presetCat === TRANSPORT_CAT) {
      const due = Number(allowances?.transportDue ?? allowances?.transport ?? 0) || 0;
      return due > 0 ? due : null;
    }
    return null;
  })();
  const seededAmount = initialAmount != null && initialAmount !== ""
    ? String(initialAmount)
    : (allowanceHint != null ? String(allowanceHint) : "");
  const [mode, setMode] = useState(initialMode || (presetCat ? "new" : "existing"));
  const [open, setOpen] = useState([]);
  const [cats, setCats] = useState([]);
  const [f, setF] = useState({
    amount: seededAmount,
    account_id: accounts[0]?.id || "",
    note: "",
    expense_id: "",
    category: defaultCat,
    description: initialDescription || (presetCat === MEAL_CAT ? "Yemek ücreti" : presetCat === TRANSPORT_CAT ? "Yol / ulaşım ödemesi" : ""),
  });
  const [busy, setBusy] = useState(false);
  useEffect(() => {
    if (!isExpense) return;
    axios.get(`${API_URL}/expenses?company_id=${companyId}&employee_id=${p.employee_id}&status=unpaid`).then((r) => {
      setOpen(r.data.expenses);
      if (r.data.expenses.length === 0 && initialMode !== "existing") setMode("new");
      if (presetCat) setMode("new");
      if (r.data.expenses[0]) setF((s) => ({ ...s, expense_id: r.data.expenses[0].id }));
    }).catch(() => { if (initialMode !== "existing" || presetCat) setMode("new"); });
    axios.get(`${API_URL}/expenses/categories?company_id=${companyId}`).then((r) => setCats(r.data)).catch(() => {});
  }, [isExpense, companyId, p.employee_id, initialMode, presetCat]);
  const selected = open.find((x) => x.id === f.expense_id);
  const title = isExpense
    ? (presetTitle(presetCat) || (initialMode === "new" || mode === "new" ? "Masraf Ekle" : "Masraf Ödemesi"))
    : bonusKind === "overtime" ? "Mesai Ücreti Öde" : bonusKind === "bonus" ? "Prim Öde" : "Avans Ver";
  const submit = async (e) => {
    e.preventDefault(); setBusy(true);
    try {
      if (!isExpense) {
        const bType = bonusKind || "advance";
        const note = f.note || (bType === "overtime" ? "Fazla mesai ücreti" : bType === "bonus" ? "Prim" : "");
        await axios.post(`${API_URL}/personnel/bonuses`, { employee_id: p.employee_id, type: bType, amount: Number(f.amount), period: p.period, note, ...splitPaymentTarget(f.account_id) });
        toast.success(`${p.employee_name} için ${bType === "overtime" ? "fazla mesai ücreti" : bType === "bonus" ? "prim" : "avans"} kaydedildi.`);
      } else if (mode === "existing") {
        if (!selected) throw new Error("Masraf seçin.");
        if (!f.account_id) throw new Error("Ödeme için kasa/banka seçin.");
        await axios.post(`${API_URL}/expenses/${selected.id}/pay`, { ...splitPaymentTarget(f.account_id) });
        toast.success(`${selected.expense_number} ödendi (${fmt(selected.total)} ₺).`);
      } else {
        await axios.post(`${API_URL}/expenses`, { company_id: companyId, description: f.description || `${p.employee_name} masrafı`, category: f.category, amount: Number(f.amount), vat_rate: 0, employee_id: p.employee_id, notes: f.note, date: new Date().toISOString().slice(0, 10), ...splitPaymentTarget(f.account_id) });
        toast.success(`Masraf kaydı oluşturuldu${f.account_id ? " ve ödendi" : ""} — Masraflar modülünde görünür.`);
      }
      await notifyDataChanged({ companyId: companyId, scopes: ["cash", "expenses", "contacts"] }); onDone?.(); onClose();
    } catch (err) { toast.error(err.response?.data?.detail || err.message || "Kaydedilemedi."); } finally { setBusy(false); }
  };
  return (
    <div className="fixed inset-0 z-[70] bg-slate-900/60 flex items-center justify-center p-4" onClick={(ev) => { ev.stopPropagation(); onClose(); }}>
      <form onSubmit={submit} onClick={(e) => e.stopPropagation()} className="bg-white rounded-2xl w-full max-w-md p-5 space-y-3 text-xs shadow-2xl" data-testid="quick-pay-modal">
        <div className="flex items-center justify-between"><div className="font-bold text-slate-900 text-sm flex items-center gap-2">{isExpense ? <Receipt className="w-4 h-4 text-sky-600" /> : <Wallet className="w-4 h-4 text-amber-600" />} {title} — {p.employee_name}</div><button type="button" onClick={onClose} className="text-slate-400 flex items-center gap-1" title="Kapat (Esc)"><kbd className="text-[9px] border rounded px-1">ESC</kbd><X className="w-4 h-4" /></button></div>
        {isExpense && (
          <div className="flex gap-1 bg-slate-100 rounded-lg p-0.5">{[["existing", `Kayıtlı masrafı öde (${open.length})`], ["new", "Yeni masraf gir"]].map(([k, l]) => <button type="button" key={k} onClick={() => setMode(k)} className={`flex-1 py-1.5 rounded-md font-semibold ${mode === k ? "bg-white shadow text-slate-900" : "text-slate-500"}`} data-testid={`quick-pay-mode-${k}`}>{l}</button>)}</div>
        )}
        {isExpense && mode === "existing" ? (
          <div>
            <label className="block font-semibold mb-1">Personelin ödenmemiş masrafları (Masraflar modülü)</label>
            {open.length === 0 ? <div className="text-slate-400 bg-slate-50 rounded-lg p-3">Bu personele ait bekleyen masraf yok. "Yeni masraf gir" ile ekleyin.</div> : (
              <select value={f.expense_id} onChange={(e) => setF({ ...f, expense_id: e.target.value })} className={inputCls} data-testid="quick-pay-expense">{open.map((x) => <option key={x.id} value={x.id}>{x.expense_number} · {x.category} · {x.description} · {fmt(x.total)} ₺</option>)}</select>
            )}
            {selected && <div className="mt-2 text-slate-600">Ödenecek: <b className="text-slate-900">{fmt(selected.total)} ₺</b> · {selected.date}</div>}
          </div>
        ) : (<>
          {isExpense && <div className="grid grid-cols-2 gap-2"><div><label className="block font-semibold mb-1">Kategori</label><select value={f.category} onChange={(e) => setF({ ...f, category: e.target.value })} className={inputCls} data-testid="quick-pay-category">{(cats.some((c) => c.name === f.category) ? cats : [{ name: f.category }, ...cats]).map((c) => <option key={c.name} value={c.name}>{c.name}</option>)}</select></div><div><label className="block font-semibold mb-1">Açıklama</label><input value={f.description} onChange={(e) => setF({ ...f, description: e.target.value })} placeholder="Örn: Şehir dışı yol" className={inputCls} data-testid="quick-pay-description" /></div></div>}
          <div><label className="block font-semibold mb-1">Tutar (₺)</label><input type="number" step="0.01" min="1" required autoFocus value={f.amount} onChange={(e) => setF({ ...f, amount: e.target.value })} className={`${inputCls} font-bold`} data-testid="quick-pay-amount" /></div>
          {!isExpense && <div><label className="block font-semibold mb-1">Açıklama</label><input value={f.note} onChange={(e) => setF({ ...f, note: e.target.value })} placeholder="Örn: Maaş avansı" className={inputCls} /></div>}
        </>)}
        <div><label className="block font-semibold mb-1">Kasa / Banka / Kart / Ortak</label><PaymentTargetSelect companyId={companyId} accounts={accounts} value={f.account_id} onChange={(v) => setF({ ...f, account_id: v })} testId="quick-pay-account" emptyLabel={isExpense ? "Şimdi ödenmeyecek (borç olarak kaydet)" : "Hesap seçilmedi (sadece kayıt)"} className={inputCls} /></div>
        <div className="text-slate-500">{isExpense
          ? (presetCat === MEAL_CAT || presetCat === TRANSPORT_CAT
            ? `${presetTitle(presetCat)} masraf olarak kaydedilir; personel kalan alacağından düşer, Masraflar modülünde görünür.`
            : "Masraflar → personel filtresinde ve personel kartında görünür; ödeme kasa/bankadan düşer.")
          : bonusKind === "overtime" ? `${p.period} dönemi · Fazla mesai ücreti gayri resmi ödeme olarak kaydedilir.`
          : bonusKind === "bonus" ? `${p.period} dönemi · Prim gayri resmi ödeme olarak kaydedilir.`
          : `${p.period} dönemi · Avans bordroda mahsup olarak görünür.`}</div>
        <div className="flex justify-end gap-2 pt-2 border-t"><button type="button" onClick={onClose} className="px-3 py-1.5 border rounded-lg">İptal</button><button type="submit" disabled={busy} className={`px-4 py-1.5 text-white rounded-lg font-semibold ${isExpense ? "bg-sky-600" : "bg-amber-600"}`} data-testid="quick-pay-submit">{busy ? "…" : isExpense && mode === "existing" ? "Öde" : f.account_id ? "Kaydet & Öde" : "Kaydet"}</button></div>
      </form>
    </div>
  );
};
