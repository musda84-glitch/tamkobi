import React, { useRef, useState } from "react";
import { EyeOff, GripVertical, ImagePlus, Plus, ArrowDown, ArrowUp } from "lucide-react";
import { QRCodeSVG } from "qrcode.react";
import { compressImageFile } from "../../utils/compressImage";
import {
  BLOCK_LABELS,
  FONT_OPTIONS,
  LINE_COL_LABELS,
  SAMPLE_INVOICE,
  hiddenLineCols,
  isLineCol,
  moveBlock,
  moveVisible,
  normalizeLayout,
  sampleQrPayload,
  setBlockHidden,
  visibleLineCols,
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

const lineCell = (ln, colId) => {
  if (colId === "qty" && !ln._showUnit) return `${ln.qty}${ln.unit ? ` ${ln.unit}` : ""}`;
  return ln[colId] ?? "";
};

const LineColsBar = ({ layout, onPatchCols, drag, onDragStart, onDragOver, onDrop, onDragEnd }) => {
  const vis = visibleLineCols(layout);
  const hid = hiddenLineCols(layout);
  return (
    <div className="mt-2 space-y-1.5" data-testid="einvoice-design-line-cols">
      <div className="flex flex-wrap gap-1">
        {vis.map((c) => (
          <span
            key={c.id}
            draggable
            onDragStart={onDragStart(c.id)}
            onDragOver={onDragOver(c.id)}
            onDrop={onDrop(c.id)}
            onDragEnd={onDragEnd}
            className={`inline-flex items-center gap-0.5 text-[9px] font-bold px-1.5 py-0.5 rounded-full border bg-white cursor-grab ${drag === c.id ? "opacity-40" : ""} ${drag && drag !== c.id ? "border-emerald-300" : "border-slate-200"}`}
            data-testid={`einvoice-design-col-${c.id}`}
          >
            <GripVertical className="w-2.5 h-2.5 text-slate-300" />
            {LINE_COL_LABELS[c.id]}
            <button type="button" className="text-rose-500 pl-0.5" title="Kaldır" data-testid={`einvoice-design-col-hide-${c.id}`} onClick={(e) => { e.stopPropagation(); onPatchCols(setBlockHidden(layout.lineCols, c.id, true)); }}>×</button>
          </span>
        ))}
      </div>
      {hid.length ? (
        <div className="flex flex-wrap gap-1" data-testid="einvoice-design-col-adders">
          {hid.map((c) => (
            <button
              key={c.id}
              type="button"
              onClick={() => onPatchCols(setBlockHidden(layout.lineCols, c.id, false))}
              className="text-[9px] font-bold px-1.5 py-0.5 rounded-full border border-dashed border-emerald-300 text-emerald-800 bg-emerald-50/70"
              data-testid={`einvoice-design-col-show-${c.id}`}
            >
              + {LINE_COL_LABELS[c.id]}
            </button>
          ))}
        </div>
      ) : null}
    </div>
  );
};

const PreviewBlock = ({ id, layout, onPatchCols, drag, onDragStart, onDragOver, onDrop, onDragEnd }) => {
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
    const cols = visibleLineCols(layout);
    const unitOn = cols.some((c) => c.id === "unit");
    return (
      <div>
        <div className="overflow-x-auto">
          <table className="w-full text-[10px]">
            <thead>
              <tr style={{ background: layout.primary, color: "#fff" }}>
                {cols.map((c) => (
                  <th key={c.id} className={`p-1.5 font-semibold whitespace-nowrap ${c.id === "name" || c.id === "sku" ? "text-left" : "text-right"}`}>{LINE_COL_LABELS[c.id]}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {s.lines.map((ln) => (
                <tr key={ln.no} style={{ borderBottom: `1px solid ${layout.muted}22` }}>
                  {cols.map((c) => (
                    <td key={c.id} className={`p-1.5 whitespace-nowrap ${c.id === "name" || c.id === "sku" ? "text-left" : "text-right"}`}>
                      {lineCell({ ...ln, _showUnit: unitOn }, c.id)}
                    </td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <LineColsBar layout={layout} onPatchCols={onPatchCols} drag={drag} onDragStart={onDragStart} onDragOver={onDragOver} onDrop={onDrop} onDragEnd={onDragEnd} />
      </div>
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
  if (id === "balance") {
    return (
      <div className="flex items-center justify-between rounded-lg px-2.5 py-2 text-[11px]" style={{ border: `1px solid ${layout.accent}` }}>
        <span className="font-bold uppercase text-[9px]" style={{ color: layout.muted }}>Güncel bakiye</span>
        <span className="font-bold" style={{ color: layout.primary }}>{s.balance}</span>
      </div>
    );
  }
  if (id === "qr") {
    return (
      <div className="flex items-end justify-end gap-2 pt-1">
        <div className="text-right text-[9px]" style={{ color: layout.muted }}>
          <div className="font-bold uppercase mb-1">GİB karekod</div>
          <div className="break-all max-w-[9rem]">{s.ettn}</div>
        </div>
        <div className="bg-white p-1 border rounded" data-testid="einvoice-design-qr">
          <QRCodeSVG value={sampleQrPayload(s)} size={72} level="M" />
        </div>
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
  const hiddenCols = hiddenLineCols(L);

  const patch = (partial) => onChange(normalizeLayout({ ...L, ...partial }, kind));
  const patchBlocks = (blocks) => patch({ blocks });
  const patchCols = (lineCols) => patch({ lineCols });

  const onDragStart = (id) => (e) => {
    e.stopPropagation();
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
  const clearDrag = () => { setDragId(""); setOverId(""); setOverPalette(false); };

  const applyDrop = (from, targetId, asVisible) => {
    if (!from || from === targetId) return;
    if (isLineCol(from)) {
      let cols = L.lineCols;
      if (asVisible || isLineCol(targetId) || targetId === "lines") cols = setBlockHidden(cols, from, false);
      if (isLineCol(targetId)) cols = moveBlock(cols, from, targetId);
      patchCols(cols);
      return;
    }
    if (isLineCol(targetId)) return;
    let blocks = L.blocks;
    if (asVisible) blocks = setBlockHidden(blocks, from, false);
    patchBlocks(moveBlock(blocks, from, targetId));
  };

  const onDropItem = (id, asVisible) => (e) => {
    e.preventDefault();
    e.stopPropagation();
    const from = dragId || e.dataTransfer.getData("text/plain");
    clearDrag();
    applyDrop(from, id, asVisible);
  };
  const dropOnPalette = (e) => {
    e.preventDefault();
    const from = dragId || e.dataTransfer.getData("text/plain");
    clearDrag();
    if (!from) return;
    if (isLineCol(from)) patchCols(setBlockHidden(L.lineCols, from, true));
    else patchBlocks(setBlockHidden(L.blocks, from, true));
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
        <span className="text-[10px] text-slate-500">Önizleme örnek veriyle. Bölüm ve kalem alanlarını paletten ekleyin veya sürükleyin.</span>
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
          {hidden.length === 0 ? <p className="text-[11px] text-slate-400 px-1">Bölümlerin hepsi faturada.</p> : null}
          {hidden.map((b) => (
            <div
              key={b.id}
              draggable
              onDragStart={onDragStart(b.id)}
              onDragEnd={clearDrag}
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
          <div className="text-[10px] font-bold uppercase tracking-wide text-slate-500 px-1 pt-2">Kalem alanları</div>
          {hiddenCols.length === 0 ? <p className="text-[11px] text-slate-400 px-1">Tüm kalem sütunları tabloda.</p> : null}
          {hiddenCols.map((c) => (
            <div
              key={c.id}
              draggable
              onDragStart={onDragStart(c.id)}
              onDragEnd={clearDrag}
              className={`flex items-center gap-1 bg-white border rounded-lg px-2 py-1.5 cursor-grab active:cursor-grabbing ${dragId === c.id ? "opacity-40" : ""}`}
              data-testid={`einvoice-design-palette-col-${c.id}`}
            >
              <GripVertical className="w-3.5 h-3.5 text-slate-300 shrink-0" />
              <span className="flex-1 font-semibold text-slate-700">{LINE_COL_LABELS[c.id]}</span>
              <button type="button" onClick={() => patchCols(setBlockHidden(L.lineCols, c.id, false))} className="text-[10px] font-bold text-emerald-700 px-1.5 py-0.5 border border-emerald-200 rounded" data-testid={`einvoice-design-show-col-${c.id}`}>
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
                onDragEnd={clearDrag}
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
                <PreviewBlock
                  id={b.id}
                  layout={L}
                  onPatchCols={patchCols}
                  drag={dragId}
                  onDragStart={onDragStart}
                  onDragOver={onDragOverItem}
                  onDrop={onDropItem}
                  onDragEnd={clearDrag}
                />
              </div>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
};
