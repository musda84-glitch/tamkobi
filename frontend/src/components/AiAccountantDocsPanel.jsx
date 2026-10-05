import React, { useEffect, useRef, useState } from "react";
import axios from "axios";
import { toast } from "sonner";
import { Sparkles, Upload, Loader2, X, Landmark } from "lucide-react";
import { API_URL, useAuth } from "../context/AuthContext";
import { useAiStatus } from "../hooks/useAiStatus";
import { useEscape } from "../utils/useEscape";
import { compressImageFile } from "../utils/compressImage";
import { applyExpenseScan } from "../utils/expenseScan";
import { applyChequeScan } from "../utils/chequeScan";
import { canUploadBankStatement } from "../utils/bankStatementUpload";
import { ACCOUNTANT_AI_KINDS, accountantAiKindById, guessAccountantDocKind } from "../utils/accountantAiDocs";
import { backdropDismissProps } from "../utils/modalBackdrop";
import { notifyDataChanged } from "../utils/dataRefresh";
import { AiInvoiceImportModal } from "./AiInvoiceImportModal";
import { CardStatementImport } from "./CardStatementImport";
import { SearchSelect } from "./SearchSelect";

const inputCls = "w-full bg-slate-50 border border-slate-200 rounded-lg p-2 text-xs focus:ring-2 focus:ring-violet-500 outline-none";
const todayISO = () => new Date().toISOString().slice(0, 10);
const EMPTY_EXP = { date: todayISO(), category: "Diğer", description: "", amount: "", vat_rate: 20, vat_included: true, contact_id: "", document_no: "", notes: "" };
const EMPTY_CHQ = { direction: "received", instrument: "cheque", contact_id: "", amount: "", issue_date: todayISO(), due_date: todayISO(), serial_no: "", bank_name: "", notes: "" };

function kindAllowed(id, addonOn) {
  if (id === "purchase" || id === "sales") return addonOn("ai.invoice");
  return addonOn("ai.finance_docs");
}

export function AiAccountantDocsPanel({ companyId, onImported }) {
  const { addonOn } = useAuth();
  const { extractLabel, ready: aiReady } = useAiStatus();
  const kinds = ACCOUNTANT_AI_KINDS.filter((k) => kindAllowed(k.id, addonOn));
  const [kind, setKind] = useState(kinds[0]?.id || "purchase");
  const [contacts, setContacts] = useState([]);
  const [accounts, setAccounts] = useState([]);
  const [invoiceModal, setInvoiceModal] = useState(null);
  const [bankModal, setBankModal] = useState(null);
  const [review, setReview] = useState(null);
  const [busy, setBusy] = useState(false);
  const fileRef = useRef(null);
  const pickGuard = useRef(0);
  const meta = accountantAiKindById(kind);

  useEffect(() => {
    if (kinds.length && !kinds.some((k) => k.id === kind)) setKind(kinds[0].id);
  }, [kind, addonOn]);

  useEffect(() => {
    if (!companyId) return;
    let cancelled = false;
    const load = async () => {
      try {
        const r = await axios.get(`${API_URL}/contacts?company_id=${companyId}`);
        if (!cancelled) setContacts(Array.isArray(r?.data) ? r.data : []);
      } catch { /* ignore */ }
      try {
        const r = await axios.get(`${API_URL}/banking/accounts?company_id=${companyId}`);
        if (!cancelled) setAccounts(Array.isArray(r?.data) ? r.data : []);
      } catch { /* ignore */ }
    };
    load();
    return () => { cancelled = true; };
  }, [companyId]);

  const refresh = () => {
    onImported?.();
    notifyDataChanged({ companyId, scopes: ["invoices", "cash", "expenses"] });
  };

  const ingest = async (file, forcedKind) => {
    if (!file || busy) return;
    const nextKind = forcedKind || guessAccountantDocKind(file) || kind;
    if (!kindAllowed(nextKind, addonOn)) {
      toast.error("Bu evrak türü için AI aktarımı kapalı.");
      return;
    }
    setKind(nextKind);
    pickGuard.current = Date.now() + 1200;
    if (nextKind === "purchase" || nextKind === "sales") {
      setInvoiceModal({ invoiceType: nextKind, file });
      return;
    }
    if (nextKind === "bank") {
      const uploadable = accounts.filter(canUploadBankStatement);
      if (!uploadable.length) {
        toast.error("Ekstre yüklenecek entegre olmayan kasa/banka hesabı yok.");
        return;
      }
      const first = uploadable[0];
      const firstId = first.id || first._id;
      if (uploadable.length === 1) {
        setBankModal({ file, accountId: firstId, account: first, ready: true });
        return;
      }
      setBankModal({ file, accountId: firstId });
      return;
    }
    setBusy(true);
    try {
      const compact = file.type?.startsWith("image/") ? await compressImageFile(file) : file;
      const fd = new FormData();
      fd.append("file", compact);
      const path = nextKind === "cheque" ? "cheque-extract" : "expense-extract";
      const r = await axios.post(`${API_URL}/ai/${path}?company_id=${encodeURIComponent(companyId)}`, fd, { timeout: 180000 });
      const draft = r.data?.draft;
      if (!draft || !(Number(draft.amount) > 0)) {
        toast.error(nextKind === "cheque" ? "Çekten tutar okunamadı." : "Fişten tutar okunamadı.");
        return;
      }
      if (nextKind === "cheque") {
        setReview({ type: "cheque", form: applyChequeScan(EMPTY_CHQ, draft, r.data?.matched_contact) });
      } else {
        setReview({ type: "expense", form: applyExpenseScan(EMPTY_EXP, draft, r.data?.matched_contact) });
      }
      toast.success("AI belgeyi okudu. Kontrol edip kaydedin.");
    } catch (err) {
      toast.error(err.response?.data?.detail || (err.code === "ECONNABORTED" ? "İstek zaman aşımına uğradı." : "Belge okunamadı."));
    } finally {
      setBusy(false);
      if (fileRef.current) fileRef.current.value = "";
    }
  };

  if (!kinds.length) return null;

  return (
    <div className="bg-white border border-violet-200 rounded-2xl p-4 space-y-3" data-testid="acc-ai-docs">
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div>
          <div className="flex items-center gap-2 font-bold text-violet-800 text-xs">
            <Sparkles className="w-4 h-4" /> AI ile evrak yükle
            <span className={`text-[10px] font-semibold px-2 py-0.5 rounded-full ${aiReady ? "bg-violet-100 text-violet-700" : "bg-amber-100 text-amber-800"}`}>{extractLabel || "AI"}</span>
          </div>
          <p className="text-[11px] text-slate-500 mt-1 max-w-2xl">Alış/satış faturası, masraf fişi, çek-senet ve banka ekstresini bu ekrandan AI ile içeri alın. Türü seçin veya dosyayı bırakın; sistem türü tahmin eder.</p>
        </div>
      </div>
      <div className="flex flex-wrap gap-1.5" data-testid="acc-ai-kinds">
        {kinds.map((k) => (
          <button
            key={k.id}
            type="button"
            onClick={() => setKind(k.id)}
            className={`px-2.5 py-1.5 rounded-lg text-[11px] font-semibold ${kind === k.id ? "bg-violet-600 text-white" : "bg-slate-100 text-slate-600 hover:bg-slate-200"}`}
            data-testid={`acc-ai-kind-${k.id}`}
          >
            {k.label}
          </button>
        ))}
      </div>
      <div
        role="button"
        tabIndex={0}
        className={`flex flex-col items-center justify-center gap-1.5 border-2 border-dashed rounded-2xl p-6 text-xs text-slate-600 ${busy ? "opacity-60 pointer-events-none" : "cursor-pointer hover:bg-violet-50/40 hover:border-violet-400"}`}
        onDragOver={(e) => { e.preventDefault(); e.stopPropagation(); }}
        onDrop={(e) => { e.preventDefault(); e.stopPropagation(); ingest(e.dataTransfer.files?.[0], kind); }}
        onClick={() => { pickGuard.current = Date.now() + 1500; fileRef.current?.click(); }}
        onKeyDown={(e) => { if (e.key === "Enter" || e.key === " ") fileRef.current?.click(); }}
        data-testid="acc-ai-dropzone"
      >
        <input
          ref={fileRef}
          type="file"
          accept={meta.accept}
          className="hidden"
          onChange={(e) => ingest(e.target.files?.[0], kind)}
          data-testid="acc-ai-file"
        />
        {busy ? <><Loader2 className="w-7 h-7 animate-spin text-violet-600" /><span>Belge okunuyor…</span></> : <><Upload className="w-7 h-7 text-violet-600" /><span className="font-semibold">{meta.hint}</span><span className="text-[11px] text-slate-400">Sürükleyin veya tıklayarak seçin · max 10 MB</span></>}
      </div>

      {invoiceModal && (
        <AiInvoiceImportModal
          companyId={companyId}
          contacts={contacts}
          invoiceType={invoiceModal.invoiceType}
          initialFile={invoiceModal.file}
          onClose={() => setInvoiceModal(null)}
          onDone={() => { setInvoiceModal(null); refresh(); }}
        />
      )}
      {bankModal && !bankModal.ready && (
        <BankAccountPick
          accounts={accounts.filter(canUploadBankStatement)}
          value={bankModal.accountId}
          file={bankModal.file}
          onClose={() => setBankModal(null)}
          onPicked={(acc) => setBankModal((s) => ({ ...s, account: acc, ready: true }))}
        />
      )}
      {bankModal?.ready && bankModal.account && (
        <CardStatementImport
          account={{ ...bankModal.account, company_id: bankModal.account.company_id || companyId }}
          contacts={contacts}
          initialFile={bankModal.file}
          onClose={() => setBankModal(null)}
          onDone={() => { setBankModal(null); refresh(); }}
        />
      )}
      {review && (
        <ReviewModal
          review={review}
          contacts={contacts}
          companyId={companyId}
          onClose={() => { if (Date.now() < pickGuard.current) return; setReview(null); }}
          onSaved={() => { setReview(null); refresh(); }}
        />
      )}
    </div>
  );
}

function BankAccountPick({ accounts, value, file, onClose, onPicked }) {
  const [id, setId] = useState(value || (accounts[0]?.id || accounts[0]?._id || ""));
  useEscape(onClose);
  return (
    <div className="fixed inset-0 z-[60] bg-slate-900/60 backdrop-blur-sm flex items-center justify-center p-4" {...backdropDismissProps(onClose)}>
      <div className="bg-white rounded-2xl w-full max-w-md p-5 space-y-3 shadow-2xl" onClick={(e) => e.stopPropagation()} data-testid="acc-ai-bank-pick">
        <div className="flex items-center justify-between border-b pb-2">
          <h3 className="text-sm font-bold flex items-center gap-2"><Landmark className="w-4 h-4 text-blue-600" /> Ekstre hesabı</h3>
          <button type="button" onClick={onClose} className="text-slate-400"><X className="w-5 h-5" /></button>
        </div>
        <p className="text-[11px] text-slate-500">{file?.name || "Ekstre"} hangi hesaba işlensin?</p>
        <select value={id} onChange={(e) => setId(e.target.value)} className={inputCls} data-testid="acc-ai-bank-account">
          {accounts.map((a) => <option key={a.id || a._id} value={a.id || a._id}>{a.account_name || a.bank_name || "Hesap"}</option>)}
        </select>
        <div className="flex justify-end gap-2 pt-1">
          <button type="button" onClick={onClose} className="px-3 py-1.5 border rounded-lg text-xs">Vazgeç</button>
          <button type="button" onClick={() => onPicked(accounts.find((a) => (a.id || a._id) === id))} className="px-4 py-1.5 bg-violet-600 text-white rounded-lg text-xs font-semibold" data-testid="acc-ai-bank-continue">Devam</button>
        </div>
      </div>
    </div>
  );
}

function ReviewModal({ review, contacts, companyId, onClose, onSaved }) {
  const [f, setF] = useState(review.form);
  const [busy, setBusy] = useState(false);
  useEscape(onClose);
  const isCheque = review.type === "cheque";
  const save = async (e) => {
    e.preventDefault();
    setBusy(true);
    try {
      if (isCheque) {
        await axios.post(`${API_URL}/cheques`, { ...f, company_id: companyId, amount: Number(f.amount) });
        toast.success("Çek/senet kaydedildi.");
      } else {
        await axios.post(`${API_URL}/expenses`, { ...f, company_id: companyId, amount: Number(f.amount), vat_rate: Number(f.vat_rate), contact_id: f.contact_id || null });
        toast.success("Masraf kaydedildi.");
      }
      onSaved();
    } catch (err) {
      toast.error(err.response?.data?.detail || "Kaydedilemedi.");
    } finally {
      setBusy(false);
    }
  };
  return (
    <div className="fixed inset-0 z-[60] bg-slate-900/60 backdrop-blur-sm flex items-center justify-center p-4" {...backdropDismissProps(onClose)}>
      <form onSubmit={save} onClick={(e) => e.stopPropagation()} className="bg-white rounded-2xl w-full max-w-lg p-5 space-y-3 shadow-2xl max-h-[92vh] overflow-y-auto" data-testid="acc-ai-review">
        <div className="flex items-center justify-between border-b pb-2">
          <h3 className="text-sm font-bold">{isCheque ? "Çek / senet kaydet" : "Masraf kaydet"}</h3>
          <button type="button" onClick={onClose} className="text-slate-400"><X className="w-5 h-5" /></button>
        </div>
        <div className="grid grid-cols-2 gap-2 text-xs">
          {isCheque ? (
            <>
              <div><label className="block font-semibold mb-1">Yön</label><select value={f.direction} onChange={(e) => setF({ ...f, direction: e.target.value })} className={inputCls}><option value="received">Alınan</option><option value="issued">Verilen</option></select></div>
              <div><label className="block font-semibold mb-1">Tür</label><select value={f.instrument} onChange={(e) => setF({ ...f, instrument: e.target.value })} className={inputCls}><option value="cheque">Çek</option><option value="promissory">Senet</option></select></div>
              <div className="col-span-2"><label className="block font-semibold mb-1">Cari</label><SearchSelect value={f.contact_id} options={contacts} getLabel={(c) => c.name} getSub={(c) => c.tax_number_or_id} placeholder="Cari ara…" onChange={(id) => setF({ ...f, contact_id: id })} testId="acc-ai-cheque-contact" /></div>
              <div><label className="block font-semibold mb-1">Tutar</label><input type="number" step="0.01" required value={f.amount} onChange={(e) => setF({ ...f, amount: e.target.value })} className={inputCls} data-testid="acc-ai-cheque-amount" /></div>
              <div><label className="block font-semibold mb-1">Vade</label><input type="date" required value={f.due_date} onChange={(e) => setF({ ...f, due_date: e.target.value })} className={inputCls} /></div>
              <div className="col-span-2"><label className="block font-semibold mb-1">Çek no / banka</label><input value={f.serial_no} onChange={(e) => setF({ ...f, serial_no: e.target.value })} placeholder="Seri no" className={inputCls} /><input value={f.bank_name} onChange={(e) => setF({ ...f, bank_name: e.target.value })} placeholder="Banka" className={`${inputCls} mt-1`} /></div>
            </>
          ) : (
            <>
              <div><label className="block font-semibold mb-1">Tarih</label><input type="date" value={f.date} onChange={(e) => setF({ ...f, date: e.target.value })} className={inputCls} /></div>
              <div><label className="block font-semibold mb-1">Tutar</label><input type="number" step="0.01" required value={f.amount} onChange={(e) => setF({ ...f, amount: e.target.value })} className={inputCls} data-testid="acc-ai-exp-amount" /></div>
              <div className="col-span-2"><label className="block font-semibold mb-1">Açıklama</label><input required value={f.description} onChange={(e) => setF({ ...f, description: e.target.value })} className={inputCls} data-testid="acc-ai-exp-desc" /></div>
              <div><label className="block font-semibold mb-1">KDV %</label><select value={f.vat_rate} onChange={(e) => setF({ ...f, vat_rate: e.target.value })} className={inputCls}><option value={0}>%0</option><option value={1}>%1</option><option value={10}>%10</option><option value={20}>%20</option></select></div>
              <div className="flex items-end"><label className="flex items-center gap-2 text-[11px]"><input type="checkbox" checked={f.vat_included} onChange={(e) => setF({ ...f, vat_included: e.target.checked })} /> KDV dahil</label></div>
              <div className="col-span-2"><label className="block font-semibold mb-1">Tedarikçi (opsiyonel)</label><SearchSelect value={f.contact_id} options={contacts} getLabel={(c) => c.name} getSub={(c) => c.tax_number_or_id} placeholder="Cari ara…" onChange={(id) => setF({ ...f, contact_id: id })} testId="acc-ai-exp-contact" /></div>
            </>
          )}
        </div>
        <div className="flex justify-end gap-2 pt-2 border-t">
          <button type="button" onClick={onClose} className="px-3 py-1.5 border rounded-lg text-xs">Vazgeç</button>
          <button type="submit" disabled={busy} className="px-4 py-1.5 bg-violet-600 text-white rounded-lg text-xs font-semibold disabled:opacity-50" data-testid="acc-ai-review-save">{busy ? "Kaydediliyor…" : "Kaydet"}</button>
        </div>
      </form>
    </div>
  );
}
