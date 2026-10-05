
import React, { useEffect, useRef, useState } from "react";
import axios from "axios";
import { toast } from "sonner";
import { Sparkles, Loader2, X, CreditCard, Landmark } from "lucide-react";
import { API_URL } from "../context/AuthContext";
import { useEscape } from "../utils/useEscape";
import { formatTrAmount } from "../utils/money";
import { backdropDismissProps } from "../utils/modalBackdrop";
import { PanelBoundary } from "./saas/PanelBoundary";
import {
  BANK_STMT_ACCEPT,
  CARD_STMT_ACCEPT,
  asContactList,
  isCardAccount,
  resolveStatementFile,
  statementAmountPositive,
  statementRowsFromPayload,
} from "../utils/bankStatementUpload";

const fmt = (n) => formatTrAmount((Number(n) || 0));

const KIND_OPTIONS = [
  { value: "masraf", label: "Masraf" },
  { value: "cari_odeme", label: "Cari ödeme" },
  { value: "islem", label: "Sadece hareket" },
];

export const CardStatementImport = ({ account, contacts = [], initialFile = null, onClose, onDone }) => {
  useEscape(onClose);
  return (
    <div className="fixed inset-0 z-50 bg-slate-900/60 backdrop-blur-sm flex items-center justify-center p-4" {...backdropDismissProps(onClose)}>
      <PanelBoundary label="Hesap hareketi yükleme">
        <CardStatementImportBody account={account} contacts={contacts} initialFile={initialFile} onClose={onClose} onDone={onDone} />
      </PanelBoundary>
    </div>
  );
};

const CardStatementImportBody = ({ account, contacts = [], initialFile = null, onClose, onDone }) => {
  const acc = account || {};
  const accId = acc.id || acc._id;
  const companyId = acc.company_id || "";
  const isCard = isCardAccount(acc);
  const tid = isCard ? "card-stmt" : "bank-stmt";
  const [file, setFile] = useState(() => resolveStatementFile(initialFile, null));
  const [res, setRes] = useState(null);
  const [rows, setRows] = useState([]);
  const [busy, setBusy] = useState(false);
  const [contactList, setContactList] = useState(() => asContactList(contacts));
  const [categories, setCategories] = useState([]);
  const autoStarted = useRef(false);
  const list = asContactList(contactList);
  const categoryNames = Array.isArray(categories) ? categories : [];

  useEffect(() => {
    const next = asContactList(contacts);
    if (next.length) setContactList(next);
  }, [contacts]);

  useEffect(() => {
    if (!list.length && companyId) {
      axios.get(`${API_URL}/contacts?company_id=${companyId}`).then((r) => setContactList(asContactList(r.data))).catch(() => {});
    }
    axios.get(`${API_URL}/expenses/categories?company_id=${companyId}`).then((r) => {
      const src = Array.isArray(r.data) ? r.data : [];
      setCategories(src.map((c) => (typeof c === "string" ? c : c?.name)).filter(Boolean));
    }).catch(() => {});
  }, [companyId, list.length]);

  const analyze = async (picked) => {
    const src = resolveStatementFile(picked, file);
    if (!src || !accId) return;
    setFile(src);
    setBusy(true);
    try {
      const fd = new FormData();
      fd.append("file", src);
      const r = await axios.post(`${API_URL}/banking/accounts/${accId}/import-statement?dry_run=true`, fd);
      const parsed = statementRowsFromPayload(r.data, isCard);
      setRes({ statement: parsed.statement, filename: parsed.filename, mode: parsed.mode });
      setRows(parsed.rows);
      toast.success(`AI ekstreyi okudu: ${parsed.rows.length} hareket. Cari / masraf eşlemesini kontrol edin.`);
    } catch (err) {
      toast.error(err.response?.data?.detail || "Ekstre işlenemedi.");
    } finally {
      setBusy(false);
    }
  };

  useEffect(() => {
    if (!resolveStatementFile(initialFile, null) || autoStarted.current) return;
    autoStarted.current = true;
    analyze(initialFile);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [initialFile]);

  const patchRow = (i, p) => setRows((prev) => prev.map((row, j) => {
    if (j !== i) return row;
    const next = { ...row, ...p };
    if (p.contact_id !== undefined) {
      const c = list.find((x) => (x.id || x._id) === p.contact_id);
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
      const r = await axios.post(`${API_URL}/banking/accounts/${accId}/import-statement/confirm`, {
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

  const st = res?.statement && typeof res.statement === "object" ? res.statement : {};
  const newCount = rows.filter((t) => t.included && !t.duplicate).length;
  const masrafCount = rows.filter((t) => t.included && !t.duplicate && t.kind === "masraf").length;
  const cariCount = rows.filter((t) => t.included && !t.duplicate && t.kind === "cari_odeme").length;
  const TitleIcon = isCard ? CreditCard : Landmark;

  const onPickFile = (e) => {
    const picked = e.target.files?.[0];
    e.target.value = "";
    if (!picked) return;
    setRes(null);
    setRows([]);
    analyze(picked);
  };

  return (
    <div onClick={(e) => e.stopPropagation()} className="bg-white rounded-2xl w-full max-w-5xl p-6 space-y-4 shadow-2xl max-h-[92vh] overflow-y-auto" data-testid={isCard ? "card-statement-modal" : "bank-statement-modal"}>
        <div className="flex items-center justify-between border-b pb-3">
          <h3 className="text-base font-bold flex items-center gap-2">
            <TitleIcon className={`w-5 h-5 ${isCard ? "text-fuchsia-600" : "text-violet-600"}`} />
            {isCard ? "Kredi Kartı Ekstresi Aktar" : "Hesap Hareketi Yükle (AI)"}
            <span className="text-xs font-normal text-slate-500">· {acc.account_name}{acc.card_last4 ? ` · **** ${acc.card_last4}` : ""}{acc.bank_name ? ` · ${acc.bank_name}` : ""}</span>
          </h3>
          <button onClick={onClose} type="button"><X className="w-5 h-5 text-slate-400" /></button>
        </div>
        <label className="flex items-center gap-3 border-2 border-dashed rounded-xl p-4 cursor-pointer text-xs hover:bg-violet-50/40" data-testid={`${tid}-dropzone`}>
          <Sparkles className="w-6 h-6 text-violet-600" />
          <div>
            <b>{file ? file.name : (isCard ? "Banka ekstre PDF'ini seçin" : "Ekstre PDF / Excel / CSV seçin")}</b>
            <div className="text-slate-400">
              {isCard
                ? "AI harcamaları çıkarır; her satırı masraf veya cari ödeme olarak eşleyebilirsiniz. Kart numarası / CVV yüklemeyin."
                : "AI giriş/çıkış hareketlerini çıkarır. Entegre hesaplarda yükleme kapalıdır; satırları cari veya masraf olarak eşleyebilirsiniz."}
            </div>
          </div>
          <input type="file" accept={isCard ? CARD_STMT_ACCEPT : BANK_STMT_ACCEPT} className="hidden" onChange={onPickFile} data-testid={`${tid}-file`} />
        </label>
        {!res && (
          <div className="flex justify-end">
            <button type="button" onClick={() => analyze()} disabled={!file || busy} className="px-4 py-2 bg-violet-600 text-white rounded-lg text-xs font-semibold disabled:opacity-40 flex items-center gap-1.5" data-testid={`${tid}-analyze`}>
              {busy ? <Loader2 className="w-4 h-4 animate-spin" /> : <Sparkles className="w-4 h-4" />} AI ile Analiz Et
            </button>
          </div>
        )}
        {res && (
          <>
            <div className={`grid grid-cols-2 ${isCard ? "md:grid-cols-5" : "md:grid-cols-4"} gap-2 text-xs`}>
              {(isCard
                ? [["Banka", st.bank], ["Kart", st.card_last4 ? `**** ${st.card_last4}` : (acc.card_last4 ? `**** ${acc.card_last4}` : "-")], ["Son Ödeme", st.due_date], ["Toplam Borç", st.total_debt != null ? `${fmt(st.total_debt)} ₺` : "-"], ["Asgari", st.minimum_payment != null ? `${fmt(st.minimum_payment)} ₺` : "-"]]
                : [["Banka", st.bank], ["Dönem", st.period_start && st.period_end ? `${st.period_start} – ${st.period_end}` : (st.statement_date || "-")], ["Açılış", st.opening_balance != null ? `${fmt(st.opening_balance)} ₺` : "-"], ["Kapanış", st.closing_balance != null ? `${fmt(st.closing_balance)} ₺` : "-"]]
              ).map(([l, v]) => (
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
                    <tr key={i} className={t.duplicate ? "opacity-40" : ""} data-testid={`${tid}-row-${i}`}>
                      <td className="p-2">
                        <input type="checkbox" checked={!!t.included && !t.duplicate} disabled={!!t.duplicate} onChange={(e) => patchRow(i, { included: e.target.checked })} data-testid={`${tid}-include-${i}`} />
                      </td>
                      <td className="p-2 whitespace-nowrap">{t.date}</td>
                      <td className="pr-2">
                        {t.description}
                        {t.installment && <span className="ml-1 text-[9px] bg-amber-100 text-amber-700 px-1 rounded">{t.installment}</span>}
                        {t.duplicate && <span className="ml-1 text-[9px] text-slate-400">(zaten var)</span>}
                        {t.suggested_contact_name && <div className="text-[10px] text-emerald-700">Öneri: {t.suggested_contact_name}</div>}
                      </td>
                      <td>
                        <select value={t.kind} onChange={(e) => patchRow(i, { kind: e.target.value })} className="bg-slate-50 border border-slate-200 rounded-md p-1 max-w-[8.5rem]" data-testid={`${tid}-kind-${i}`}>
                          {KIND_OPTIONS.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
                        </select>
                      </td>
                      <td>
                        <select value={t.contact_id || ""} onChange={(e) => patchRow(i, { contact_id: e.target.value })} className="bg-slate-50 border border-slate-200 rounded-md p-1 max-w-[10rem]" data-testid={`${tid}-contact-${i}`}>
                          <option value="">— Cari yok —</option>
                          {list.map((c) => {
                            const id = c.id || c._id;
                            return <option key={id} value={id}>{c.name}</option>;
                          })}
                        </select>
                      </td>
                      <td>
                        <select value={t.category} onChange={(e) => patchRow(i, { category: e.target.value })} className="bg-slate-50 border border-slate-200 rounded-md p-1 max-w-[9rem]" data-testid={`${tid}-cat-${i}`}>
                          {(categoryNames.includes(t.category) ? categoryNames : [t.category, ...categoryNames]).filter(Boolean).map((n) => <option key={n} value={n}>{n}</option>)}
                        </select>
                      </td>
                      <td className={`text-right pr-2 font-bold ${statementAmountPositive(t.amount, isCard) ? "text-emerald-600" : "text-rose-600"}`}>{fmt(t.amount)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <div className="flex justify-between items-center pt-2 border-t text-xs gap-3 flex-wrap">
              <span className="text-slate-500">
                {newCount} hareket · {masrafCount} masraf · {cariCount} cari ödeme
                {isCard && st?.total_debt != null ? ` · kart borcu ${fmt(st.total_debt)} ₺` : ""}
              </span>
              <button type="button" onClick={confirm} disabled={busy || !newCount} className="px-4 py-2 bg-emerald-600 text-white rounded-lg font-semibold disabled:opacity-40" data-testid={`${tid}-import`}>
                {busy ? "Aktarılıyor…" : "Eşleşmeleri Onayla & Aktar"}
              </button>
            </div>
          </>
        )}
    </div>
  );
};
