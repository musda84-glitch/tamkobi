import React, { useEffect, useRef, useState } from "react";
import axios from "axios";
import { toast } from "sonner";
import { FileUp, Loader2, Upload, Wallet, X } from "lucide-react";
import { API_URL } from "../context/AuthContext";
import { formatTrAmount } from "../utils/money";
import { notifyDataChanged } from "../utils/dataRefresh";
import { useEscape } from "../utils/useEscape";
import { backdropDismissProps } from "../utils/modalBackdrop";
import { PaymentTargetSelect, splitPaymentTarget } from "./PaymentTargetSelect";
import { guessTaxSourceKind, TAX_SOURCE_KINDS, taxKindLabel, taxSourceById } from "../utils/taxObligations";

const fmt = (n) => `${formatTrAmount(n || 0)} ₺`;
const inputCls = "w-full bg-slate-50 border border-slate-200 rounded-lg p-2 text-xs focus:ring-2 focus:ring-amber-500 outline-none";

export function AccTaxObligationsPanel({ companyId, month, taxPayables, onChanged }) {
  const [kind, setKind] = useState("bordro");
  const [rows, setRows] = useState([]);
  const [summary, setSummary] = useState(taxPayables || { unpaid_count: 0, unpaid_total: 0 });
  const [busy, setBusy] = useState(false);
  const [draft, setDraft] = useState(null);
  const [payFor, setPayFor] = useState(null);
  const [payAcc, setPayAcc] = useState("");
  const fileRef = useRef(null);
  const meta = taxSourceById(kind);

  const load = async () => {
    if (!companyId) return;
    try {
      const r = await axios.get(`${API_URL}/tax-obligations`, { params: { company_id: companyId, month } });
      setRows(r.data?.obligations || []);
      setSummary(r.data?.summary || { unpaid_count: 0, unpaid_total: 0 });
    } catch {
      /* boş dönem */
    }
  };

  useEffect(() => { load(); }, [companyId, month]);

  const ingest = async (file, forcedKind) => {
    if (!file || busy) return;
    const nextKind = forcedKind || guessTaxSourceKind(file) || kind;
    setKind(nextKind || kind);
    setBusy(true);
    try {
      const fd = new FormData();
      fd.append("file", file);
      const r = await axios.post(
        `${API_URL}/tax-obligations/extract?company_id=${encodeURIComponent(companyId)}&source_kind=${encodeURIComponent(nextKind || "")}`,
        fd,
        { timeout: 120000 },
      );
      const d = r.data?.draft;
      if (!d?.obligations?.length) {
        toast.error("Belgeden ödenecek tutar okunamadı.");
        return;
      }
      setDraft({ ...d, selected: d.obligations.map((_, i) => i) });
      toast.success(`${d.obligations.length} ödenecek satır okundu. Kontrol edip kaydedin.`);
    } catch (err) {
      toast.error(err.response?.data?.detail || "Belge okunamadı.");
    } finally {
      setBusy(false);
      if (fileRef.current) fileRef.current.value = "";
    }
  };

  const saveDraft = async () => {
    if (!draft) return;
    setBusy(true);
    try {
      await axios.post(`${API_URL}/tax-obligations/import`, {
        company_id: companyId,
        draft,
        selected: draft.selected,
      });
      toast.success("Ödenecekler kaydedildi.");
      setDraft(null);
      await load();
      onChanged?.();
      notifyDataChanged({ companyId, scopes: ["cash"] });
    } catch (err) {
      toast.error(err.response?.data?.detail || "Kaydedilemedi.");
    } finally {
      setBusy(false);
    }
  };

  const pay = async () => {
    if (!payFor) return;
    const target = splitPaymentTarget(payAcc);
    if (!target.account_id && !target.partner_id) {
      toast.error("Kasa/Banka seçin.");
      return;
    }
    setBusy(true);
    try {
      await axios.post(`${API_URL}/tax-obligations/${payFor.id}/pay`, target);
      toast.success("Ödeme kasa/bankaya işlendi.");
      setPayFor(null);
      await load();
      onChanged?.();
      notifyDataChanged({ companyId, scopes: ["cash"] });
    } catch (err) {
      toast.error(err.response?.data?.detail || "Ödenemedi.");
    } finally {
      setBusy(false);
    }
  };

  const remove = async (id) => {
    try {
      await axios.delete(`${API_URL}/tax-obligations/${id}`);
      await load();
      onChanged?.();
    } catch (err) {
      toast.error(err.response?.data?.detail || "Silinemedi.");
    }
  };

  const unpaid = summary.unpaid_count || 0;

  return (
    <div className="bg-white border border-amber-200 rounded-2xl p-4 space-y-3" data-testid="acc-tax-payables">
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div>
          <div className="flex items-center gap-2 font-bold text-amber-800 text-xs">
            <Wallet className="w-4 h-4" /> Ödenecek vergiler / SGK
          </div>
          <p className="text-[11px] text-slate-500 mt-1 max-w-2xl">
            Bordro, mizan veya tahakkuk PDF yükleyin. SGK, gelir vergisi, damga, KDV ve net maaş satırları ödenecek listesine düşer; kasa/bankadan ödersiniz.
          </p>
        </div>
        <div className="text-[11px] text-slate-600" data-testid="acc-tax-summary">
          Ödenmemiş <b className="text-amber-800">{unpaid}</b> · {fmt(summary.unpaid_total)}
        </div>
      </div>
      <div className="flex flex-wrap gap-1.5" data-testid="acc-tax-kinds">
        {TAX_SOURCE_KINDS.map((k) => (
          <button
            key={k.id}
            type="button"
            onClick={() => setKind(k.id)}
            className={`px-2.5 py-1.5 rounded-lg text-[11px] font-semibold ${kind === k.id ? "bg-amber-700 text-white" : "bg-slate-100 text-slate-600 hover:bg-slate-200"}`}
            data-testid={`acc-tax-kind-${k.id}`}
          >
            {k.label}
          </button>
        ))}
      </div>
      <div
        role="button"
        tabIndex={0}
        className={`flex flex-col items-center justify-center gap-1.5 border-2 border-dashed rounded-2xl p-5 text-xs text-slate-600 ${busy ? "opacity-60 pointer-events-none" : "cursor-pointer hover:bg-amber-50/50 hover:border-amber-400"}`}
        onDragOver={(e) => { e.preventDefault(); e.stopPropagation(); }}
        onDrop={(e) => { e.preventDefault(); e.stopPropagation(); ingest(e.dataTransfer.files?.[0], kind); }}
        onClick={() => fileRef.current?.click()}
        onKeyDown={(e) => { if (e.key === "Enter" || e.key === " ") fileRef.current?.click(); }}
        data-testid="acc-tax-dropzone"
      >
        <input
          ref={fileRef}
          type="file"
          accept="application/pdf,.pdf,text/plain,.txt"
          className="hidden"
          onChange={(e) => ingest(e.target.files?.[0], kind)}
          data-testid="acc-tax-file"
        />
        {busy ? <><Loader2 className="w-6 h-6 animate-spin text-amber-700" /><span>Belge okunuyor…</span></> : <><Upload className="w-6 h-6 text-amber-700" /><span className="font-semibold">{meta.hint}</span><span className="text-[11px] text-slate-400">Sürükleyin veya tıklayın · PDF · max 10 MB</span></>}
      </div>

      {rows.length > 0 && (
        <div className="overflow-x-auto border border-slate-100 rounded-xl">
          <table className="w-full text-xs" data-testid="acc-tax-table">
            <thead className="bg-slate-50 text-slate-500 uppercase text-[10px]">
              <tr>
                <th className="text-left px-3 py-1.5">Kalem</th>
                <th className="text-left px-3 py-1.5">Kaynak</th>
                <th className="text-left px-3 py-1.5">Vade</th>
                <th className="text-right px-3 py-1.5">Tutar</th>
                <th className="text-right px-3 py-1.5">Durum</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {rows.map((r) => (
                <tr key={r.id} data-testid={`acc-tax-row-${r.id}`}>
                  <td className="px-3 py-1.5 font-semibold text-slate-800">{r.title || taxKindLabel(r.kind)}</td>
                  <td className="px-3 py-1.5 text-slate-500 capitalize">{r.source_kind}{r.filename ? ` · ${r.filename}` : ""}</td>
                  <td className="px-3 py-1.5 text-slate-500">{r.due_date || "—"}</td>
                  <td className="px-3 py-1.5 text-right font-bold">{fmt(r.amount)}</td>
                  <td className="px-3 py-1.5 text-right">
                    {r.payment_status === "paid" ? (
                      <span className="text-emerald-700 font-semibold">Ödendi</span>
                    ) : (
                      <span className="inline-flex gap-1">
                        <button type="button" onClick={() => { setPayFor(r); setPayAcc(""); }} className="px-2 py-1 rounded-lg bg-amber-700 text-white font-semibold" data-testid={`acc-tax-pay-${r.id}`}>Öde</button>
                        <button type="button" onClick={() => remove(r.id)} className="px-2 py-1 rounded-lg border text-slate-500" data-testid={`acc-tax-del-${r.id}`}>Sil</button>
                      </span>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {draft && (
        <DraftModal
          draft={draft}
          setDraft={setDraft}
          busy={busy}
          onClose={() => setDraft(null)}
          onSave={saveDraft}
        />
      )}
      {payFor && (
        <PayModal
          item={payFor}
          companyId={companyId}
          value={payAcc}
          onChange={setPayAcc}
          busy={busy}
          onClose={() => setPayFor(null)}
          onPay={pay}
        />
      )}
    </div>
  );
}

function DraftModal({ draft, setDraft, busy, onClose, onSave }) {
  useEscape(onClose);
  const toggle = (i) => {
    const sel = new Set(draft.selected || []);
    if (sel.has(i)) sel.delete(i); else sel.add(i);
    setDraft({ ...draft, selected: [...sel] });
  };
  const setAmt = (i, v) => {
    const obligations = draft.obligations.map((o, idx) => idx === i ? { ...o, amount: v } : o);
    setDraft({ ...draft, obligations });
  };
  return (
    <div className="fixed inset-0 z-[60] bg-slate-900/60 backdrop-blur-sm flex items-center justify-center p-4" {...backdropDismissProps(onClose)}>
      <div className="bg-white rounded-2xl w-full max-w-lg p-5 space-y-3 shadow-2xl max-h-[92vh] overflow-y-auto" onClick={(e) => e.stopPropagation()} data-testid="acc-tax-draft">
        <div className="flex items-center justify-between border-b pb-2">
          <h3 className="text-sm font-bold flex items-center gap-2"><FileUp className="w-4 h-4 text-amber-700" /> {draft.title || "Ödenecekler"}</h3>
          <button type="button" onClick={onClose} className="text-slate-400"><X className="w-5 h-5" /></button>
        </div>
        <p className="text-[11px] text-slate-500">{draft.filename} · {draft.source_kind}{draft.period ? ` · ${draft.period}` : ""}</p>
        <div className="space-y-1.5">
          {(draft.obligations || []).map((o, i) => (
            <label key={`${o.kind}-${i}`} className="flex items-center gap-2 text-xs border rounded-lg px-2 py-1.5" data-testid={`acc-tax-draft-line-${i}`}>
              <input type="checkbox" checked={(draft.selected || []).includes(i)} onChange={() => toggle(i)} />
              <span className="flex-1 font-semibold">{o.title || taxKindLabel(o.kind)}</span>
              <input type="number" step="0.01" value={o.amount} onChange={(e) => setAmt(i, e.target.value)} className="w-28 border rounded-lg px-2 py-1 text-right" />
              <span className="text-slate-400 w-24">{o.due_date || ""}</span>
            </label>
          ))}
        </div>
        <div className="flex justify-end gap-2 pt-2 border-t">
          <button type="button" onClick={onClose} className="px-3 py-1.5 border rounded-lg text-xs">Vazgeç</button>
          <button type="button" disabled={busy || !(draft.selected || []).length} onClick={onSave} className="px-4 py-1.5 bg-amber-700 text-white rounded-lg text-xs font-semibold disabled:opacity-50" data-testid="acc-tax-draft-save">{busy ? "Kaydediliyor…" : "Ödenecek kaydet"}</button>
        </div>
      </div>
    </div>
  );
}

function PayModal({ item, companyId, value, onChange, busy, onClose, onPay }) {
  useEscape(onClose);
  return (
    <div className="fixed inset-0 z-[60] bg-slate-900/60 backdrop-blur-sm flex items-center justify-center p-4" {...backdropDismissProps(onClose)}>
      <div className="bg-white rounded-2xl w-full max-w-md p-5 space-y-3 shadow-2xl" onClick={(e) => e.stopPropagation()} data-testid="acc-tax-pay-modal">
        <div className="flex items-center justify-between border-b pb-2">
          <h3 className="text-sm font-bold">Öde — {item.title}</h3>
          <button type="button" onClick={onClose} className="text-slate-400"><X className="w-5 h-5" /></button>
        </div>
        <p className="text-xs text-slate-600">{fmt(item.amount)} · vade {item.due_date || "—"}</p>
        <PaymentTargetSelect companyId={companyId} value={value} onChange={onChange} testId="acc-tax-pay-account" includePartners />
        <div className="flex justify-end gap-2 pt-1">
          <button type="button" onClick={onClose} className="px-3 py-1.5 border rounded-lg text-xs">Vazgeç</button>
          <button type="button" disabled={busy} onClick={onPay} className="px-4 py-1.5 bg-amber-700 text-white rounded-lg text-xs font-semibold disabled:opacity-50" data-testid="acc-tax-pay-confirm">{busy ? "İşleniyor…" : "Öde"}</button>
        </div>
      </div>
    </div>
  );
}
