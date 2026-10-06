import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import axios from "axios";
import { toast } from "sonner";
import { FileCode2, Download, Loader2, Plus, Save, Trash2, Upload } from "lucide-react";
import { API_URL } from "../../context/AuthContext";
import { inputCls } from "./saasUi";
import { EinvoiceDesignCanvas } from "./EinvoiceDesignCanvas";
import { defaultLayout, layoutToXslt, normalizeLayout } from "../../utils/einvoiceDesignLayout";

const cred = { withCredentials: true };

const emptyForm = (kind = "e_invoice") => ({ name: "", xslt: "", layout: defaultLayout(kind) });

const downloadBlob = (blob, filename) => {
  const a = document.createElement("a");
  a.href = URL.createObjectURL(blob);
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(a.href), 2000);
};

const fromApi = (data, kind) => ({
  name: data?.name || "",
  xslt: data?.xslt || "",
  layout: normalizeLayout(data?.layout, data?.kind || kind),
});

export const EinvoiceDesignsPanel = () => {
  const [d, setD] = useState(null);
  const [kind, setKind] = useState("e_invoice");
  const [openId, setOpenId] = useState("");
  const [form, setForm] = useState(() => emptyForm());
  const [tab, setTab] = useState("visual");
  const [source, setSource] = useState("visual");
  const [busy, setBusy] = useState("");
  const fileRef = useRef(null);

  const load = useCallback(async () => {
    const r = await axios.get(`${API_URL}/system/einvoice-designs`, cred);
    setD(r.data);
    return r.data;
  }, []);

  useEffect(() => {
    load().catch((e) => toast.error(e.response?.data?.detail || "Tasarımlar yüklenemedi."));
  }, [load]);

  const items = useMemo(() => (d?.items || []).filter((i) => i.kind === kind), [d, kind]);
  const openRow = items.find((i) => i.id === openId);

  const openDesign = async (id) => {
    setBusy(`open-${id}`);
    try {
      const r = await axios.get(`${API_URL}/system/einvoice-designs/${id}`, cred);
      setOpenId(id);
      setForm(fromApi(r.data, kind));
      setTab("visual");
      setSource(r.data?.layout ? "visual" : "xslt");
    } catch (e) {
      toast.error(e.response?.data?.detail || "Tasarım açılamadı.");
    } finally {
      setBusy("");
    }
  };

  const save = async () => {
    if (!openId) return;
    setBusy("save");
    try {
      const layout = normalizeLayout(form.layout, kind);
      const xslt = source === "xslt" ? form.xslt : layoutToXslt(layout, kind);
      const r = await axios.put(`${API_URL}/system/einvoice-designs/${openId}`, { name: form.name, xslt, layout }, cred);
      setForm(fromApi(r.data, kind));
      await load();
      toast.success("Tasarım kaydedildi.");
    } catch (e) {
      toast.error(e.response?.data?.detail || "Kaydedilemedi.");
    } finally {
      setBusy("");
    }
  };

  const selectIt = async (id) => {
    setBusy(`sel-${id}`);
    try {
      const r = await axios.post(`${API_URL}/system/einvoice-designs/${id}/select`, {}, cred);
      setD((prev) => ({ ...prev, items: r.data.items, selected: { ...(prev?.selected || {}), [kind]: id } }));
      toast.success("Bu tasarım seçildi.");
    } catch (e) {
      toast.error(e.response?.data?.detail || "Seçilemedi.");
    } finally {
      setBusy("");
    }
  };

  const duplicate = async (id) => {
    setBusy(`dup-${id}`);
    try {
      const r = await axios.post(`${API_URL}/system/einvoice-designs`, { copy_from_id: id }, cred);
      await load();
      setOpenId(r.data.id);
      setForm(fromApi(r.data, kind));
      setTab("visual");
      setSource(r.data?.layout ? "visual" : "xslt");
      toast.success("Tasarım kopyalandı — görsel düzenleyip kaydedin.");
    } catch (e) {
      toast.error(e.response?.data?.detail || "Kopyalanamadı.");
    } finally {
      setBusy("");
    }
  };

  const remove = async (id) => {
    if (!window.confirm("Bu tasarım silinsin mi?")) return;
    setBusy(`del-${id}`);
    try {
      const r = await axios.delete(`${API_URL}/system/einvoice-designs/${id}`, cred);
      setD((prev) => ({ ...prev, items: r.data.items }));
      if (openId === id) {
        setOpenId("");
        setForm(emptyForm(kind));
      }
      toast.success("Tasarım silindi.");
    } catch (e) {
      toast.error(e.response?.data?.detail || "Silinemedi.");
    } finally {
      setBusy("");
    }
  };

  const download = async (row) => {
    setBusy(`dl-${row.id}`);
    try {
      const r = await axios.get(`${API_URL}/system/einvoice-designs/${row.id}/download`, { ...cred, responseType: "blob" });
      const name = `${(row.name || row.kind || "tasarim").replace(/\s+/g, "_")}.xslt`;
      downloadBlob(r.data, name);
    } catch (e) {
      toast.error(e.response?.data?.detail || "İndirilemedi.");
    } finally {
      setBusy("");
    }
  };

  const onUpload = async (e) => {
    const file = e.target.files?.[0];
    e.target.value = "";
    if (!file) return;
    setBusy("upload");
    try {
      const text = await file.text();
      const r = await axios.post(`${API_URL}/system/einvoice-designs`, {
        kind,
        name: file.name.replace(/\.xslt?$/i, "") || `Yüklenen ${kind}`,
        xslt: text,
      }, cred);
      await load();
      setOpenId(r.data.id);
      setForm(fromApi(r.data, kind));
      setTab("xslt");
      setSource("xslt");
      toast.success("XSLT yüklendi.");
    } catch (err) {
      toast.error(err.response?.data?.detail || "Yüklenemedi.");
    } finally {
      setBusy("");
    }
  };

  if (!d) return <div className="text-xs text-slate-400 p-4" data-testid="einvoice-designs-loading">Yükleniyor…</div>;

  return (
    <div className="space-y-4 text-xs" data-testid="einvoice-designs-panel">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h2 className="text-sm font-bold text-slate-900 flex items-center gap-1.5">
            <FileCode2 className="w-4 h-4 text-slate-400" /> e-Fatura / e-Arşiv tasarımları
          </h2>
          <p className="text-[11px] text-slate-500 mt-0.5 max-w-2xl">
            Fatura görünümünü sürükle-bırak ile düzenleyin: logo, renk, yazı tipi ve bölüm sırası.
            Kaydedince XSLT üretilir. Ham XSLT sekmesi gelişmiş kullanım içindir.
            Varsayılan GİB şablonları yüklüdür — görsel kaydetmek onları bu düzene çevirir; orijinali korumak için kopyalayın.
          </p>
        </div>
        <div className="flex flex-wrap gap-2">
          <input ref={fileRef} type="file" accept=".xslt,.xsl,text/xml" className="hidden" onChange={onUpload} data-testid="einvoice-design-upload-input" />
          <button type="button" onClick={() => fileRef.current?.click()} disabled={!!busy} className="px-3 py-1.5 border rounded-lg font-semibold inline-flex items-center gap-1.5 disabled:opacity-60" data-testid="einvoice-design-upload-btn">
            {busy === "upload" ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Upload className="w-3.5 h-3.5" />} XSLT yükle
          </button>
          <button type="button" onClick={() => duplicate(d.selected?.[kind] || items[0]?.id)} disabled={!!busy || !items[0]} className="px-3 py-1.5 bg-slate-900 text-white rounded-lg font-semibold inline-flex items-center gap-1.5 disabled:opacity-60" data-testid="einvoice-design-new-btn">
            {String(busy).startsWith("dup") ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Plus className="w-3.5 h-3.5" />} Yeni tasarım
          </button>
        </div>
      </div>

      <div className="flex gap-1 bg-slate-100 rounded-xl p-1 w-fit" data-testid="einvoice-design-kind-tabs">
        {(d.kinds || []).map((k) => (
          <button
            key={k.id}
            type="button"
            onClick={() => { setKind(k.id); setOpenId(""); setForm(emptyForm(k.id)); setTab("visual"); }}
            className={`px-3 py-1.5 rounded-lg font-semibold ${kind === k.id ? "bg-white shadow-sm text-slate-900" : "text-slate-500"}`}
            data-testid={`einvoice-design-kind-${k.id}`}
          >
            {k.label}
          </button>
        ))}
      </div>

      <div className="grid grid-cols-1 xl:grid-cols-12 gap-4">
        <ul className="xl:col-span-3 space-y-2" data-testid="einvoice-design-list">
          {items.map((row) => (
            <li key={row.id} className={`rounded-xl border p-3 space-y-2 ${openId === row.id ? "border-emerald-300 bg-emerald-50/40" : "border-slate-200 bg-white"}`} data-testid={`einvoice-design-row-${row.id}`}>
              <div className="flex items-start justify-between gap-2">
                <button type="button" onClick={() => openDesign(row.id)} className="text-left min-w-0">
                  <div className="font-bold text-slate-900 truncate">{row.name}</div>
                  <div className="text-[10px] text-slate-500">{Math.round((row.xslt_bytes || 0) / 1024)} KB{row.is_builtin ? " · varsayılan" : ""}{row.has_layout ? " · görsel" : ""}</div>
                </button>
                {row.is_selected ? (
                  <span className="text-[10px] font-bold text-emerald-700 bg-emerald-50 border border-emerald-200 rounded px-1.5 py-0.5" data-testid={`einvoice-design-selected-${row.id}`}>Seçili</span>
                ) : (
                  <button type="button" onClick={() => selectIt(row.id)} disabled={!!busy} className="text-[10px] font-semibold px-1.5 py-0.5 border rounded-lg" data-testid={`einvoice-design-select-${row.id}`}>Seç</button>
                )}
              </div>
              <div className="flex flex-wrap gap-1.5">
                <button type="button" onClick={() => openDesign(row.id)} className="px-2 py-1 border rounded-lg font-semibold" data-testid={`einvoice-design-edit-${row.id}`}>Düzenle</button>
                <button type="button" onClick={() => download(row)} disabled={!!busy} className="px-2 py-1 border rounded-lg font-semibold inline-flex items-center gap-1" data-testid={`einvoice-design-download-${row.id}`}>
                  <Download className="w-3 h-3" /> İndir
                </button>
                <button type="button" onClick={() => duplicate(row.id)} disabled={!!busy} className="px-2 py-1 border rounded-lg font-semibold" data-testid={`einvoice-design-copy-${row.id}`}>Kopyala</button>
                {!row.is_builtin && !row.is_selected ? (
                  <button type="button" onClick={() => remove(row.id)} disabled={!!busy} className="px-2 py-1 border border-rose-200 text-rose-700 rounded-lg font-semibold inline-flex items-center gap-1" data-testid={`einvoice-design-delete-${row.id}`}>
                    <Trash2 className="w-3 h-3" /> Sil
                  </button>
                ) : null}
              </div>
            </li>
          ))}
        </ul>

        <div className="xl:col-span-9 bg-white border border-slate-200 rounded-2xl p-4 space-y-3 min-h-[24rem]" data-testid="einvoice-design-editor">
          {!openId ? (
            <p className="text-slate-500">Soldan bir tasarım seçin veya kopyalayın. Bölümleri sürükleyerek fatura görünümünü düzenleyin.</p>
          ) : (
            <>
              <div className="flex flex-wrap items-end gap-3">
                <div className="flex-1 min-w-[12rem]">
                  <label className="block font-semibold mb-1">Tasarım adı</label>
                  <input value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} className={inputCls} data-testid="einvoice-design-name" />
                </div>
                <div className="flex gap-1 bg-slate-100 rounded-xl p-1" data-testid="einvoice-design-editor-tabs">
                  <button type="button" onClick={() => setTab("visual")} className={`px-3 py-1.5 rounded-lg font-semibold ${tab === "visual" ? "bg-white shadow-sm" : "text-slate-500"}`} data-testid="einvoice-design-tab-visual">Görsel</button>
                  <button type="button" onClick={() => setTab("xslt")} className={`px-3 py-1.5 rounded-lg font-semibold ${tab === "xslt" ? "bg-white shadow-sm" : "text-slate-500"}`} data-testid="einvoice-design-tab-xslt">XSLT</button>
                </div>
              </div>
              {openRow?.is_builtin && tab === "visual" ? (
                <p className="text-[11px] text-amber-800 bg-amber-50 border border-amber-200 rounded-lg px-2.5 py-1.5" data-testid="einvoice-design-builtin-hint">
                  Varsayılan GİB şablonu. Görsel kaydetmek XSLT’yi bu düzene çevirir. Orijinali saklamak için önce kopyalayın.
                </p>
              ) : null}
              {tab === "visual" ? (
                <EinvoiceDesignCanvas
                  layout={form.layout}
                  kind={kind}
                  onChange={(layout) => { setForm((f) => ({ ...f, layout })); setSource("visual"); }}
                />
              ) : (
                <div>
                  <label className="block font-semibold mb-1">XSLT</label>
                  <textarea
                    value={form.xslt}
                    onChange={(e) => { setForm({ ...form, xslt: e.target.value }); setSource("xslt"); }}
                    spellCheck={false}
                    className={`${inputCls} font-mono text-[11px] min-h-[22rem] leading-snug`}
                    data-testid="einvoice-design-xslt"
                  />
                </div>
              )}
              <div className="flex justify-end gap-2">
                <button type="button" onClick={() => download({ id: openId, name: form.name, kind })} disabled={!!busy} className="px-3 py-1.5 border rounded-xl font-semibold inline-flex items-center gap-1.5" data-testid="einvoice-design-editor-download">
                  <Download className="w-3.5 h-3.5" /> İndir
                </button>
                <button type="button" onClick={save} disabled={!!busy} className="px-4 py-1.5 bg-emerald-600 text-white rounded-xl font-semibold inline-flex items-center gap-1.5 disabled:opacity-60" data-testid="einvoice-design-save">
                  {busy === "save" ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Save className="w-3.5 h-3.5" />} Kaydet
                </button>
              </div>
            </>
          )}
        </div>
      </div>
    </div>
  );
};
