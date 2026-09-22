
import React, { useCallback, useEffect, useMemo, useState } from "react";
import axios from "axios";
import { toast } from "sonner";
import { QRCodeSVG } from "qrcode.react";
import { Plus, Save, Trash2, Copy, Star, Printer, X, ArrowUp, ArrowDown, Type, Barcode as BarcodeIcon, QrCode, Image as ImageIcon, Minus, Square, Tag, Search } from "lucide-react";
import { API_URL } from "../context/AuthContext";
import { Barcode } from "./BarcodeLabelPrint";
import { resolveImageUrl } from "../utils/imageUrl";
import { useEscape } from "../utils/useEscape";
import { formatTrAmount, moneySuffix } from "../utils/money";

const PX = 3.78; // 1 mm ≈ 3.78 px @96dpi
const SIZES = [[100, 30], [100, 50], [50, 30], [60, 40], [100, 150]];
const BUILTIN_SIZES = [[40, 20], [50, 30], [60, 40], [100, 30], [100, 50]];
const FIELDS = [["name", "Ürün Adı"], ["price", "Fiyat"], ["sku", "SKU / Stok Kodu"], ["barcode_text", "Barkod No"], ["variant", "Varyant"], ["category", "Kategori"], ["company", "Firma Adı"], ["text", "Serbest Metin"]];
const ELEMENT_TYPES = [["barcode", "Barkod", BarcodeIcon], ["qr", "QR Kod", QrCode], ["field", "Metin Alanı", Type], ["logo", "Firma Logosu", ImageIcon], ["image", "Ürün Görseli", ImageIcon], ["line", "Çizgi", Minus], ["box", "Kutu", Square]];
const fmt = (n) => formatTrAmount((Number(n) || 0));
const uid = () => Math.random().toString(36).slice(2, 8);
const DEFAULT_TPL = (w = 100, h = 30) => {
  const compact = h <= 22;
  return {
    name: `Etiket ${w}×${h}`,
    width_mm: w,
    height_mm: h,
    page: { mode: "thermal", cols: 1, rows: 1, gap_mm: 2 },
    elements: compact ? [
      { id: uid(), type: "field", field: "name", x: 1.5, y: 0.6, w: w - 3, h: 4, font: 7, bold: true, align: "left" },
      { id: uid(), type: "barcode", x: 1.5, y: 5, w: Math.max(18, w - 18), h: h - 7.5, showText: true },
      { id: uid(), type: "field", field: "price", x: w - 15, y: 5, w: 13.5, h: 6, font: 9, bold: true, align: "right", vat: "incl" },
      { id: uid(), type: "field", field: "sku", x: w - 15, y: 11.5, w: 13.5, h: 4, font: 5, align: "right" },
    ] : [
      { id: uid(), type: "field", field: "name", x: 2, y: 1.5, w: w - 4, h: 7, font: 10, bold: true, align: "left" },
      { id: uid(), type: "barcode", x: 2, y: 9, w: Math.min(60, w - 4), h: h - 12, showText: true },
      { id: uid(), type: "field", field: "price", x: w - 36, y: 10, w: 34, h: 9, font: 16, bold: true, align: "right", vat: "incl" },
      { id: uid(), type: "field", field: "sku", x: w - 36, y: 20, w: 34, h: 5, font: 7, align: "right" },
    ],
  };
};

const builtinTemplates = () => BUILTIN_SIZES.map(([w, h]) => ({
  ...DEFAULT_TPL(w, h),
  id: `builtin-${w}x${h}`,
  name: `Hazır ${w}×${h} mm`,
  is_builtin: true,
}));

const cardPrintTargets = (product) => {
  if (!product) return [];
  const pid = product.id || product._id;
  const main = { ...product, id: pid, variant_name: "" };
  const variants = (product.variants || []).map((v) => ({
    ...product,
    id: v.variant_id || v.sku || `${pid}-${v.name}`,
    name: `${product.name} — ${v.name}`,
    sku: v.sku || product.sku,
    barcode: v.barcode || product.barcode,
    sale_price: v.sale_price ?? v.price ?? product.sale_price,
    image_url: v.image_url || product.image_url,
    variant_name: v.name,
    variants: undefined,
  }));
  return [main, ...variants];
};

const printLabelJobs = (tpl, jobs, page, sourceId) => {
  if (!jobs.length) { toast.error("Yazdırılacak etiket yok."); return; }
  const win = window.open("", "_blank", "width=900,height=700");
  if (!win) { toast.error("Yazdırma penceresi açılamadı — tarayıcı pop-up engelini kontrol edin."); return; }
  const isA4 = page.mode === "a4";
  const cols = isA4 ? Math.max(1, Number(page.cols) || 1) : 1;
  const gap = Number(page.gap_mm) || 0;
  const html = document.getElementById(sourceId)?.innerHTML || "";
  win.document.write(`<html><head><title>Etiketler</title><style>@page{size:${isA4 ? "A4" : `${tpl.width_mm}mm ${tpl.height_mm}mm`};margin:${isA4 ? "8mm" : "0"}}body{margin:0;font-family:Arial,sans-serif}.grid{display:grid;grid-template-columns:repeat(${cols},${tpl.width_mm}mm);gap:${gap}mm}.lbl{width:${tpl.width_mm}mm;height:${tpl.height_mm}mm;position:relative;overflow:hidden;${isA4 ? "" : "page-break-after:always;"}break-inside:avoid;background:#fff}svg{display:block}</style></head><body><div class="grid">${html}</div><script>setTimeout(()=>{window.print();},400)</script></body></html>`);
  win.document.close();
};

const valueOf = (el, p, company) => {
  if (!p) return el.field === "text" ? el.text || "Metin" : `{${el.field}}`;
  const vat = Number(p.vat_rate ?? 20);
  const base = Number(p.sale_price || 0);
  const price = el.vat === "excl" ? (p.price_includes_vat ? base / (1 + vat / 100) : base) : (p.price_includes_vat ? base : base * (1 + vat / 100));
  return { name: p.name, price: `${el.prefix || ""}${fmt(price)} ${el.currency || moneySuffix(p.currency)}${el.vat === "excl" ? " +KDV" : ""}`, sku: p.sku, barcode_text: p.barcode, variant: p.variant_name || (p.variants?.length ? `${p.variants.length} varyant` : ""), category: p.category, company: company?.name, text: el.text || "" }[el.field] ?? "";
};

const Element = ({ el, p, company, scale, selected, onSelect, onMove }) => {
  const st = { position: "absolute", left: el.x * PX * scale, top: el.y * PX * scale, width: el.w * PX * scale, height: el.h * PX * scale, transform: el.rotate ? `rotate(${el.rotate}deg)` : undefined, outline: selected ? "1.5px solid #6366f1" : undefined, cursor: "move", overflow: "hidden", boxSizing: "border-box" };
  const code = p ? (p.barcode || p.sku || "0000000000000") : "8680001234011";
  const down = (e) => { e.stopPropagation(); onSelect(el.id); const sx = e.clientX, sy = e.clientY, ox = el.x, oy = el.y; const mv = (ev) => onMove(el.id, ox + (ev.clientX - sx) / PX / scale, oy + (ev.clientY - sy) / PX / scale); const up = () => { window.removeEventListener("mousemove", mv); window.removeEventListener("mouseup", up); }; window.addEventListener("mousemove", mv); window.addEventListener("mouseup", up); };
  let body = null;
  if (el.type === "barcode") body = <div style={{ transform: `scale(${scale})`, transformOrigin: "top left", width: el.w * PX, height: el.h * PX, display: "flex", alignItems: "center", justifyContent: "center" }}><Barcode value={code} height={Math.max(10, el.h * PX - (el.showText === false ? 2 : 14))} width={Math.max(0.8, Math.min(3, (el.w * PX) / 110))} fontSize={el.showText === false ? 0 : 10} /></div>;
  else if (el.type === "qr") body = <QRCodeSVG value={code} size={Math.min(el.w, el.h) * PX * scale} level="M" />;
  else if (el.type === "logo") body = company?.logo_url ? <img src={resolveImageUrl(company.logo_url)} alt="" style={{ width: "100%", height: "100%", objectFit: "contain" }} /> : <div className="w-full h-full bg-slate-100 text-[8px] text-slate-400 flex items-center justify-center">LOGO</div>;
  else if (el.type === "image") body = p?.image_url ? <img src={resolveImageUrl(p.image_url)} alt="" style={{ width: "100%", height: "100%", objectFit: "cover" }} /> : <div className="w-full h-full bg-slate-100 text-[8px] text-slate-400 flex items-center justify-center">GÖRSEL</div>;
  else if (el.type === "line") body = <div style={{ width: "100%", height: "100%", background: "#000" }} />;
  else if (el.type === "box") body = <div style={{ width: "100%", height: "100%", border: `${(el.border || 0.3) * PX * scale}px solid #000`, borderRadius: (el.radius || 0) * PX * scale }} />;
  else body = <div style={{ fontSize: (el.font || 10) * scale * 1.33, fontWeight: el.bold ? 700 : 400, fontStyle: el.italic ? "italic" : undefined, textAlign: el.align || "left", lineHeight: 1.1, fontFamily: el.mono ? "monospace" : "Arial, sans-serif", width: "100%", height: "100%", display: "flex", alignItems: el.valign === "middle" ? "center" : "flex-start", justifyContent: el.align === "center" ? "center" : el.align === "right" ? "flex-end" : "flex-start", whiteSpace: el.wrap === false ? "nowrap" : "normal", wordBreak: "break-word" }}>{valueOf(el, p, company)}</div>;
  return <div style={st} onMouseDown={onSelect ? down : undefined} data-testid={`label-el-${el.id}`}>{body}</div>;
};

export const LabelCanvas = ({ tpl, product, company, scale = 1, selected, onSelect, onMove, className = "" }) => (
  <div className={`relative bg-white ${className}`} style={{ width: tpl.width_mm * PX * scale, height: tpl.height_mm * PX * scale, backgroundImage: onSelect ? `linear-gradient(to right, #eef2ff 1px, transparent 1px), linear-gradient(to bottom, #eef2ff 1px, transparent 1px)` : undefined, backgroundSize: `${PX * scale}px ${PX * scale}px`, border: onSelect ? "1px dashed #94a3b8" : "none" }} onMouseDown={() => onSelect && onSelect(null)} data-testid="label-canvas">
    {tpl.elements.map((el) => <Element key={el.id} el={el} p={product} company={company} scale={scale} selected={selected === el.id} onSelect={onSelect} onMove={onMove} />)}
  </div>
);

const PrintModal = ({ tpl, products, company, onClose, initialSel = {}, templates = [], onTplChange }) => {
  useEscape(onClose);
  const [q, setQ] = useState("");
  const [sel, setSel] = useState(initialSel);
  const [page, setPage] = useState(tpl.page || { mode: "thermal", cols: 1, rows: 1, gap_mm: 2 });
  const list = useMemo(() => products.filter((p) => !q || p.name?.toLowerCase().includes(q.toLowerCase()) || p.sku?.toLowerCase().includes(q.toLowerCase()) || p.barcode?.includes(q)).slice(0, 200), [products, q]);
  const jobs = useMemo(() => Object.entries(sel).flatMap(([id, n]) => { const p = products.find((x) => (x.id || x._id) === id); return p && n > 0 ? Array.from({ length: n }, () => p) : []; }), [sel, products]);
  const print = () => printLabelJobs(tpl, jobs, page, "label-print-source");
  return (
    <div className="fixed inset-0 z-[80] bg-slate-900/60 flex items-center justify-center p-4" onClick={onClose}>
      <div className="bg-white rounded-2xl w-full max-w-4xl max-h-[92vh] overflow-y-auto p-5 space-y-3 text-xs" onClick={(e) => e.stopPropagation()} data-testid="label-print-modal">
        <div className="flex items-center justify-between"><b className="text-sm flex items-center gap-2">Toplu Etiket Yazdır — {templates.length ? <select value={tpl.id || ""} onChange={(e) => onTplChange(templates.find((t) => t.id === e.target.value) || tpl)} className="border rounded-lg p-1 text-xs font-normal" data-testid="label-print-tpl">{templates.map((t) => <option key={t.id} value={t.id}>{t.is_default ? "★ " : ""}{t.name}</option>)}</select> : tpl.name} ({tpl.width_mm}×{tpl.height_mm} mm)</b><button onClick={onClose} className="p-1 hover:bg-slate-100 rounded-lg" data-testid="label-print-close"><X className="w-4 h-4" /></button></div>
        <div className="flex flex-wrap items-center gap-2">
          <label>Sayfa: <select value={page.mode} onChange={(e) => setPage({ ...page, mode: e.target.value })} className="border rounded-lg p-1.5" data-testid="label-page-mode"><option value="thermal">Termal rulo (etiket başına sayfa)</option><option value="a4">A4 etiket kağıdı</option></select></label>
          {page.mode === "a4" && <><label>Sütun <input type="number" min="1" max="8" value={page.cols} onChange={(e) => setPage({ ...page, cols: Number(e.target.value) })} className="w-14 border rounded-lg p-1.5" data-testid="label-page-cols" /></label><label>Boşluk mm <input type="number" min="0" step="0.5" value={page.gap_mm} onChange={(e) => setPage({ ...page, gap_mm: Number(e.target.value) })} className="w-16 border rounded-lg p-1.5" /></label></>}
          <span className="ml-auto font-semibold" data-testid="label-job-count">{jobs.length} etiket</span>
          <button onClick={print} disabled={!jobs.length} className="px-4 py-2 bg-slate-900 text-white rounded-lg font-semibold flex items-center gap-1 disabled:opacity-50" data-testid="label-print-btn"><Printer className="w-4 h-4" /> Yazdır</button>
        </div>
        <div className="relative"><Search className="w-3.5 h-3.5 absolute left-2.5 top-2.5 text-slate-400" /><input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Ürün ara (ad, SKU, barkod)…" className="pl-8 pr-3 py-2 bg-slate-50 border rounded-xl w-full" data-testid="label-product-search" /></div>
        <div className="border rounded-xl max-h-64 overflow-y-auto divide-y">{list.map((p) => { const id = p.id || p._id; return (
          <div key={id} className="flex items-center gap-3 px-3 py-1.5" data-testid={`label-prod-${p.sku || id}`}><div className="flex-1 min-w-0"><div className="font-semibold truncate">{p.name}</div><div className="text-[10px] text-slate-400 font-mono">{p.sku} · {p.barcode} · {fmt(p.sale_price)} {moneySuffix(p.currency)}</div></div>
            <input type="number" min="0" value={sel[id] || ""} onChange={(e) => setSel({ ...sel, [id]: Number(e.target.value) })} placeholder="adet" className="w-16 border rounded-lg p-1 text-right" data-testid={`label-qty-${p.sku || id}`} />
            <button onClick={() => setSel({ ...sel, [id]: Math.max(1, Math.round(Number(p.stock_quantity) || 1)) })} className="px-2 py-1 border rounded-lg text-[10px]" title="Stok adedi kadar">stok</button></div>); })}</div>
        <div className="flex flex-wrap gap-2 bg-slate-50 p-3 rounded-xl overflow-x-auto" data-testid="label-preview-strip">{jobs.slice(0, 6).map((p, i) => <div key={i} className="shadow border"><LabelCanvas tpl={tpl} product={p} company={company} scale={0.6} /></div>)}{jobs.length > 6 && <div className="self-center text-slate-400">+{jobs.length - 6} daha</div>}</div>
        <div id="label-print-source" className="hidden">{jobs.map((p, i) => <div key={i} className="lbl"><LabelCanvas tpl={tpl} product={p} company={company} scale={1} /></div>)}</div>
      </div>
    </div>
  );
};

const Prop = ({ label, children }) => <label className="flex items-center justify-between gap-2 py-0.5"><span className="text-slate-500">{label}</span>{children}</label>;
const num = "w-20 bg-slate-50 border rounded-lg p-1 text-right";

export const LabelDesigner = ({ companyId, products, company }) => {
  const [tpls, setTpls] = useState([]);
  const [tpl, setTpl] = useState(null);
  const [selId, setSelId] = useState(null);
  const [zoom, setZoom] = useState(2);
  const [previewId, setPreviewId] = useState("");
  const [printing, setPrinting] = useState(false);
  const [dirty, setDirty] = useState(false);
  const load = useCallback(() => axios.get(`${API_URL}/label-templates?company_id=${companyId}`).then((r) => { setTpls(r.data); if (!tpl) setTpl(r.data.find((t) => t.is_default) || r.data[0] || null); }).catch(() => toast.error("Şablonlar yüklenemedi.")), [companyId, tpl]);
  useEffect(() => { load(); }, [load]);
  const preview = products.find((p) => (p.id || p._id) === previewId) || products[0];
  const sel = tpl?.elements.find((e) => e.id === selId);
  const upd = (patch) => { setTpl({ ...tpl, ...patch }); setDirty(true); };
  const updEl = (id, patch) => upd({ elements: tpl.elements.map((e) => (e.id === id ? { ...e, ...patch } : e)) });
  const move = (id, x, y) => updEl(id, { x: Math.max(0, Math.round(x * 2) / 2), y: Math.max(0, Math.round(y * 2) / 2) });
  const addEl = (type) => { const base = { id: uid(), type, x: 2, y: 2, w: type === "line" ? 40 : 30, h: type === "line" ? 0.4 : type === "barcode" ? 14 : type === "field" ? 6 : 15 }; const el = type === "field" ? { ...base, field: "text", text: "Metin", font: 10, align: "left" } : type === "barcode" ? { ...base, showText: true } : base; upd({ elements: [...tpl.elements, el] }); setSelId(el.id); };
  const order = (dir) => { const i = tpl.elements.findIndex((e) => e.id === selId); const j = i + dir; if (i < 0 || j < 0 || j >= tpl.elements.length) return; const arr = [...tpl.elements]; [arr[i], arr[j]] = [arr[j], arr[i]]; upd({ elements: arr }); };
  const save = async () => { try { const body = { ...tpl, company_id: companyId }; const r = tpl.id ? await axios.put(`${API_URL}/label-templates/${tpl.id}`, body) : await axios.post(`${API_URL}/label-templates`, body); setTpl(r.data); setDirty(false); toast.success("Şablon kaydedildi."); load(); } catch (e) { toast.error(e.response?.data?.detail || "Kaydedilemedi."); } };
  const create = (w, h) => { setTpl(DEFAULT_TPL(w, h)); setSelId(null); setDirty(true); };
  const duplicate = () => { const { id, created_at, ...rest } = tpl; setTpl({ ...rest, name: `${tpl.name} (kopya)`, is_default: false, elements: tpl.elements.map((e) => ({ ...e, id: uid() })) }); setDirty(true); };
  const remove = async () => { if (!tpl.id) { setTpl(tpls[0] || null); return; } if (!window.confirm(`"${tpl.name}" şablonu silinsin mi?`)) return; await axios.delete(`${API_URL}/label-templates/${tpl.id}`); toast.success("Şablon silindi."); setTpl(null); setTpls([]); load(); };
  const makeDefault = async () => { const r = await axios.put(`${API_URL}/label-templates/${tpl.id}`, { is_default: true }); setTpl(r.data); toast.success("Varsayılan şablon yapıldı."); load(); };

  return (
    <div className="space-y-3" data-testid="label-designer">
      <div className="flex flex-wrap items-center gap-2 text-xs">
        <Tag className="w-4 h-4 text-emerald-600" /><b className="text-sm text-slate-900">Barkod Etiket Tasarımcısı</b>
        <select value={tpl?.id || ""} onChange={(e) => { setTpl(tpls.find((t) => t.id === e.target.value)); setSelId(null); setDirty(false); }} className="bg-white border rounded-lg p-1.5" data-testid="label-tpl-select"><option value="">{tpl && !tpl.id ? "(kaydedilmemiş yeni şablon)" : "Şablon seç…"}</option>{tpls.map((t) => <option key={t.id} value={t.id}>{t.is_default ? "★ " : ""}{t.name} ({t.width_mm}×{t.height_mm})</option>)}</select>
        <div className="flex items-center gap-1">{SIZES.map(([w, h]) => <button key={`${w}x${h}`} onClick={() => create(w, h)} className="px-2 py-1.5 border border-slate-200 bg-white rounded-lg font-semibold hover:bg-slate-50" data-testid={`label-new-${w}x${h}`}><Plus className="w-3 h-3 inline" /> {w}×{h}</button>)}<button onClick={() => create(80, 40)} className="px-2 py-1.5 border border-dashed border-slate-300 bg-white rounded-lg" data-testid="label-new-custom">Özel</button></div>
        {tpl && <div className="ml-auto flex items-center gap-1">
          <button onClick={save} className={`px-3 py-1.5 rounded-lg font-semibold text-white flex items-center gap-1 ${dirty ? "bg-emerald-600" : "bg-slate-400"}`} data-testid="label-save"><Save className="w-3.5 h-3.5" /> Kaydet{dirty ? " *" : ""}</button>
          {tpl.id && <button onClick={makeDefault} disabled={tpl.is_default} className="p-1.5 border rounded-lg disabled:opacity-40" title="Varsayılan yap" data-testid="label-default"><Star className="w-3.5 h-3.5" /></button>}
          <button onClick={duplicate} className="p-1.5 border rounded-lg" title="Kopyala" data-testid="label-copy"><Copy className="w-3.5 h-3.5" /></button>
          <button onClick={remove} className="p-1.5 border border-rose-200 text-rose-600 rounded-lg" title="Sil" data-testid="label-delete"><Trash2 className="w-3.5 h-3.5" /></button>
          <button onClick={() => setPrinting(true)} className="px-3 py-1.5 bg-slate-900 text-white rounded-lg font-semibold flex items-center gap-1" data-testid="label-print-open"><Printer className="w-3.5 h-3.5" /> Toplu Yazdır</button>
        </div>}
      </div>
      {!tpl ? <div className="bg-white border rounded-2xl p-10 text-center text-slate-400 text-xs" data-testid="label-empty">Henüz şablon yok — yukarıdan bir etiket boyutu seçerek başlayın.</div> : (
        <div className="grid grid-cols-1 xl:grid-cols-[180px_1fr_300px] gap-3 text-xs">
          <div className="bg-white border rounded-2xl p-3 space-y-1" data-testid="label-palette"><div className="font-bold text-slate-900 mb-1">Öğe Ekle</div>{ELEMENT_TYPES.map(([k, l, Icon]) => <button key={k} onClick={() => addEl(k)} className="w-full flex items-center gap-2 px-2 py-1.5 rounded-lg hover:bg-slate-50 border border-transparent hover:border-slate-200" data-testid={`label-add-${k}`}><Icon className="w-3.5 h-3.5 text-slate-500" /> {l}</button>)}
            <div className="font-bold text-slate-900 mt-3 mb-1">Katmanlar</div>{tpl.elements.map((e) => <button key={e.id} onClick={() => setSelId(e.id)} className={`w-full text-left px-2 py-1 rounded-lg truncate ${selId === e.id ? "bg-indigo-50 text-indigo-700 font-semibold" : "hover:bg-slate-50"}`} data-testid={`label-layer-${e.id}`}>{ELEMENT_TYPES.find((t) => t[0] === e.type)?.[1]}{e.type === "field" ? ` · ${FIELDS.find((f) => f[0] === e.field)?.[1]}` : ""}</button>)}</div>
          <div className="bg-slate-100 border rounded-2xl p-4 overflow-auto">
            <div className="flex flex-wrap items-center gap-2 mb-3"><input value={tpl.name} onChange={(e) => upd({ name: e.target.value })} className="bg-white border rounded-lg p-1.5 font-semibold w-48" data-testid="label-name" />
              <label>G <input type="number" step="1" value={tpl.width_mm} onChange={(e) => upd({ width_mm: Number(e.target.value) })} className={num} data-testid="label-width" /> mm</label><label>Y <input type="number" step="1" value={tpl.height_mm} onChange={(e) => upd({ height_mm: Number(e.target.value) })} className={num} data-testid="label-height" /> mm</label>
              <label>Yakınlaştır <input type="range" min="1" max="4" step="0.5" value={zoom} onChange={(e) => setZoom(Number(e.target.value))} data-testid="label-zoom" /></label>
              <select value={previewId} onChange={(e) => setPreviewId(e.target.value)} className="bg-white border rounded-lg p-1.5 ml-auto max-w-[220px]" data-testid="label-preview-product"><option value="">Önizleme ürünü…</option>{products.slice(0, 300).map((p) => <option key={p.id || p._id} value={p.id || p._id}>{p.name}</option>)}</select></div>
            <div className="inline-block shadow-lg"><LabelCanvas tpl={tpl} product={preview} company={company} scale={zoom} selected={selId} onSelect={setSelId} onMove={move} /></div>
            <div className="text-[10px] text-slate-400 mt-2">Öğeleri sürükleyin (0,5 mm ızgara). Gerçek boyut: {tpl.width_mm}×{tpl.height_mm} mm · ızgara 1 mm.</div>
          </div>
          <div className="bg-white border rounded-2xl p-3 space-y-1" data-testid="label-props">
            {!sel ? <div className="text-slate-400">Düzenlemek için tuvalde bir öğe seçin.</div> : (<>
              <div className="flex items-center justify-between mb-1"><b className="text-slate-900">{ELEMENT_TYPES.find((t) => t[0] === sel.type)?.[1]}</b><div className="flex gap-1"><button onClick={() => order(1)} className="p-1 border rounded" title="Öne al"><ArrowUp className="w-3 h-3" /></button><button onClick={() => order(-1)} className="p-1 border rounded" title="Arkaya al"><ArrowDown className="w-3 h-3" /></button><button onClick={() => { upd({ elements: tpl.elements.filter((e) => e.id !== sel.id) }); setSelId(null); }} className="p-1 border border-rose-200 text-rose-600 rounded" data-testid="label-el-delete"><Trash2 className="w-3 h-3" /></button></div></div>
              {sel.type === "field" && <><Prop label="Alan"><select value={sel.field} onChange={(e) => updEl(sel.id, { field: e.target.value })} className="bg-slate-50 border rounded-lg p-1 w-40" data-testid="label-prop-field">{FIELDS.map(([k, l]) => <option key={k} value={k}>{l}</option>)}</select></Prop>
                {sel.field === "text" && <Prop label="Metin"><input value={sel.text || ""} onChange={(e) => updEl(sel.id, { text: e.target.value })} className="bg-slate-50 border rounded-lg p-1 w-40" data-testid="label-prop-text" /></Prop>}
                {sel.field === "price" && <><Prop label="KDV"><select value={sel.vat || "incl"} onChange={(e) => updEl(sel.id, { vat: e.target.value })} className="bg-slate-50 border rounded-lg p-1 w-40" data-testid="label-prop-vat"><option value="incl">KDV dahil</option><option value="excl">KDV hariç (+KDV)</option></select></Prop><Prop label="Para birimi"><input value={sel.currency ?? "₺"} onChange={(e) => updEl(sel.id, { currency: e.target.value })} className="bg-slate-50 border rounded-lg p-1 w-16 text-center" /></Prop></>}
                <Prop label="Yazı boyutu (pt)"><input type="number" min="4" max="60" value={sel.font || 10} onChange={(e) => updEl(sel.id, { font: Number(e.target.value) })} className={num} data-testid="label-prop-font" /></Prop>
                <Prop label="Hizalama"><select value={sel.align || "left"} onChange={(e) => updEl(sel.id, { align: e.target.value })} className="bg-slate-50 border rounded-lg p-1 w-24"><option value="left">Sol</option><option value="center">Orta</option><option value="right">Sağ</option></select></Prop>
                <div className="flex gap-3 py-0.5"><label className="flex items-center gap-1"><input type="checkbox" checked={!!sel.bold} onChange={(e) => updEl(sel.id, { bold: e.target.checked })} data-testid="label-prop-bold" /> Kalın</label><label className="flex items-center gap-1"><input type="checkbox" checked={!!sel.italic} onChange={(e) => updEl(sel.id, { italic: e.target.checked })} /> İtalik</label><label className="flex items-center gap-1"><input type="checkbox" checked={!!sel.mono} onChange={(e) => updEl(sel.id, { mono: e.target.checked })} /> Mono</label><label className="flex items-center gap-1"><input type="checkbox" checked={sel.wrap !== false} onChange={(e) => updEl(sel.id, { wrap: e.target.checked })} /> Satır kır</label></div></>}
              {sel.type === "barcode" && <label className="flex items-center gap-1 py-0.5"><input type="checkbox" checked={sel.showText !== false} onChange={(e) => updEl(sel.id, { showText: e.target.checked })} data-testid="label-prop-showtext" /> Barkod numarasını yaz</label>}
              {sel.type === "box" && <><Prop label="Kenar (mm)"><input type="number" step="0.1" value={sel.border ?? 0.3} onChange={(e) => updEl(sel.id, { border: Number(e.target.value) })} className={num} /></Prop><Prop label="Köşe (mm)"><input type="number" step="0.5" value={sel.radius ?? 0} onChange={(e) => updEl(sel.id, { radius: Number(e.target.value) })} className={num} /></Prop></>}
              <div className="grid grid-cols-2 gap-1 pt-1 border-t mt-1">{[["x", "X mm"], ["y", "Y mm"], ["w", "Genişlik"], ["h", "Yükseklik"], ["rotate", "Döndür °"]].map(([k, l]) => <Prop key={k} label={l}><input type="number" step={k === "rotate" ? 90 : 0.5} value={sel[k] ?? 0} onChange={(e) => updEl(sel.id, { [k]: Number(e.target.value) })} className={num} data-testid={`label-prop-${k}`} /></Prop>)}</div>
            </>)}
          </div>
        </div>)}
      {printing && tpl && <PrintModal tpl={tpl} templates={tpls} onTplChange={(t) => t && setTpl(t)} products={products} company={company} onClose={() => setPrinting(false)} />}
    </div>
  );
};

export const LabelQuickPrint = ({ companyId, product, company, onClose, onOpenDesigner }) => {
  useEscape(onClose);
  const builtins = useMemo(() => builtinTemplates(), []);
  const targets = useMemo(() => cardPrintTargets(product), [product]);
  const [saved, setSaved] = useState([]);
  const [tpl, setTpl] = useState(null);
  const [copies, setCopies] = useState(1);
  const [page, setPage] = useState({ mode: "thermal", cols: 1, rows: 1, gap_mm: 2 });
  const [targetId, setTargetId] = useState(targets[0]?.id);

  useEffect(() => {
    axios.get(`${API_URL}/label-templates?company_id=${companyId}`).then((r) => {
      const list = Array.isArray(r.data) ? r.data : [];
      setSaved(list);
      const pick = list.find((t) => t.is_default) || list[0] || builtins.find((t) => t.id === "builtin-50x30") || builtins[0];
      setTpl(pick);
      setPage(pick.page || { mode: "thermal", cols: 1, rows: 1, gap_mm: 2 });
    }).catch(() => {
      setSaved([]);
      const pick = builtins.find((t) => t.id === "builtin-50x30") || builtins[0];
      setTpl(pick);
      setPage(pick.page || { mode: "thermal", cols: 1, rows: 1, gap_mm: 2 });
    });
  }, [companyId, builtins]);

  const options = useMemo(() => [...saved, ...builtins], [saved, builtins]);
  const target = targets.find((t) => t.id === targetId) || targets[0];
  const jobs = useMemo(() => (target ? Array.from({ length: Math.max(1, copies) }, () => target) : []), [target, copies]);

  const applyTpl = (next) => {
    if (!next) return;
    setTpl(next);
    setPage(next.page || { mode: "thermal", cols: 1, rows: 1, gap_mm: 2 });
  };

  if (!tpl || !target) return null;

  return (
    <div className="fixed inset-0 z-[80] bg-slate-900/60 flex items-center justify-center p-4" onClick={onClose}>
      <div className="bg-white rounded-2xl w-full max-w-2xl max-h-[92vh] overflow-y-auto p-5 space-y-3 text-xs text-slate-800" onClick={(e) => e.stopPropagation()} data-testid="label-quick-modal">
        <div className="flex items-start justify-between gap-3">
          <div className="min-w-0">
            <b className="text-sm flex items-center gap-2 text-slate-900"><Tag className="w-4 h-4 text-emerald-600" /> Etiket Yazdır</b>
            <div className="mt-1 font-semibold text-slate-900 truncate" data-testid="label-quick-product-name">{product.name}</div>
            <div className="text-[10px] text-slate-400 font-mono">{product.sku}{product.barcode ? ` · ${product.barcode}` : ""}</div>
          </div>
          <button onClick={onClose} className="p-1 hover:bg-slate-100 rounded-lg shrink-0" data-testid="label-print-close"><X className="w-4 h-4" /></button>
        </div>

        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
          <label className="block space-y-1">
            <span className="font-semibold text-slate-700">Etiket şablonu</span>
            <select
              value={tpl.id || ""}
              onChange={(e) => applyTpl(options.find((t) => t.id === e.target.value))}
              className="w-full border rounded-lg p-2 bg-slate-50"
              data-testid="label-print-tpl"
            >
              {saved.length > 0 && (
                <optgroup label="Kayıtlı şablonlar">
                  {saved.map((t) => <option key={t.id} value={t.id}>{t.is_default ? "★ " : ""}{t.name} ({t.width_mm}×{t.height_mm} mm)</option>)}
                </optgroup>
              )}
              <optgroup label="Hazır etiket şablonları">
                {builtins.map((t) => <option key={t.id} value={t.id}>{t.name}</option>)}
              </optgroup>
            </select>
          </label>
          {targets.length > 1 && (
            <label className="block space-y-1">
              <span className="font-semibold text-slate-700">Bu kart / varyant</span>
              <select value={target.id} onChange={(e) => setTargetId(e.target.value)} className="w-full border rounded-lg p-2 bg-slate-50" data-testid="label-quick-target">
                {targets.map((t, i) => <option key={t.id} value={t.id}>{i === 0 ? "Stok kartı" : t.variant_name} ({t.sku || t.barcode || "kod yok"})</option>)}
              </select>
            </label>
          )}
          <label className="block space-y-1">
            <span className="font-semibold text-slate-700">Adet</span>
            <input type="number" min="1" max="200" value={copies} onChange={(e) => setCopies(Math.max(1, Math.min(200, Number(e.target.value) || 1)))} className="w-full border rounded-lg p-2 font-bold" data-testid="label-quick-copies" />
          </label>
          <label className="block space-y-1">
            <span className="font-semibold text-slate-700">Sayfa</span>
            <select value={page.mode} onChange={(e) => setPage({ ...page, mode: e.target.value })} className="w-full border rounded-lg p-2 bg-slate-50" data-testid="label-page-mode">
              <option value="thermal">Termal rulo (etiket başına sayfa)</option>
              <option value="a4">A4 etiket kağıdı</option>
            </select>
          </label>
        </div>
        {page.mode === "a4" && (
          <div className="flex flex-wrap items-center gap-2">
            <label>Sütun <input type="number" min="1" max="8" value={page.cols} onChange={(e) => setPage({ ...page, cols: Number(e.target.value) })} className="w-14 border rounded-lg p-1.5" data-testid="label-page-cols" /></label>
            <label>Boşluk mm <input type="number" min="0" step="0.5" value={page.gap_mm} onChange={(e) => setPage({ ...page, gap_mm: Number(e.target.value) })} className="w-16 border rounded-lg p-1.5" /></label>
          </div>
        )}

        {saved.length === 0 && (
          <p className="text-[11px] text-slate-500 bg-slate-50 border border-slate-100 rounded-xl px-3 py-2" data-testid="label-quick-no-saved">
            Kayıtlı şablon yok — hazır boyutlardan birini seçin veya{" "}
            <button type="button" className="text-emerald-700 font-semibold underline" data-testid="label-quick-open-designer" onClick={() => { onClose(); onOpenDesigner?.(); }}>Etiket Tasarımı</button>
            {" "}sekmesinden kendi şablonunuzu kaydedin.
          </p>
        )}

        <div className="flex items-center justify-between gap-2">
          <span className="text-slate-500">{tpl.width_mm}×{tpl.height_mm} mm · {jobs.length} etiket</span>
          <button onClick={() => printLabelJobs(tpl, jobs, page, "label-quick-print-source")} className="px-4 py-2 bg-slate-900 text-white rounded-lg font-semibold flex items-center gap-1" data-testid="label-print-btn">
            <Printer className="w-4 h-4" /> Yazdır
          </button>
        </div>

        <div className="bg-slate-50 p-4 rounded-xl flex justify-center overflow-x-auto" data-testid="label-quick-preview">
          <div className="shadow border bg-white"><LabelCanvas tpl={tpl} product={target} company={company} scale={tpl.width_mm >= 80 ? 1.4 : 2} /></div>
        </div>
        <div id="label-quick-print-source" className="hidden">{jobs.map((p, i) => <div key={i} className="lbl"><LabelCanvas tpl={tpl} product={p} company={company} scale={1} /></div>)}</div>
      </div>
    </div>
  );
};
