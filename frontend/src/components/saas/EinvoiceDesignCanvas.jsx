import React, { useRef, useState } from "react";
import { EyeOff, GripVertical, ImagePlus, Plus, ArrowDown, ArrowUp } from "lucide-react";
import { compressImageFile } from "../../utils/compressImage";
import {
  BLOCK_LABELS,
  FONT_OPTIONS,
  SAMPLE_INVOICE,
  moveBlock,
  moveVisible,
  normalizeLayout,
  setBlockHidden,
} from "../../utils/einvoiceDesignLayout";
import { inputCls } from "./saasUi";

const fileToDataUrl = (file) => new Promise((resolve, reject) => {
  const r = new FileReader();
  r.onload = () => resolve(String(r.result || ""));
  r.onerror = () => reject(r.error || new Error("read"));
  r.readAsDataURL(file);
});

const PartyCard = ({ title, p, kCls, vCls }) => (
  <div className="border rounded-lg p-2.5 min-h-[7rem]" style={{ borderColor: `${kCls}33` }}>
    <div className="text-[9px] font-bold uppercase tracking-wide" style={{ color: kCls }}>{title}</div>
    <div className="font-bold mt-0.5" style={{ color: vCls }}>{p.name}</div>
    <div className="text-[10px] leading-snug mt-0.5">{p.address}</div>
    <div className="text-[10px] mt-1">VKN/TCKN: {p.vkn}</div>
    <div className="text-[10px]">VD: {p.taxOffice}</div>
  </div>
);

const PreviewBlock = ({ id, layout }) => {
  const s = SAMPLE_INVOICE;
  const title = layout.kind === "e_archive" ? "e-Arşiv Fatura" : "e-Fatura";
  if (id === "header") {
    return (
      <div className="flex items-start justify-between gap-3 pb-2" style={{ borderBottom: `3px solid ${layout.accent}` }}>
        <div className="min-w-0">
          {layout.logo ? <img src={layout.logo} alt="logo" className="max-h-[56px] max-w-[180px] object-contain mb-1" /> : null}
          <div className="text-base font-bold" style={{ color: layout.primary }}>{layout.companyTitle || s.supplier.name}</div>
        </div>
        <div className="text-right shrink-0">
          <span className="inline-block text-[10px] font-bold text-white px-2 py-0.5 rounded" style={{ background: layout.accent }}>{title}</span>
          <div className="text-sm font-bold mt-1" style={{ color: layout.primary }}>{s.number}</div>
        </div>
      </div>
    );
  }
  if (id === "parties") {
    return (
      <div className="grid grid-cols-2 gap-2">
        <PartyCard title="Satıcı" p={s.supplier} kCls={layout.muted} vCls={layout.primary} />
        <PartyCard title="Alıcı" p={s.customer} kCls={layout.muted} vCls={layout.primary} />
      </div>
    );
  }
  if (id === "meta") {
    return (
      <div className="grid grid-cols-3 gap-2 text-[11px]" style={{ borderBottom: `1px solid ${layout.muted}33` }}>
        <div><div className="text-[9px] font-bold uppercase" style={{ color: layout.muted }}>Tarih</div>{s.date}</div>
        <div><div className="text-[9px] font-bold uppercase" style={{ color: layout.muted }}>Senaryo</div>{s.profile}</div>
        <div className="min-w-0"><div className="text-[9px] font-bold uppercase" style={{ color: layout.muted }}>ETTN</div><span className="break-all text-[9px]">{s.ettn}</span></div>
      </div>
    );
  }
  if (id === "lines") {
    return (
      <table className="w-full text-[10px]">
        <thead>
          <tr style={{ background: layout.primary, color: "#fff" }}>
            <th className="text-left p-1.5 font-semibold">Sıra</th>
            <th className="text-left p-1.5 font-semibold">Mal / Hizmet</th>
            <th className="text-right p-1.5 font-semibold">Miktar</th>
            <th className="text-right p-1.5 font-semibold">Birim fiyat</th>
            <th className="text-right p-1.5 font-semibold">Tutar</th>
          </tr>
        </thead>
        <tbody>
          {s.lines.map((ln) => (
            <tr key={ln.no} style={{ borderBottom: `1px solid ${layout.muted}22` }}>
              <td className="p-1.5">{ln.no}</td>
              <td className="p-1.5">{ln.name}</td>
              <td className="p-1.5 text-right">{ln.qty} {ln.unit}</td>
              <td className="p-1.5 text-right">{ln.price}</td>
              <td className="p-1.5 text-right">{ln.total}</td>
            </tr>
          ))}
        </tbody>
      </table>
    );
  }
  if (id === "totals") {
    return (
      <div className="flex justify-end">
        <table className="text-[11px] min-w-[14rem]">
          <tbody>
            <tr><td className="pr-6 py-0.5" style={{ color: layout.muted }}>Mal hizmet toplam</td><td className="text-right">{s.subtotal}</td></tr>
            <tr><td className="pr-6 py-0.5" style={{ color: layout.muted }}>KDV</td><td className="text-right">{s.vat}</td></tr>
            <tr style={{ borderTop: `2px solid ${layout.accent}`, color: layout.primary }} className="font-bold text-sm">
              <td className="pr-6 py-1">Ödenecek tutar</td><td className="text-right">{s.grand} TL</td>
            </tr>
          </tbody>
        </table>
      </div>
    );
  }
  if (id === "notes") {
    return (
      <div className="pt-2 text-[10px]" style={{ borderTop: `1px dashed ${layout.muted}55`, color: layout.muted }}>
        <div className="font-bold uppercase text-[9px] mb-0.5">Notlar</div>
        {s.notes.map((n) => <div key={n}>{n}</div>)}
      </div>
    );
  }
  if (id === "iban") {
    return (
      <div className="pt-2 text-[10px]" style={{ borderTop: `1px dashed ${layout.muted}55`, color: layout.muted }}>
        <div className="font-bold uppercase text-[9px] mb-0.5">IBAN / ödeme</div>
        <div className="font-mono">{s.iban}</div>
      </div>
    );
  }
  return null;
};

export const EinvoiceDesignCanvas = ({ layout, onChange, kind }) => {
  const L = normalizeLayout(layout, kind);
  const logoRef = useRef(null);
  const [dragId, setDragId] = useState("");
  const [overId, setOverId] = useState("");
  const [overPalette, setOverPalette] = useState(false);
  const visible = L.blocks.filter((b) => !b.hidden);
  const hidden = L.blocks.filter((b) => b.hidden);

  const patch = (partial) => onChange(normalizeLayout({ ...L, ...partial }, kind));
  const patchBlocks = (blocks) => patch({ blocks });

  const onDragStart = (id) => (e) => {
    setDragId(id);
    e.dataTransfer.effectAllowed = "move";
    e.dataTransfer.setData("text/plain", id);
  };
  const onDragOverItem = (id) => (e) => {
    if (!dragId || dragId === id) return;
    e.preventDefault();
    e.dataTransfer.dropEffect = "move";
    setOverId(id);
  };
  const onDropItem = (id, asVisible) => (e) => {
    e.preventDefault();
    const from = dragId || e.dataTransfer.getData("text/plain");
    setDragId("");
    setOverId("");
    setOverPalette(false);
    if (!from || from === id) return;
    let blocks = L.blocks;
    if (asVisible) blocks = setBlockHidden(blocks, from, false);
    patchBlocks(moveBlock(blocks, from, id));
  };
  const dropOnPalette = (e) => {
    e.preventDefault();
    const from = dragId || e.dataTransfer.getData("text/plain");
    setDragId("");
    setOverId("");
    setOverPalette(false);
    if (!from) return;
    patchBlocks(setBlockHidden(L.blocks, from, true));
  };

  const onLogo = async (e) => {
    const raw = e.target.files?.[0];
    e.target.value = "";
    if (!raw) return;
    try {
      const file = await compressImageFile(raw, { maxEdge: 480, quality: 0.78, targetBytes: 80 * 1024, force: true });
      const data = await fileToDataUrl(file);
      patch({ logo: data });
    } catch {
      /* ignore */
    }
  };

  return (
    <div className="space-y-3" data-testid="einvoice-design-canvas">
      <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 gap-2">
        <label className="block">
          <span className="block font-semibold mb-1">Firma adı</span>
          <input value={L.companyTitle} onChange={(e) => patch({ companyTitle: e.target.value })} className={inputCls} placeholder="Boşsa satıcı unvanı" data-testid="einvoice-design-company" />
        </label>
        <label className="block">
          <span className="block font-semibold mb-1">Yazı tipi</span>
          <select value={L.font} onChange={(e) => patch({ font: e.target.value })} className={inputCls} data-testid="einvoice-design-font">
            {FONT_OPTIONS.map((f) => <option key={f.id} value={f.id}>{f.label}</option>)}
          </select>
        </label>
        {[
          ["primary", "Başlık"],
          ["accent", "Vurgu"],
          ["text", "Metin"],
          ["paper", "Kağıt"],
        ].map(([key, label]) => (
          <label key={key} className="block">
            <span className="block font-semibold mb-1">{label}</span>
            <input type="color" value={L[key]} onChange={(e) => patch({ [key]: e.target.value })} className="h-9 w-full rounded-lg border border-slate-200 cursor-pointer bg-white" data-testid={`einvoice-design-color-${key}`} />
          </label>
        ))}
      </div>
      <div className="flex flex-wrap items-center gap-2">
        <input ref={logoRef} type="file" accept="image/*" className="hidden" onChange={onLogo} data-testid="einvoice-design-logo-input" />
        <button type="button" onClick={() => logoRef.current?.click()} className="px-2.5 py-1.5 border rounded-lg font-semibold inline-flex items-center gap-1.5" data-testid="einvoice-design-logo-btn">
          <ImagePlus className="w-3.5 h-3.5" /> Logo yükle
        </button>
        {L.logo ? (
          <button type="button" onClick={() => patch({ logo: "" })} className="px-2.5 py-1.5 border rounded-lg font-semibold text-slate-500" data-testid="einvoice-design-logo-clear">Logoyu kaldır</button>
        ) : null}
        <span className="text-[10px] text-slate-500">Önizleme örnek veriyle. Bölümleri sürükleyin, gizleyin veya paletten ekleyin.</span>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-12 gap-3">
        <div
          className={`lg:col-span-3 rounded-xl border p-2 space-y-1.5 min-h-[12rem] ${overPalette ? "border-rose-400 bg-rose-50" : "border-dashed border-slate-300 bg-slate-50"}`}
          data-testid="einvoice-design-palette"
          onDragOver={(e) => { e.preventDefault(); setOverPalette(true); }}
          onDragLeave={() => setOverPalette(false)}
          onDrop={dropOnPalette}
        >
          <div className="text-[10px] font-bold uppercase tracking-wide text-slate-500 px-1">Gizli bölümler</div>
          {hidden.length === 0 ? <p className="text-[11px] text-slate-400 px-1">Hepsi faturada. Gizlemek için faturadan buraya sürükleyin.</p> : null}
          {hidden.map((b) => (
            <div
              key={b.id}
              draggable
              onDragStart={onDragStart(b.id)}
              onDragEnd={() => { setDragId(""); setOverId(""); setOverPalette(false); }}
              className={`flex items-center gap-1 bg-white border rounded-lg px-2 py-1.5 cursor-grab active:cursor-grabbing ${dragId === b.id ? "opacity-40" : ""}`}
              data-testid={`einvoice-design-palette-${b.id}`}
            >
              <GripVertical className="w-3.5 h-3.5 text-slate-300 shrink-0" />
              <span className="flex-1 font-semibold text-slate-700">{BLOCK_LABELS[b.id]}</span>
              <button type="button" onClick={() => patchBlocks(setBlockHidden(L.blocks, b.id, false))} className="text-[10px] font-bold text-emerald-700 px-1.5 py-0.5 border border-emerald-200 rounded" data-testid={`einvoice-design-show-${b.id}`}>
                <Plus className="w-3 h-3 inline" /> Ekle
              </button>
            </div>
          ))}
        </div>

        <div className="lg:col-span-9">
          <div className="text-[10px] text-slate-500 mb-1 font-semibold">Önizleme (örnek veri)</div>
          <div
            className="rounded-xl border shadow-sm p-4 space-y-2 min-h-[22rem]"
            style={{ background: L.paper, color: L.text, fontFamily: `"${L.font}", Tahoma, sans-serif` }}
            data-testid="einvoice-design-preview"
          >
            {visible.length === 0 ? <p className="text-slate-400 text-center py-10">Paletten bölüm ekleyin.</p> : null}
            {visible.map((b) => (
              <div
                key={b.id}
                draggable
                onDragStart={onDragStart(b.id)}
                onDragOver={onDragOverItem(b.id)}
                onDrop={onDropItem(b.id, true)}
                onDragEnd={() => { setDragId(""); setOverId(""); setOverPalette(false); }}
                className={`relative rounded-lg p-1.5 pt-6 -mx-1 ${dragId === b.id ? "opacity-40" : ""} ${overId === b.id && dragId !== b.id ? "ring-2 ring-emerald-400" : "ring-1 ring-slate-200/80 hover:ring-slate-300"}`}
                data-testid={`einvoice-design-block-${b.id}`}
              >
                <div className="absolute top-0.5 left-1 right-1 z-10 flex items-center gap-0.5">
                  <GripVertical className="w-3.5 h-3.5 text-slate-300 cursor-grab shrink-0" />
                  <span className="text-[9px] font-bold text-slate-400 px-1 cursor-grab truncate">{BLOCK_LABELS[b.id]}</span>
                  <span className="flex-1" />
                  <button type="button" onClick={() => patchBlocks(moveVisible(L.blocks, b.id, -1))} className="p-0.5" title="Yukarı" data-testid={`einvoice-design-up-${b.id}`}><ArrowUp className="w-3 h-3" /></button>
                  <button type="button" onClick={() => patchBlocks(moveVisible(L.blocks, b.id, 1))} className="p-0.5" title="Aşağı" data-testid={`einvoice-design-down-${b.id}`}><ArrowDown className="w-3 h-3" /></button>
                  <button type="button" onClick={() => patchBlocks(setBlockHidden(L.blocks, b.id, true))} className="p-0.5 text-rose-600" title="Gizle" data-testid={`einvoice-design-hide-${b.id}`}><EyeOff className="w-3 h-3" /></button>
                </div>
                <PreviewBlock id={b.id} layout={L} />
              </div>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
};
