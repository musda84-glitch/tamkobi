import React, { useCallback, useEffect, useMemo, useState } from "react";
import { Link, useSearchParams } from "react-router-dom";
import axios from "axios";
import { toast } from "sonner";
import {
  Inbox, Upload, CheckCircle2, XCircle, UserPlus, PackagePlus, Loader2, Link2,
  RefreshCw, AlertTriangle, FileCode2, Trash2, X, Download, FileText, Settings,
} from "lucide-react";
import { API_URL, useAuth } from "../context/AuthContext";
import { SearchSelect } from "../components/SearchSelect";
import { fmtDate, formatTrAmount } from "../utils/money";
import { uniqueInboxItems } from "../utils/edocInbox";

const fmt = (n) => formatTrAmount((Number(n) || 0));
const STATUS = {
  pending: ["Bekliyor", "bg-amber-50 text-amber-700"],
  approved: ["İçeri alındı", "bg-emerald-50 text-emerald-700"],
  rejected: ["Reddedildi", "bg-rose-50 text-rose-700"],
  ignored: ["Dikkate alınmadı", "bg-slate-100 text-slate-600"],
};

const PROVIDER_SHORT = {
  n11faturam: "n11 Faturam",
  isnet: "İşNet",
  isnet_portal: "İşNet Portal",
};

function providerLabel(code, name) {
  if (PROVIDER_SHORT[code]) return PROVIDER_SHORT[code];
  if (name) return name;
  return "Entegratör";
}

function sourceLabel(source, integratorLabel) {
  if (source === "ubl_xml") return "UBL XML";
  if (source === "ai_pdf") return "PDF (AI)";
  if (source === "n11faturam") return "n11 Faturam";
  if (source === "isnet" || source === "isnet_portal") return PROVIDER_SHORT[source] || "İşNet";
  return integratorLabel || source || "Belge";
}

function isProcessable(doc) {
  if (!doc || doc.status !== "pending") return false;
  const blank = !(doc.lines || []).length && !doc.supplier?.name && !doc.supplier?.tax_id && !Number(doc.grand_total);
  return !blank;
}

export default function EdocInboxPage() {
  const { activeCompany } = useAuth();
  const [searchParams, setSearchParams] = useSearchParams();
  const kindFilter = String(searchParams.get("kind") || "all").toLowerCase();
  const companyId = activeCompany?.id || activeCompany?._id || "comp_nexus_main_01";
  const [data, setData] = useState(null);
  const [status, setStatus] = useState("pending");
  const [sel, setSel] = useState(null);
  const [contacts, setContacts] = useState([]);
  const [products, setProducts] = useState([]);
  const [busy, setBusy] = useState("");
  const [opts, setOpts] = useState({
    update_stock: true,
    update_cost: true,
    allow_unmatched: true,
    auto_create_products: true,
  });
  const [pullNote, setPullNote] = useState(null);
  const [xml, setXml] = useState(null);
  const [einvoice, setEinvoice] = useState(null);

  const integrator = providerLabel(einvoice?.provider, einvoice?.provider_name);

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
    axios.get(`${API_URL}/einvoice/settings`, { params: { company_id: companyId } })
      .then((r) => setEinvoice(r.data || null))
      .catch(() => setEinvoice(null));
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

  const pullInbox = () => act(() => axios.post(`${API_URL}/einvoice/incoming/sync`, null, {
    // Çekim yalnızca Bekleyen'e yazar; onay/stok eşleme olmadan içeri alma yok
    params: { company_id: companyId, days: 14, auto_process: false },
  }).then((r) => {
    setStatus("pending");
    setPullNote(r.data);
    return r;
  }), `${integrator} gelen kutusu çekildi.`);

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

  const downloadBlob = (blob, filename) => {
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = filename;
    a.click();
    URL.revokeObjectURL(url);
  };

  const downloadXmlFile = async () => {
    if (!sel?.id) return;
    setBusy("dl-xml");
    try {
      const r = await axios.get(`${API_URL}/edocs/inbox/${sel.id}/xml/download`, {
        params: { company_id: companyId },
        responseType: "blob",
      });
      downloadBlob(r.data, `${sel.number || sel.id}.xml`);
      toast.success("XML indirildi.");
    } catch (e) {
      let detail = "XML indirilemedi.";
      try {
        if (e.response?.data instanceof Blob) {
          const t = await e.response.data.text();
          detail = JSON.parse(t).detail || detail;
        } else if (e.response?.data?.detail) detail = e.response.data.detail;
      } catch { /* keep */ }
      toast.error(detail);
    } finally {
      setBusy("");
    }
  };

  const downloadPdfFile = async () => {
    if (!sel?.id) return;
    setBusy("dl-pdf");
    try {
      const r = await axios.get(`${API_URL}/edocs/inbox/${sel.id}/pdf`, {
        params: { company_id: companyId },
        responseType: "blob",
      });
      const ctype = String(r.headers["content-type"] || "");
      if (!ctype.includes("pdf") && !(r.data instanceof Blob && r.data.type === "application/pdf")) {
        const t = await r.data.text();
        let detail = "PDF alınamadı.";
        try { detail = JSON.parse(t).detail || detail; } catch { /* keep */ }
        throw new Error(detail);
      }
      downloadBlob(r.data, `${sel.number || sel.id}.pdf`);
      toast.success("PDF indirildi.");
    } catch (e) {
      let detail = e.message || "PDF indirilemedi.";
      try {
        if (e.response?.data instanceof Blob) {
          const t = await e.response.data.text();
          detail = JSON.parse(t).detail || detail;
        } else if (e.response?.data?.detail) detail = e.response.data.detail;
      } catch { /* keep */ }
      toast.error(detail);
    } finally {
      setBusy("");
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
    setStatus("approved");
    return r;
  }), "Belge içeri alındı.");

  const rejectOne = (docId) => {
    const reason = window.prompt("Ret nedeni (opsiyonel):", "");
    if (reason === null) return;
    act(() => axios.post(`${API_URL}/edocs/inbox/${docId}/reject`, { reason }).then((r) => {
      setSel((prev) => (prev?.id === docId ? null : prev));
      setStatus("rejected");
      return r;
    }), "Belge reddedildi.");
  };

  const ignoreOne = (docId) => {
    if (!window.confirm("Bu belge dikkate alınmasın mı? Alış faturası oluşturulmaz; bekleyenlerden çıkar.")) return;
    act(() => axios.post(`${API_URL}/edocs/inbox/${docId}/ignore`, { reason: "Dikkate alınmadı" }).then((r) => {
      setSel((prev) => (prev?.id === docId ? null : prev));
      setStatus("ignored");
      return r;
    }), "Belge dikkate alınmadı.");
  };

  const saveSupplier = () => act(() => axios.post(`${API_URL}/edocs/inbox/${sel.id}/create-supplier`, {}).then((r) => {
    load();
    return r;
  }), "Tedarikçi olarak kaydedildi.");

  const createMissingProducts = () => act(() => axios.post(`${API_URL}/edocs/inbox/${sel.id}/create-missing-products`, {}).then((r) => {
    setSel(r.data);
    axios.get(`${API_URL}/products`, { params: { company_id: companyId } })
      .then((pr) => setProducts(Array.isArray(pr.data) ? pr.data : pr.data?.items || []))
      .catch(() => {});
    return r;
  }), "Eşleşmeyen stok kartları oluşturuldu.");

  const processPending = () => {
    if (!window.confirm("Bekleyen okunabilir belgeler toplu içeri alınacak (tedarikçi yoksa oluşturulur; işaretliyse eksik stok kartları açılır). Devam?")) return;
    act(() => axios.post(`${API_URL}/edocs/inbox/process-pending`, opts, {
      params: { company_id: companyId },
    }).then((r) => {
      setStatus("approved");
      return r;
    }), "Toplu içeri alma tamamlandı.");
  };

  const setKindFilter = (kind) => {
    const next = new URLSearchParams(searchParams);
    if (!kind || kind === "all") next.delete("kind");
    else next.set("kind", kind);
    setSearchParams(next, { replace: true });
  };

  const filteredItems = useMemo(() => {
    const items = uniqueInboxItems(data?.items || []);
    if (kindFilter === "dispatch") return items.filter((d) => d.kind === "dispatch");
    if (kindFilter === "invoice") return items.filter((d) => d.kind !== "dispatch");
    return items;
  }, [data, kindFilter]);

  return (
    <div className="space-y-4" data-testid="edoc-inbox-page">
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
        <div>
          <h1 className="text-xl sm:text-2xl font-bold text-slate-900 flex items-center gap-2">
            <Inbox className="w-6 h-6 text-indigo-600" /> Gelen e-Belgeler
          </h1>
          <p className="text-xs text-slate-500">
            {integrator} gelen kutusu otomatik çekilir; XML/PDF belgeler <b>İçeri Al</b> ile alış faturasına dönüşür. Manuel çekim veya yükleme de aynı akışı kullanır.
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <Link
            to="/settings?tab=einvoice"
            className="px-4 py-2 border border-slate-200 rounded-xl text-xs font-semibold inline-flex items-center gap-1.5 bg-white text-slate-700 hover:bg-slate-50"
            data-testid="edoc-einvoice-settings-link"
          >
            <Settings className="w-4 h-4" /> E-Fatura bağlantısı
          </Link>
          <button type="button" onClick={pullInbox} disabled={busy === "act"} className="px-4 py-2 border rounded-xl text-xs font-semibold inline-flex items-center gap-1.5 disabled:opacity-60" data-testid="edoc-inbox-pull">
            <RefreshCw className={`w-4 h-4 ${busy === "act" ? "animate-spin" : ""}`} /> {integrator} gelen kutusu
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
                {integrator} {pullNote.found ?? pullNote.listed ?? "—"} belge listeledi · {pullNote.pulled ?? pullNote.imported ?? 0} yeni · {pullNote.already ?? pullNote.skipped ?? 0} zaten kayıtlı · {pullNote.failed?.length || 0} alınamadı
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

      <div className="flex flex-wrap gap-2 text-xs">
        {[["pending", "Bekleyen"], ["approved", "İçeri alınan"], ["rejected", "Reddedilen"], ["ignored", "Dikkate alınmayan"], ["", "Tümü"]].map(([k, l]) => (
          <button key={k || "all"} type="button" onClick={() => setStatus(k)} className={`px-3 py-1.5 rounded-lg border font-semibold ${status === k ? "bg-slate-900 text-white border-slate-900" : "bg-white border-slate-200 text-slate-600"}`} data-testid={`edoc-filter-${k || "all"}`}>
            {l}{k && data ? ` (${data.counts?.[k] ?? 0})` : ""}
          </button>
        ))}
      </div>

      <div className="flex flex-wrap gap-2 text-xs" data-testid="edoc-kind-filters">
        {[
          ["all", "Tüm belgeler"],
          ["invoice", "Gelen e-Fatura"],
          ["dispatch", "Gelen e-İrsaliye"],
        ].map(([k, l]) => (
          <button
            key={k}
            type="button"
            onClick={() => setKindFilter(k)}
            className={`px-3 py-1.5 rounded-lg border font-semibold ${kindFilter === k || (k === "all" && !["invoice", "dispatch"].includes(kindFilter)) ? "bg-indigo-700 text-white border-indigo-700" : "bg-white border-slate-200 text-slate-600"}`}
            data-testid={`edoc-kind-${k}`}
          >
            {l}
          </button>
        ))}
      </div>

      <div className="grid grid-cols-1 xl:grid-cols-[380px_1fr] gap-3 text-xs">
        <div className="bg-white border border-slate-200 rounded-2xl divide-y max-h-[70vh] overflow-y-auto" data-testid="edoc-list">
          {!data ? (
            <div className="p-6 text-slate-400">Yükleniyor…</div>
          ) : filteredItems.length === 0 ? (
            <div className="p-8 text-center text-slate-400" data-testid="edoc-empty">Belge yok. {integrator} üzerinden çekin veya UBL XML / PDF yükleyin.</div>
          ) : filteredItems.map((d) => (
            <div key={d.id} className={`flex items-stretch ${sel?.id === d.id ? "bg-indigo-50/60" : "hover:bg-slate-50"}`}>
              <button type="button" onClick={() => { setSel(d); setXml(null); }} className="flex-1 text-left p-3" data-testid={`edoc-item-${d.id}`}>
                <div className="flex items-center justify-between gap-2">
                  <b className="text-slate-900 truncate max-w-[180px]">{d.supplier?.name || "Tedarikçi ?"}</b>
                  <span className={`px-1.5 py-0.5 rounded text-[10px] font-semibold shrink-0 ${STATUS[d.status]?.[1]}`}>{STATUS[d.status]?.[0]}</span>
                </div>
                <div className="text-[10px] text-slate-500">
                  {d.kind === "dispatch" ? "e-İrsaliye" : "e-Fatura"} · {d.number || "-"} · {fmtDate(d.issue_date)} · <b>{fmt(d.grand_total)} ₺</b>
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
                  <div className="text-slate-500">{fmtDate(sel.issue_date)} · {sourceLabel(sel.source, integrator)} · {sel.profile || ""} {sel.type_code || ""}</div>
                </div>
                <div className="text-right space-y-1">
                  <div className="text-lg font-bold text-slate-900">{fmt(sel.grand_total)} ₺</div>
                  <div className="text-[10px] text-slate-500">Matrah {fmt(sel.subtotal)} · KDV {fmt(sel.vat_total)}</div>
                  {sel.source !== "ai_pdf" && (
                    <div className="flex flex-wrap justify-end gap-1.5 pt-1" data-testid="edoc-download-actions">
                      <button
                        type="button"
                        onClick={downloadPdfFile}
                        disabled={busy === "dl-pdf" || busy === "dl-xml"}
                        className="inline-flex items-center gap-1 px-2.5 py-1 rounded-lg bg-indigo-600 text-white text-[10px] font-semibold hover:bg-indigo-700 disabled:opacity-50"
                        data-testid="edoc-download-pdf"
                      >
                        {busy === "dl-pdf" ? <Loader2 className="w-3 h-3 animate-spin" /> : <FileText className="w-3 h-3" />}
                        PDF İndir
                      </button>
                      <button
                        type="button"
                        onClick={downloadXmlFile}
                        disabled={busy === "dl-pdf" || busy === "dl-xml"}
                        className="inline-flex items-center gap-1 px-2.5 py-1 rounded-lg border border-indigo-200 text-indigo-700 text-[10px] font-semibold hover:bg-indigo-50 disabled:opacity-50"
                        data-testid="edoc-download-xml"
                      >
                        {busy === "dl-xml" ? <Loader2 className="w-3 h-3 animate-spin" /> : <Download className="w-3 h-3" />}
                        XML İndir
                      </button>
                      <button type="button" onClick={showXml} className="inline-flex items-center gap-1 px-2 py-1 text-[10px] text-slate-500 font-semibold hover:text-indigo-600" data-testid="edoc-show-xml">
                        <FileCode2 className="w-3 h-3" /> Ham XML
                      </button>
                    </div>
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
                    <button type="button" onClick={saveSupplier} className="px-3 py-1.5 bg-slate-900 text-white rounded-lg font-semibold flex items-center gap-1" data-testid="edoc-create-supplier">
                      <UserPlus className="w-3.5 h-3.5" /> Tedarikçi olarak kaydet
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
                                valueLabel={l.product_name || ""}
                                placeholder="Stok kartı seç…"
                                clearable
                                clearLabel="Eşleştirmeyi kaldır"
                                onChange={(id) => setLine(i, id || null)}
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

              {sel.status === "pending" && (sel.lines || []).some((l) => !l.product_id) && (
                <div className="flex flex-wrap items-center gap-2 rounded-xl border border-amber-200 bg-amber-50 px-3 py-2" data-testid="edoc-stock-match-bar">
                  <PackagePlus className="w-4 h-4 text-amber-700 shrink-0" />
                  <span className="text-[11px] text-amber-900 flex-1">
                    {(sel.lines || []).filter((l) => !l.product_id).length} satır stok kartıyla eşleşmedi. Satırdan seçin veya kart oluşturun.
                  </span>
                  <button
                    type="button"
                    onClick={createMissingProducts}
                    disabled={busy === "act"}
                    className="px-3 py-1.5 bg-amber-700 text-white rounded-lg text-[11px] font-semibold inline-flex items-center gap-1 disabled:opacity-50"
                    data-testid="edoc-create-missing-products"
                  >
                    <PackagePlus className="w-3.5 h-3.5" /> Eşleşmeyenlere stok kartı oluştur
                  </button>
                </div>
              )}

              {sel.status === "pending" ? (
                <div className="flex flex-wrap items-center gap-3 pt-2 border-t">
                  <label className="flex items-center gap-1" title="İçeri alırken eşleşmeyen satırlar için stok kartı açılır">
                    <input
                      type="checkbox"
                      checked={opts.auto_create_products}
                      onChange={(e) => setOpts({ ...opts, auto_create_products: e.target.checked, allow_unmatched: e.target.checked ? false : opts.allow_unmatched })}
                      data-testid="edoc-opt-auto-products"
                    />
                    Stok kartı olmayanları otomatik kaydet
                  </label>
                  <label className="flex items-center gap-1">
                    <input type="checkbox" checked={opts.update_stock} onChange={(e) => setOpts({ ...opts, update_stock: e.target.checked })} data-testid="edoc-opt-stock" /> Stok girişi yap
                  </label>
                  <label className="flex items-center gap-1">
                    <input type="checkbox" checked={opts.update_cost} onChange={(e) => setOpts({ ...opts, update_cost: e.target.checked })} /> Alış fiyatını güncelle
                  </label>
                  {!opts.auto_create_products && (
                    <label className="flex items-center gap-1">
                      <input type="checkbox" checked={opts.allow_unmatched} onChange={(e) => setOpts({ ...opts, allow_unmatched: e.target.checked })} data-testid="edoc-opt-unmatched" /> Eşleşmeyenleri hizmet kalemi olarak al
                    </label>
                  )}
                  <div className="ml-auto flex flex-wrap gap-2">
                    <button
                      type="button"
                      onClick={() => ignoreOne(sel.id)}
                      disabled={busy === "act"}
                      className="px-4 py-2 border border-slate-300 text-slate-700 rounded-lg font-semibold flex items-center gap-1 disabled:opacity-50"
                      data-testid="edoc-ignore"
                      title="Alış faturası oluşturmadan bekleyenlerden çıkar"
                    >
                      Dikkate alma
                    </button>
                    <button
                      type="button"
                      onClick={() => rejectOne(sel.id)}
                      disabled={busy === "act"}
                      className="px-4 py-2 border border-rose-200 text-rose-600 rounded-lg font-semibold flex items-center gap-1 disabled:opacity-50"
                      data-testid="edoc-reject"
                    >
                      <XCircle className="w-4 h-4" /> Reddet
                    </button>
                    <button
                      type="button"
                      onClick={() => processOne(sel.id)}
                      disabled={busy === "act" || !isProcessable(sel)}
                      className="px-5 py-2 bg-emerald-600 text-white rounded-lg font-semibold flex items-center gap-1 disabled:opacity-50"
                      data-testid="edoc-process"
                      title="Onayla ve alış faturasına içeri al"
                    >
                      {busy === "act" ? <Loader2 className="w-4 h-4 animate-spin" /> : <CheckCircle2 className="w-4 h-4" />}
                      Onayla / İçeri Al
                    </button>
                  </div>
                </div>
              ) : (
                <div className={`rounded-xl p-3 ${STATUS[sel.status]?.[1]}`} data-testid="edoc-status-note">
                  {STATUS[sel.status]?.[0]}
                  {sel.reject_reason ? ` — ${sel.reject_reason}` : ""}
                  {sel.ignore_reason && sel.status === "ignored" ? ` — ${sel.ignore_reason}` : ""}
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
