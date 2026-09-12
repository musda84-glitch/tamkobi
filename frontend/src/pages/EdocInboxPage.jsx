import React, { useCallback, useEffect, useState } from "react";
import axios from "axios";
import { toast } from "sonner";
import {
  Inbox, Upload, CheckCircle2, XCircle, UserPlus, PackagePlus, Loader2, Link2,
  RefreshCw, AlertTriangle, FileCode2, Trash2, X, Download,
} from "lucide-react";
import { API_URL, useAuth } from "../context/AuthContext";
import { SearchSelect } from "../components/SearchSelect";

const fmt = (n) => (Number(n) || 0).toLocaleString("tr-TR", { minimumFractionDigits: 2 });
const STATUS = {
  pending: ["Bekliyor", "bg-amber-50 text-amber-700"],
  approved: ["İçeri alındı", "bg-emerald-50 text-emerald-700"],
  rejected: ["Reddedildi", "bg-rose-50 text-rose-700"],
};

function isProcessable(doc) {
  if (!doc || doc.status !== "pending") return false;
  const blank = !(doc.lines || []).length && !doc.supplier?.name && !doc.supplier?.tax_id && !Number(doc.grand_total);
  return !blank;
}

export default function EdocInboxPage() {
  const { activeCompany } = useAuth();
  const companyId = activeCompany?.id || activeCompany?._id || "comp_nexus_main_01";
  const [data, setData] = useState(null);
  const [status, setStatus] = useState("pending");
  const [sel, setSel] = useState(null);
  const [contacts, setContacts] = useState([]);
  const [products, setProducts] = useState([]);
  const [busy, setBusy] = useState("");
  const [opts, setOpts] = useState({ update_stock: true, update_cost: true, allow_unmatched: true });
  const [pullNote, setPullNote] = useState(null);
  const [xml, setXml] = useState(null);

  const load = useCallback(() => axios
    .get(`${API_URL}/edocs/inbox`, { params: { company_id: companyId, status: status || undefined } })
    .then((r) => {
      setData(r.data);
      setSel((prev) => (prev ? r.data.items.find((i) => i.id === prev.id) || null : null));
    })
    .catch(() => toast.error("Gelen belgeler yüklenemedi.")), [companyId, status]);

  useEffect(() => { load(); }, [load]);

  useEffect(() => {
    axios.get(`${API_URL}/contacts`, { params: { company_id: companyId } })
      .then((r) => setContacts(Array.isArray(r.data) ? r.data : r.data?.items || []))
      .catch(() => {});
    axios.get(`${API_URL}/products`, { params: { company_id: companyId } })
      .then((r) => setProducts(Array.isArray(r.data) ? r.data : r.data?.items || []))
      .catch(() => {});
  }, [companyId]);

  const act = async (fn, okMsg) => {
    setBusy("act");
    try {
      const r = await fn();
      toast.success(r?.data?.message || okMsg);
      await load();
      return r;
    } catch (e) {
      toast.error(typeof e.response?.data?.detail === "string" ? e.response.data.detail : "İşlem başarısız.");
    } finally {
      setBusy("");
    }
  };

  const upload = (file) => {
    if (!file) return;
    const fd = new FormData();
    fd.append("file", file);
    fd.append("company_id", companyId);
    act(() => axios.post(`${API_URL}/edocs/inbox/upload`, fd).then((r) => {
      setStatus("pending");
      setSel(r.data);
      return r;
    }), "Belge alındı.");
  };

  const pullN11 = () => act(() => axios.post(`${API_URL}/einvoice/incoming/sync`, null, {
    params: { company_id: companyId, days: 14 },
  }).then((r) => {
    setStatus("pending");
    setPullNote(r.data);
    return r;
  }), "n11 Faturam gelen kutusu çekildi.");

  const cleanup = () => {
    if (!window.confirm("Tedarikçisi, kalemi ve tutarı okunamamış bekleyen kayıtlar silinecek. Faturaları entegratörden yeniden çekebilirsiniz. Devam edilsin mi?")) return;
    act(() => axios.post(`${API_URL}/edocs/inbox/cleanup`, null, { params: { company_id: companyId } }).then((r) => {
      setSel(null);
      return r;
    }));
  };

  const reparse = () => act(() => axios.post(`${API_URL}/edocs/inbox/reparse`, null, { params: { company_id: companyId } }));

  const showXml = async () => {
    try {
      const r = await axios.get(`${API_URL}/edocs/inbox/${sel.id}/xml`, { params: { company_id: companyId } });
      setXml(r.data.xml);
    } catch (e) {
      toast.error(e.response?.data?.detail || "Ham XML alınamadı.");
    }
  };

  const setLine = (idx, productId) => act(() => axios.put(`${API_URL}/edocs/inbox/${sel.id}/lines`, {
    lines: [{ idx, product_id: productId }],
  }).then((r) => {
    setSel(r.data);
    return { data: { message: "Satır eşleştirildi." } };
  }));

  const processOne = (docId) => act(() => axios.post(`${API_URL}/edocs/inbox/${docId}/process`, opts).then((r) => {
    setSel((prev) => (prev?.id === docId ? null : prev));
    return r;
  }), "Belge içeri alındı.");

  const processPending = () => {
    if (!window.confirm("Bekleyen okunabilir belgeler BizimHesap gibi toplu içeri alınacak (tedarikçi yoksa oluşturulur, eşleşmeyen kalemler hizmet olarak alınır). Devam?")) return;
    act(() => axios.post(`${API_URL}/edocs/inbox/process-pending`, opts, {
      params: { company_id: companyId },
    }), "Toplu içeri alma tamamlandı.");
  };

  return (
    <div className="space-y-4" data-testid="edoc-inbox-page">
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
        <div>
          <h1 className="text-xl sm:text-2xl font-bold text-slate-900 flex items-center gap-2">
            <Inbox className="w-6 h-6 text-indigo-600" /> Gelen e-Belgeler
          </h1>
          <p className="text-xs text-slate-500">
            BizimHesap gibi: n11 Faturam&apos;dan çekin veya UBL/PDF yükleyin → <b>İçeri Al</b> ile alış faturası ve stok girişi tek tıkta.
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <button type="button" onClick={pullN11} disabled={busy === "act"} className="px-4 py-2 border rounded-xl text-xs font-semibold inline-flex items-center gap-1.5 disabled:opacity-60" data-testid="edoc-n11-pull">
            <RefreshCw className={`w-4 h-4 ${busy === "act" ? "animate-spin" : ""}`} /> n11 Faturam gelen kutusu
          </button>
          {status === "pending" && (data?.counts?.pending || 0) > 0 && (
            <button type="button" onClick={processPending} disabled={busy === "act"} className="px-4 py-2 bg-emerald-700 hover:bg-emerald-800 text-white rounded-xl text-xs font-semibold inline-flex items-center gap-1.5 disabled:opacity-60" data-testid="edoc-process-pending">
              <Download className="w-4 h-4" /> Bekleyenleri içeri al
            </button>
          )}
          <label className="px-4 py-2 bg-indigo-600 hover:bg-indigo-700 text-white rounded-xl text-xs font-semibold flex items-center gap-1.5 cursor-pointer" data-testid="edoc-upload-label">
            <Upload className="w-4 h-4" /> XML / PDF Yükle
            <input type="file" accept=".xml,.pdf" className="hidden" onChange={(e) => upload(e.target.files?.[0])} data-testid="edoc-upload-input" />
          </label>
        </div>
      </div>

      {pullNote && (
        <div className={`rounded-2xl border p-3 text-xs ${pullNote.failed?.length ? "border-amber-200 bg-amber-50 text-amber-900" : "border-emerald-200 bg-emerald-50 text-emerald-900"}`} data-testid="edoc-pull-note">
          <div className="flex items-start gap-2">
            <div className="flex-1">
              <b>{pullNote.message}</b>
              <div className="text-[10px] opacity-80">
                n11 Faturam {pullNote.found ?? pullNote.listed ?? "—"} belge listeledi · {pullNote.pulled ?? pullNote.imported ?? 0} yeni · {pullNote.already ?? pullNote.skipped ?? 0} zaten kayıtlı · {pullNote.failed?.length || 0} alınamadı
              </div>
              {!!pullNote.failed?.length && (
                <ul className="mt-2 space-y-0.5 max-h-32 overflow-y-auto" data-testid="edoc-pull-failed">
                  {pullNote.failed.slice(0, 20).map((f, i) => (
                    <li key={i}><span className="font-mono">{f.invoice || f.number}</span> — {f.reason}</li>
                  ))}
                  {pullNote.failed.length > 20 && <li className="opacity-70">…ve {pullNote.failed.length - 20} belge daha.</li>}
                </ul>
              )}
            </div>
            <button type="button" onClick={() => setPullNote(null)} className="p-1 rounded hover:bg-black/5" title="Kapat" data-testid="edoc-pull-note-close"><X className="w-3.5 h-3.5" /></button>
          </div>
        </div>
      )}

      {data?.blank > 0 && (
        <div className="rounded-2xl border border-rose-200 bg-rose-50 p-3 text-xs text-rose-900 flex flex-wrap items-center gap-3" data-testid="edoc-blank-warning">
          <AlertTriangle className="w-4 h-4 shrink-0" />
          <div className="flex-1 min-w-[220px]">
            <b>{data.blank} belge okunamamış.</b> Tedarikçisi, kalemi ve tutarı boş; bu haliyle içeri alınamazlar. Saklanan ham XML varsa yeniden okuyun, yoksa silip entegratörden tekrar çekin.
          </div>
          <button type="button" onClick={reparse} disabled={busy === "act"} className="px-3 py-1.5 rounded-lg border border-rose-300 bg-white font-semibold inline-flex items-center gap-1 disabled:opacity-60" data-testid="edoc-reparse">
            <RefreshCw className="w-3.5 h-3.5" /> Ham XML&apos;den yeniden oku
          </button>
          <button type="button" onClick={cleanup} disabled={busy === "act"} className="px-3 py-1.5 rounded-lg bg-rose-600 text-white font-semibold inline-flex items-center gap-1 disabled:opacity-60" data-testid="edoc-cleanup">
            <Trash2 className="w-3.5 h-3.5" /> Boş kayıtları sil
          </button>
        </div>
      )}

      <div className="flex gap-2 text-xs">
        {[["pending", "Bekleyen"], ["approved", "İçeri alınan"], ["rejected", "Reddedilen"], ["", "Tümü"]].map(([k, l]) => (
          <button key={k || "all"} type="button" onClick={() => setStatus(k)} className={`px-3 py-1.5 rounded-lg border font-semibold ${status === k ? "bg-slate-900 text-white border-slate-900" : "bg-white border-slate-200 text-slate-600"}`} data-testid={`edoc-filter-${k || "all"}`}>
            {l}{k && data ? ` (${data.counts?.[k] ?? 0})` : ""}
          </button>
        ))}
      </div>

      <div className="grid grid-cols-1 xl:grid-cols-[380px_1fr] gap-3 text-xs">
        <div className="bg-white border border-slate-200 rounded-2xl divide-y max-h-[70vh] overflow-y-auto" data-testid="edoc-list">
          {!data ? (
            <div className="p-6 text-slate-400">Yükleniyor…</div>
          ) : data.items.length === 0 ? (
            <div className="p-8 text-center text-slate-400" data-testid="edoc-empty">Belge yok. n11 Faturam&apos;dan çekin veya UBL XML / PDF yükleyin.</div>
          ) : data.items.map((d) => (
            <div key={d.id} className={`flex items-stretch ${sel?.id === d.id ? "bg-indigo-50/60" : "hover:bg-slate-50"}`}>
              <button type="button" onClick={() => { setSel(d); setXml(null); }} className="flex-1 text-left p-3" data-testid={`edoc-item-${d.id}`}>
                <div className="flex items-center justify-between gap-2">
                  <b className="text-slate-900 truncate max-w-[180px]">{d.supplier?.name || "Tedarikçi ?"}</b>
                  <span className={`px-1.5 py-0.5 rounded text-[10px] font-semibold shrink-0 ${STATUS[d.status]?.[1]}`}>{STATUS[d.status]?.[0]}</span>
                </div>
                <div className="text-[10px] text-slate-500">
                  {d.kind === "dispatch" ? "e-İrsaliye" : "e-Fatura"} · {d.number || "-"} · {d.issue_date} · <b>{fmt(d.grand_total)} ₺</b>
                  {" · "}{d.matched_lines ?? 0}/{(d.lines || []).length} satır{d.contact_id ? "" : " · tedarikçi yok"}
                </div>
              </button>
              {isProcessable(d) && (
                <button type="button" title="İçeri Al" onClick={() => processOne(d.id)} disabled={busy === "act"} className="px-2 m-2 self-center rounded-lg bg-emerald-600 text-white hover:bg-emerald-700 disabled:opacity-50" data-testid={`edoc-quick-process-${d.id}`}>
                  <Download className="w-3.5 h-3.5" />
                </button>
              )}
            </div>
          ))}
        </div>

        <div className="bg-white border border-slate-200 rounded-2xl p-4 space-y-3" data-testid="edoc-detail">
          {!sel ? (
            <div className="text-slate-400 p-6 text-center">Detay için soldan belge seçin.</div>
          ) : (
            <>
              <div className="flex flex-wrap items-start justify-between gap-2">
                <div>
                  <div className="text-sm font-bold text-slate-900">{sel.kind === "dispatch" ? "Gelen e-İrsaliye" : "Gelen e-Fatura"} {sel.number}</div>
                  <div className="text-slate-500">{sel.issue_date} · {sel.source === "ubl_xml" ? "UBL XML" : sel.source === "n11faturam" ? "n11 Faturam" : "PDF (AI)"} · {sel.profile || ""} {sel.type_code || ""}</div>
                </div>
                <div className="text-right">
                  <div className="text-lg font-bold text-slate-900">{fmt(sel.grand_total)} ₺</div>
                  <div className="text-[10px] text-slate-500">Matrah {fmt(sel.subtotal)} · KDV {fmt(sel.vat_total)}</div>
                  {sel.source !== "ai_pdf" && (
                    <button type="button" onClick={showXml} className="mt-1 text-[10px] text-indigo-600 font-semibold inline-flex items-center gap-1" data-testid="edoc-show-xml">
                      <FileCode2 className="w-3 h-3" /> Ham XML
                    </button>
                  )}
                </div>
              </div>

              {xml !== null && (
                <div className="rounded-xl border border-slate-200 bg-slate-900 text-slate-100 p-3" data-testid="edoc-xml-view">
                  <div className="flex items-center justify-between mb-2">
                    <b className="text-[10px] uppercase tracking-wide text-slate-400">Entegratörden gelen ham UBL</b>
                    <button type="button" onClick={() => setXml(null)} className="text-slate-400 hover:text-white" data-testid="edoc-xml-close"><X className="w-3.5 h-3.5" /></button>
                  </div>
                  <pre className="text-[10px] leading-relaxed overflow-auto max-h-64 whitespace-pre-wrap break-all">{xml}</pre>
                </div>
              )}

              <div className="bg-slate-50 rounded-xl p-3 flex flex-wrap items-center gap-2" data-testid="edoc-supplier">
                <div className="flex-1 min-w-[200px]">
                  <b className={sel.supplier?.name ? "" : "text-rose-600"}>{sel.supplier?.name || "Tedarikçi okunamadı"}</b>
                  <div className="text-[10px] text-slate-500">VKN {sel.supplier?.tax_id || "-"} · {sel.supplier?.tax_office || ""} · {sel.supplier?.address || ""}</div>
                </div>
                {sel.contact_id ? (
                  <span className="text-emerald-700 font-semibold flex items-center gap-1" data-testid="edoc-supplier-linked">
                    <Link2 className="w-3 h-3" /> {sel.contact_name}
                  </span>
                ) : sel.status === "pending" ? (
                  <>
                    <div className="w-56">
                      <SearchSelect
                        value=""
                        options={contacts}
                        getLabel={(c) => c.name}
                        getSub={(c) => c.tax_number_or_id || c.tax_id || ""}
                        placeholder="Mevcut cari seç…"
                        onChange={(id) => act(() => axios.put(`${API_URL}/edocs/inbox/${sel.id}/supplier`, { contact_id: id }), "Tedarikçi eşleştirildi.")}
                        testId="edoc-supplier-select"
                      />
                    </div>
                    <button type="button" onClick={() => act(() => axios.post(`${API_URL}/edocs/inbox/${sel.id}/create-supplier`, {}))} className="px-3 py-1.5 bg-slate-900 text-white rounded-lg font-semibold flex items-center gap-1" data-testid="edoc-create-supplier">
                      <UserPlus className="w-3.5 h-3.5" /> Yeni Tedarikçi Ekle
                    </button>
                  </>
                ) : null}
              </div>

              <table className="w-full">
                <thead className="bg-slate-50 text-[10px] uppercase text-slate-500">
                  <tr>
                    <th className="px-2 py-1.5 text-left">Kalem (tedarikçi)</th>
                    <th className="px-2 py-1.5 text-right">Miktar</th>
                    <th className="px-2 py-1.5 text-right">Birim Fiyat</th>
                    <th className="px-2 py-1.5 text-right">Tutar</th>
                    <th className="px-2 py-1.5 text-left w-72">Stok Kartı</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100">
                  {(sel.lines || []).map((l, i) => (
                    <tr key={i} data-testid={`edoc-line-${i}`}>
                      <td className="px-2 py-1.5">
                        <div className="font-semibold text-slate-800">{l.name}</div>
                        <div className="text-[10px] text-slate-400 font-mono">{l.sku}{l.barcode ? ` · ${l.barcode}` : ""}</div>
                      </td>
                      <td className="px-2 py-1.5 text-right">{l.quantity}</td>
                      <td className="px-2 py-1.5 text-right">{fmt(l.unit_price)}</td>
                      <td className="px-2 py-1.5 text-right font-semibold">{fmt(l.total)}</td>
                      <td className="px-2 py-1.5">
                        {sel.status !== "pending" ? (
                          <span className={l.product_id ? "text-emerald-700" : "text-slate-400"}>{l.product_name || "—"}</span>
                        ) : (
                          <div className="flex items-center gap-1">
                            <div className="flex-1">
                              <SearchSelect
                                value={l.product_id || ""}
                                options={products}
                                getLabel={(p) => p.name}
                                getSub={(p) => `${p.sku || ""} · stok ${p.stock_quantity ?? "-"}`}
                                placeholder={l.product_id ? l.product_name : "Stok kartı seç…"}
                                onChange={(id) => setLine(i, id)}
                                testId={`edoc-line-select-${i}`}
                              />
                            </div>
                            {!l.product_id && (
                              <button
                                type="button"
                                onClick={() => act(() => axios.post(`${API_URL}/edocs/inbox/${sel.id}/create-product`, { idx: i }).then((r) => {
                                  setSel(r.data);
                                  return { data: { message: "Stok kartı oluşturuldu ve eşleştirildi." } };
                                }))}
                                className="p-1.5 bg-emerald-600 text-white rounded-lg"
                                title="Bu kalemden stok kartı aç"
                                data-testid={`edoc-line-create-${i}`}
                              >
                                <PackagePlus className="w-3.5 h-3.5" />
                              </button>
                            )}
                            {l.auto_matched && <span className="text-[9px] text-emerald-600">oto</span>}
                          </div>
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>

              {sel.status === "pending" ? (
                <div className="flex flex-wrap items-center gap-3 pt-2 border-t">
                  <label className="flex items-center gap-1">
                    <input type="checkbox" checked={opts.update_stock} onChange={(e) => setOpts({ ...opts, update_stock: e.target.checked })} data-testid="edoc-opt-stock" /> Stok girişi yap
                  </label>
                  <label className="flex items-center gap-1">
                    <input type="checkbox" checked={opts.update_cost} onChange={(e) => setOpts({ ...opts, update_cost: e.target.checked })} /> Alış fiyatını güncelle
                  </label>
                  <label className="flex items-center gap-1">
                    <input type="checkbox" checked={opts.allow_unmatched} onChange={(e) => setOpts({ ...opts, allow_unmatched: e.target.checked })} data-testid="edoc-opt-unmatched" /> Eşleşmeyenleri hizmet kalemi olarak al
                  </label>
                  <div className="ml-auto flex flex-wrap gap-2">
                    <button
                      type="button"
                      onClick={() => { const reason = window.prompt("Ret nedeni:"); if (reason !== null) act(() => axios.post(`${API_URL}/edocs/inbox/${sel.id}/reject`, { reason })); }}
                      disabled={busy === "act"}
                      className="px-4 py-2 border border-rose-200 text-rose-600 rounded-lg font-semibold flex items-center gap-1"
                      data-testid="edoc-reject"
                    >
                      <XCircle className="w-4 h-4" /> Reddet
                    </button>
                    <button
                      type="button"
                      onClick={() => act(() => axios.post(`${API_URL}/edocs/inbox/${sel.id}/approve`, opts))}
                      disabled={busy === "act"}
                      className="px-4 py-2 border border-emerald-300 text-emerald-800 rounded-lg font-semibold flex items-center gap-1 disabled:opacity-50"
                      data-testid="edoc-approve"
                      title="Tedarikçi ve satır eşleşmesi gerekir"
                    >
                      <CheckCircle2 className="w-4 h-4" /> Gelişmiş onay
                    </button>
                    <button
                      type="button"
                      onClick={() => processOne(sel.id)}
                      disabled={busy === "act" || !isProcessable(sel)}
                      className="px-5 py-2 bg-emerald-600 text-white rounded-lg font-semibold flex items-center gap-1 disabled:opacity-50"
                      data-testid="edoc-process"
                    >
                      {busy === "act" ? <Loader2 className="w-4 h-4 animate-spin" /> : <Download className="w-4 h-4" />}
                      İçeri Al → {sel.kind === "dispatch" ? "İrsaliye" : "Alış Faturası"}
                    </button>
                  </div>
                </div>
              ) : (
                <div className={`rounded-xl p-3 ${STATUS[sel.status]?.[1]}`} data-testid="edoc-status-note">
                  {STATUS[sel.status]?.[0]}
                  {sel.reject_reason ? ` — ${sel.reject_reason}` : ""}
                  {sel.invoice_id ? ` — fatura oluşturuldu, ${sel.stock_moves ?? 0} kalemde stok girişi` : ""}
                </div>
              )}
            </>
          )}
        </div>
      </div>
    </div>
  );
}
