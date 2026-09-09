import React, { useEffect, useRef, useState } from "react";
import axios from "axios";
import { toast } from "sonner";
import { Sparkles, Loader2, X, CreditCard } from "lucide-react";
import { API_URL } from "../context/AuthContext";
import { useEscape } from "../utils/useEscape";

const fmt = (n) => (Number(n) || 0).toLocaleString("tr-TR", { minimumFractionDigits: 2, maximumFractionDigits: 2 });

const KIND_OPTIONS = [
  { value: "masraf", label: "Masraf" },
  { value: "cari_odeme", label: "Cari ödeme" },
  { value: "islem", label: "Sadece hareket" },
];

export const CardStatementImport = ({ account, contacts = [], initialFile = null, onClose, onDone }) => {
  useEscape(onClose);
  const [file, setFile] = useState(initialFile || null);
  const [res, setRes] = useState(null);
  const [rows, setRows] = useState([]);
  const [busy, setBusy] = useState(false);
  const [contactList, setContactList] = useState(contacts);
  const [categories, setCategories] = useState([]);
  const autoStarted = useRef(false);

  useEffect(() => {
    if (contacts?.length) setContactList(contacts);
  }, [contacts]);

  useEffect(() => {
    const cid = account.company_id;
    if (!contactList.length && cid) {
      axios.get(`${API_URL}/contacts?company_id=${cid}`).then((r) => setContactList(r.data || [])).catch(() => {});
    }
    axios.get(`${API_URL}/expenses/categories?company_id=${account.company_id || ""}`).then((r) => {
      const names = (r.data || []).map((c) => c.name || c).filter(Boolean);
      setCategories(names);
    }).catch(() => {});
  }, [account.company_id, contactList.length]);

  const analyze = async (picked = file) => {
    if (!picked) return;
    setFile(picked);
    setBusy(true);
    try {
      const fd = new FormData();
      fd.append("file", picked);
      const r = await axios.post(`${API_URL}/banking/accounts/${account.id}/import-statement?dry_run=true`, fd);
      setRes(r.data);
      setRows((r.data.transactions || []).map((t) => ({
        ...t,
        included: t.included !== false && !t.duplicate && Number(t.amount) !== 0,
        kind: t.kind || (Number(t.amount) < 0 ? "islem" : t.suggested_contact_id ? "cari_odeme" : "masraf"),
        contact_id: t.contact_id || t.suggested_contact_id || "",
        contact_name: t.contact_name || t.suggested_contact_name || "",
        category: t.category || "Diğer",
      })));
      toast.success(`AI ekstreyi okudu: ${r.data.transactions.length} hareket. Cari / masraf eşlemesini kontrol edin.`);
    } catch (err) {
      toast.error(err.response?.data?.detail || "Ekstre işlenemedi.");
    } finally {
      setBusy(false);
    }
  };

  useEffect(() => {
    if (!initialFile || autoStarted.current) return;
    autoStarted.current = true;
    analyze(initialFile);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [initialFile]);

  const patchRow = (i, p) => setRows((prev) => prev.map((row, j) => {
    if (j !== i) return row;
    const next = { ...row, ...p };
    if (p.contact_id !== undefined) {
      const c = contactList.find((x) => (x.id || x._id) === p.contact_id);
      next.contact_name = c?.name || "";
      if (p.contact_id && next.kind === "masraf" && row.suggested_contact_id === p.contact_id) {
        next.kind = "cari_odeme";
      }
    }
    return next;
  }));

  const confirm = async () => {
    setBusy(true);
    try {
      const r = await axios.post(`${API_URL}/banking/accounts/${account.id}/import-statement/confirm`, {
        statement: res?.statement || {},
        lines: rows.map((t) => ({
          date: t.date,
          description: t.description,
          amount: t.amount,
          installment: t.installment,
          category: t.category,
          kind: t.kind,
          contact_id: t.contact_id || null,
          contact_name: t.contact_name || null,
          included: !!t.included && !t.duplicate,
        })),
      });
      toast.success(r.data.message);
      onDone?.();
      onClose();
    } catch (err) {
      toast.error(err.response?.data?.detail || "Aktarım başarısız.");
    } finally {
      setBusy(false);
    }
  };

  const st = res?.statement;
  const newCount = rows.filter((t) => t.included && !t.duplicate).length;
  const masrafCount = rows.filter((t) => t.included && !t.duplicate && t.kind === "masraf").length;
  const cariCount = rows.filter((t) => t.included && !t.duplicate && t.kind === "cari_odeme").length;

  return (
    <div className="fixed inset-0 z-50 bg-slate-900/60 backdrop-blur-sm flex items-center justify-center p-4" onClick={onClose}>
      <div onClick={(e) => e.stopPropagation()} className="bg-white rounded-2xl w-full max-w-5xl p-6 space-y-4 shadow-2xl max-h-[92vh] overflow-y-auto" data-testid="card-statement-modal">
        <div className="flex items-center justify-between border-b pb-3">
          <h3 className="text-base font-bold flex items-center gap-2">
            <CreditCard className="w-5 h-5 text-fuchsia-600" /> Kredi Kartı Ekstresi Aktar
            <span className="text-xs font-normal text-slate-500">· {account.account_name}{account.card_last4 ? ` · **** ${account.card_last4}` : ""}</span>
          </h3>
          <button onClick={onClose} type="button"><X className="w-5 h-5 text-slate-400" /></button>
        </div>
        <label className="flex items-center gap-3 border-2 border-dashed rounded-xl p-4 cursor-pointer text-xs hover:bg-violet-50/40" data-testid="card-stmt-dropzone">
          <Sparkles className="w-6 h-6 text-violet-600" />
          <div>
            <b>{file ? file.name : "Banka ekstre PDF'ini seçin"}</b>
            <div className="text-slate-400">AI harcamaları çıkarır; her satırı masraf veya cari ödeme olarak eşleyebilirsiniz. Kart numarası / CVV yüklemeyin.</div>
          </div>
          <input type="file" accept="application/pdf,text/plain" className="hidden" onChange={(e) => { setFile(e.target.files?.[0]); setRes(null); setRows([]); }} data-testid="card-stmt-file" />
        </label>
        {!res && (
          <div className="flex justify-end">
            <button onClick={analyze} disabled={!file || busy} className="px-4 py-2 bg-violet-600 text-white rounded-lg text-xs font-semibold disabled:opacity-40 flex items-center gap-1.5" data-testid="card-stmt-analyze">
              {busy ? <Loader2 className="w-4 h-4 animate-spin" /> : <Sparkles className="w-4 h-4" />} AI ile Analiz Et
            </button>
          </div>
        )}
        {res && (
          <>
            <div className="grid grid-cols-2 md:grid-cols-5 gap-2 text-xs">
              {[["Banka", st.bank], ["Kart", st.card_last4 ? `**** ${st.card_last4}` : (account.card_last4 ? `**** ${account.card_last4}` : "-")], ["Son Ödeme", st.due_date], ["Toplam Borç", st.total_debt != null ? `${fmt(st.total_debt)} ₺` : "-"], ["Asgari", st.minimum_payment != null ? `${fmt(st.minimum_payment)} ₺` : "-"]].map(([l, v]) => (
                <div key={l} className="bg-slate-50 rounded-lg p-2"><div className="text-[10px] text-slate-400">{l}</div><b>{v || "-"}</b></div>
              ))}
            </div>
            <p className="text-[11px] text-slate-500">Satırları masraf (gider fişi) veya cari ödeme olarak işaretleyin. AI önerisi varsa cari otomatik seçilir; dilediğiniz gibi değiştirin.</p>
            <div className="max-h-80 overflow-auto border rounded-xl">
              <table className="w-full text-xs">
                <thead className="bg-slate-50 text-slate-500 uppercase text-[10px] sticky top-0">
                  <tr>
                    <th className="p-2 text-left">Aktar</th>
                    <th className="p-2 text-left">Tarih</th>
                    <th className="text-left">Açıklama</th>
                    <th className="text-left">Tür</th>
                    <th className="text-left">Cari</th>
                    <th className="text-left">Kategori</th>
                    <th className="text-right pr-2">Tutar</th>
                  </tr>
                </thead>
                <tbody className="divide-y">
                  {rows.map((t, i) => (
                    <tr key={i} className={t.duplicate ? "opacity-40" : ""} data-testid={`card-stmt-row-${i}`}>
                      <td className="p-2">
                        <input type="checkbox" checked={!!t.included && !t.duplicate} disabled={!!t.duplicate} onChange={(e) => patchRow(i, { included: e.target.checked })} data-testid={`card-stmt-include-${i}`} />
                      </td>
                      <td className="p-2 whitespace-nowrap">{t.date}</td>
                      <td className="pr-2">
                        {t.description}
                        {t.installment && <span className="ml-1 text-[9px] bg-amber-100 text-amber-700 px-1 rounded">{t.installment}</span>}
                        {t.duplicate && <span className="ml-1 text-[9px] text-slate-400">(zaten var)</span>}
                        {t.suggested_contact_name && <div className="text-[10px] text-emerald-700">Öneri: {t.suggested_contact_name}</div>}
                      </td>
                      <td>
                        <select value={t.kind} onChange={(e) => patchRow(i, { kind: e.target.value })} className="bg-slate-50 border border-slate-200 rounded-md p-1 max-w-[8.5rem]" data-testid={`card-stmt-kind-${i}`}>
                          {KIND_OPTIONS.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
                        </select>
                      </td>
                      <td>
                        <select value={t.contact_id || ""} onChange={(e) => patchRow(i, { contact_id: e.target.value })} className="bg-slate-50 border border-slate-200 rounded-md p-1 max-w-[10rem]" data-testid={`card-stmt-contact-${i}`}>
                          <option value="">— Cari yok —</option>
                          {contactList.map((c) => {
                            const id = c.id || c._id;
                            return <option key={id} value={id}>{c.name}</option>;
                          })}
                        </select>
                      </td>
                      <td>
                        <select value={t.category} onChange={(e) => patchRow(i, { category: e.target.value })} className="bg-slate-50 border border-slate-200 rounded-md p-1 max-w-[9rem]" data-testid={`card-stmt-cat-${i}`}>
                          {(categories.includes(t.category) ? categories : [t.category, ...categories]).filter(Boolean).map((n) => <option key={n} value={n}>{n}</option>)}
                        </select>
                      </td>
                      <td className={`text-right pr-2 font-bold ${t.amount < 0 ? "text-emerald-600" : "text-rose-600"}`}>{fmt(t.amount)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <div className="flex justify-between items-center pt-2 border-t text-xs gap-3 flex-wrap">
              <span className="text-slate-500">
                {newCount} hareket · {masrafCount} masraf · {cariCount} cari ödeme
                {st?.total_debt != null ? ` · kart borcu ${fmt(st.total_debt)} ₺` : ""}
              </span>
              <button onClick={confirm} disabled={busy || !newCount} className="px-4 py-2 bg-emerald-600 text-white rounded-lg font-semibold disabled:opacity-40" data-testid="card-stmt-import">
                {busy ? "Aktarılıyor…" : "Eşleşmeleri Onayla & Aktar"}
              </button>
            </div>
          </>
        )}
      </div>
    </div>
  );
};
