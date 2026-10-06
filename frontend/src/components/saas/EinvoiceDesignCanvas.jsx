import React, { useEffect, useRef, useState } from "react";
import { EyeOff, GripVertical, ImagePlus, Plus, ArrowDown, ArrowUp } from "lucide-react";
import { QRCodeSVG } from "qrcode.react";
import { compressImageFile } from "../../utils/compressImage";
import {
  BLOCK_LABELS,
  FONT_OPTIONS,
  LINE_COL_LABELS,
  META_FIELD_LABELS,
  metaGridColsClass,
  GIB_SEAL_JPEG_DATA_URL,
  SAMPLE_INVOICE,
  SPAN_CLASS,
  SPAN_OPTIONS,
  QR_SIZE_OPTIONS,
  LOGO_SIZE_OPTIONS,
  TOTAL_ROW_LABELS,
  gibSealAlt,
  gibSealCaption,
  TOTAL_ROW_SAMPLE_KEY,
  hiddenLineCols,
  hiddenMetaFields,
  hiddenTotalRows,
  isLineCol,
  isMetaField,
  isTotalRow,
  moveBlock,
  moveVisible,
  normalizeLayout,
  sampleQrPayload,
  setBlockHidden,
  setBlockSpan,
  visibleLineCols,
  visibleMetaFields,
  visibleTotalRows,
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

const FieldChipsBar = ({ vis, hid, labels, testPrefix, list, onPatch, drag, onDragStart, onDragOver, onDrop, onDragEnd }) => (
  <div className="mt-2 space-y-1.5" data-testid={`einvoice-design-${testPrefix}s`}>
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
          data-testid={`einvoice-design-${testPrefix}-${c.id}`}
        >
          <GripVertical className="w-2.5 h-2.5 text-slate-300" />
          {labels[c.id]}
          <button type="button" className="text-rose-500 pl-0.5" title="Kaldır" data-testid={`einvoice-design-${testPrefix}-hide-${c.id}`} onClick={(e) => { e.stopPropagation(); onPatch(setBlockHidden(list, c.id, true)); }}>×</button>
        </span>
      ))}
    </div>
    {hid.length ? (
      <div className="flex flex-wrap gap-1" data-testid={`einvoice-design-${testPrefix}-adders`}>
        {hid.map((c) => (
          <button
            key={c.id}
            type="button"
            onClick={() => onPatch(setBlockHidden(list, c.id, false))}
            className="text-[9px] font-bold px-1.5 py-0.5 rounded-full border border-dashed border-emerald-300 text-emerald-800 bg-emerald-50/70"
            data-testid={`einvoice-design-${testPrefix}-show-${c.id}`}
          >
            + {labels[c.id]}
          </button>
        ))}
      </div>
    ) : null}
  </div>
);

const LineColsBar = ({ layout, onPatchCols, drag, onDragStart, onDragOver, onDrop, onDragEnd }) => (
  <FieldChipsBar
    vis={visibleLineCols(layout)}
    hid={hiddenLineCols(layout)}
    labels={LINE_COL_LABELS}
    testPrefix="col"
    list={layout.lineCols}
    onPatch={onPatchCols}
    drag={drag}
    onDragStart={onDragStart}
    onDragOver={onDragOver}
    onDrop={onDrop}
    onDragEnd={onDragEnd}
  />
);

const PreviewBlock = ({ id, layout, onPatchCols, onPatchMeta, onPatchTotals, onQrSize, onLogoSize, drag, onDragStart, onDragOver, onDrop, onDragEnd }) => {
  const s = SAMPLE_INVOICE;
  const title = layout.kind === "e_archive" ? "e-Arşiv Fatura" : "e-Fatura";
  if (id === "header") {
    const logoSize = Number(layout.logoSize) || 72;
    return (
      <div className="pb-2 space-y-1.5" data-testid="einvoice-design-logo" style={{ borderBottom: `3px solid ${layout.accent}` }}>
        {layout.logo ? (
          <img src={layout.logo} alt="logo" className="object-contain" style={{ height: logoSize, width: "auto", maxWidth: "100%" }} />
        ) : (
          <div className="text-[10px] text-slate-400 border border-dashed rounded-md px-2 py-3 inline-block">Logo</div>
        )}
        <div className="flex items-center flex-wrap gap-1" data-testid="einvoice-design-logo-sizes">
          <span className="text-[9px] font-bold text-slate-500">Boyut</span>
          {LOGO_SIZE_OPTIONS.map((opt) => (
            <button
              key={opt.size}
              type="button"
              title={`${opt.size} px`}
              onClick={(e) => { e.stopPropagation(); onLogoSize?.(opt.size); }}
              className={`text-[9px] font-bold px-1.5 py-0.5 rounded border ${logoSize === opt.size ? "bg-slate-800 text-white border-slate-800" : "text-slate-600 border-slate-200 hover:bg-slate-100"}`}
              data-testid={`einvoice-design-logo-size-${opt.size}`}
            >
              {opt.label}
            </button>
          ))}
        </div>
      </div>
    );
  }
  if (id === "gib_seal") {
    return (
      <div className="flex flex-col items-center justify-center py-1 text-center" data-testid="einvoice-design-gib-seal">
        <img src={GIB_SEAL_JPEG_DATA_URL} alt={gibSealAlt(layout.kind)} style={{ width: 91 }} />
        <div className="text-base font-bold mt-1" style={{ color: layout.primary }}>{gibSealCaption(layout.kind)}</div>
      </div>
    );
  }
  if (id === "supplier") {
    return <PartyCard title="Satıcı" p={s.supplier} kCls={layout.muted} vCls={layout.primary} />;
  }
  if (id === "customer") {
    return <PartyCard title="Alıcı" p={s.customer} kCls={layout.muted} vCls={layout.primary} />;
  }
  if (id === "meta") {
    const fields = visibleMetaFields(layout);
    const cols = metaGridColsClass((layout.blocks || []).find((b) => b.id === "meta")?.span, fields.length);
    const valueOf = (fid) => {
      if (fid === "number") return s.number;
      if (fid === "invoice_date" || fid === "date") return s.date;
      if (fid === "issue_time") return s.issueTime;
      if (fid === "profile") return s.profile;
      if (fid === "ettn") return s.ettn;
      if (fid === "order_no") return s.orderNo;
      return "";
    };
    return (
      <div>
        <div className={`grid gap-2 text-[11px] ${cols}`} style={{ borderBottom: `1px solid ${layout.muted}33` }} data-testid="einvoice-design-meta-grid">
          {fields.map((f) => (
            <div key={f.id} className="min-w-0">
              {f.id === "number" ? <span className="inline-block text-[10px] font-bold text-white px-2 py-0.5 rounded mb-0.5" style={{ background: layout.accent }}>{title}</span> : null}
              <div className="text-[9px] font-bold uppercase" style={{ color: layout.muted }}>{META_FIELD_LABELS[f.id]}</div>
              <div className={f.id === "ettn" ? "break-all text-[9px]" : f.id === "number" ? "font-bold" : ""} style={f.id === "number" ? { color: layout.primary } : undefined}>{valueOf(f.id)}</div>
            </div>
          ))}
        </div>
        <FieldChipsBar
          vis={fields}
          hid={hiddenMetaFields(layout)}
          labels={META_FIELD_LABELS}
          testPrefix="meta"
          list={layout.metaFields}
          onPatch={onPatchMeta}
          drag={drag}
          onDragStart={onDragStart}
          onDragOver={onDragOver}
          onDrop={onDrop}
          onDragEnd={onDragEnd}
        />
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
    const rows = visibleTotalRows(layout);
    return (
      <div>
        <div className="flex justify-end">
          <table className="text-[11px] min-w-[14rem]">
            <tbody>
              {rows.map((r) => {
                const grand = r.id === "grand";
                return (
                  <tr
                    key={r.id}
                    className={grand ? "font-bold text-sm" : ""}
                    style={grand ? { borderTop: `2px solid ${layout.accent}`, color: layout.primary } : undefined}
                  >
                    <td className={grand ? "pr-6 py-1" : "pr-6 py-0.5"} style={grand ? undefined : { color: layout.muted }}>{TOTAL_ROW_LABELS[r.id]}</td>
                    <td className="text-right">{s[TOTAL_ROW_SAMPLE_KEY[r.id] || r.id]}{grand ? " TL" : ""}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
        <FieldChipsBar
          vis={rows}
          hid={hiddenTotalRows(layout)}
          labels={TOTAL_ROW_LABELS}
          testPrefix="total"
          list={layout.totalRows}
          onPatch={onPatchTotals}
          drag={drag}
          onDragStart={onDragStart}
          onDragOver={onDragOver}
          onDrop={onDrop}
          onDragEnd={onDragEnd}
        />
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
    const qrSize = Number(layout.qrSize) || 96;
    return (
      <div className="flex flex-col items-end gap-1.5 pt-1">
        <div className="bg-white p-1 border rounded" data-testid="einvoice-design-qr">
          <QRCodeSVG value={sampleQrPayload(s)} size={qrSize} level="M" />
        </div>
        <div className="flex items-center flex-wrap justify-end gap-1" data-testid="einvoice-design-qr-sizes">
          <span className="text-[9px] font-bold text-slate-500">Boyut</span>
          {QR_SIZE_OPTIONS.map((opt) => (
            <button
              key={opt.size}
              type="button"
              title={`${opt.size} px`}
              onClick={(e) => { e.stopPropagation(); onQrSize?.(opt.size); }}
              className={`text-[9px] font-bold px-1.5 py-0.5 rounded border ${qrSize === opt.size ? "bg-slate-800 text-white border-slate-800" : "text-slate-600 border-slate-200 hover:bg-slate-100"}`}
              data-testid={`einvoice-design-qr-size-${opt.size}`}
            >
              {opt.label}
            </button>
          ))}
        </div>
      </div>
    );
  }
  return null;
};

export const EinvoiceDesignCanvas = ({ layout, onChange, kind, xsltHtml = "", preferXsltPreview = false }) => {
  const L = normalizeLayout(layout, kind);
  const logoRef = useRef(null);
  const [dragId, setDragId] = useState("");
  const [overId, setOverId] = useState("");
  const [overPalette, setOverPalette] = useState(false);
  const [paperMode, setPaperMode] = useState(preferXsltPreview && xsltHtml ? "xslt" : "layout");
  const visible = L.blocks.filter((b) => !b.hidden);
  const hidden = L.blocks.filter((b) => b.hidden);
  const hiddenCols = hiddenLineCols(L);
  const hiddenMeta = hiddenMetaFields(L);
  const hiddenTotals = hiddenTotalRows(L);

  useEffect(() => {
    setPaperMode(preferXsltPreview && xsltHtml ? "xslt" : "layout");
  }, [preferXsltPreview, xsltHtml]);

  const patch = (partial) => {
    setPaperMode("layout");
    onChange(normalizeLayout({ ...L, ...partial }, kind));
  };
  const patchBlocks = (blocks) => patch({ blocks });
  const patchCols = (lineCols) => patch({ lineCols });
  const patchMeta = (metaFields) => patch({ metaFields });
  const patchTotals = (totalRows) => patch({ totalRows });

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
    if (isMetaField(from)) {
      let fields = L.metaFields;
      if (asVisible || isMetaField(targetId) || targetId === "meta") fields = setBlockHidden(fields, from, false);
      if (isMetaField(targetId)) fields = moveBlock(fields, from, targetId);
      patchMeta(fields);
      return;
    }
    if (isTotalRow(from)) {
      let rows = L.totalRows;
      if (asVisible || isTotalRow(targetId) || targetId === "totals") rows = setBlockHidden(rows, from, false);
      if (isTotalRow(targetId)) rows = moveBlock(rows, from, targetId);
      patchTotals(rows);
      return;
    }
    if (isLineCol(targetId) || isMetaField(targetId) || isTotalRow(targetId)) return;
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
    else if (isMetaField(from)) patchMeta(setBlockHidden(L.metaFields, from, true));
    else if (isTotalRow(from)) patchTotals(setBlockHidden(L.totalRows, from, true));
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
      <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-5 gap-2">
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
        <span className="text-[10px] text-slate-500">Önizleme örnek veriyle. Yüklenen XSLT burada görünür; düzenlemek için Düzenleyici’ye geçin.</span>
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
          <div className="text-[10px] font-bold uppercase tracking-wide text-slate-500 px-1 pt-2">Fatura alanları</div>
          {hiddenMeta.length === 0 ? <p className="text-[11px] text-slate-400 px-1">Tüm fatura bilgileri bölümde.</p> : null}
          {hiddenMeta.map((c) => (
            <div
              key={c.id}
              draggable
              onDragStart={onDragStart(c.id)}
              onDragEnd={clearDrag}
              className={`flex items-center gap-1 bg-white border rounded-lg px-2 py-1.5 cursor-grab active:cursor-grabbing ${dragId === c.id ? "opacity-40" : ""}`}
              data-testid={`einvoice-design-palette-meta-${c.id}`}
            >
              <GripVertical className="w-3.5 h-3.5 text-slate-300 shrink-0" />
              <span className="flex-1 font-semibold text-slate-700">{META_FIELD_LABELS[c.id]}</span>
              <button type="button" onClick={() => patchMeta(setBlockHidden(L.metaFields, c.id, false))} className="text-[10px] font-bold text-emerald-700 px-1.5 py-0.5 border border-emerald-200 rounded" data-testid={`einvoice-design-show-meta-${c.id}`}>
                <Plus className="w-3 h-3 inline" /> Ekle
              </button>
            </div>
          ))}
          <div className="text-[10px] font-bold uppercase tracking-wide text-slate-500 px-1 pt-2">Toplam alanları</div>
          {hiddenTotals.length === 0 ? <p className="text-[11px] text-slate-400 px-1">Tüm toplam satırları tabloda.</p> : null}
          {hiddenTotals.map((c) => (
            <div
              key={c.id}
              draggable
              onDragStart={onDragStart(c.id)}
              onDragEnd={clearDrag}
              className={`flex items-center gap-1 bg-white border rounded-lg px-2 py-1.5 cursor-grab active:cursor-grabbing ${dragId === c.id ? "opacity-40" : ""}`}
              data-testid={`einvoice-design-palette-total-${c.id}`}
            >
              <GripVertical className="w-3.5 h-3.5 text-slate-300 shrink-0" />
              <span className="flex-1 font-semibold text-slate-700">{TOTAL_ROW_LABELS[c.id]}</span>
              <button type="button" onClick={() => patchTotals(setBlockHidden(L.totalRows, c.id, false))} className="text-[10px] font-bold text-emerald-700 px-1.5 py-0.5 border border-emerald-200 rounded" data-testid={`einvoice-design-show-total-${c.id}`}>
                <Plus className="w-3 h-3 inline" /> Ekle
              </button>
            </div>
          ))}
        </div>

        <div className="lg:col-span-9">
          <div className="flex flex-wrap items-center justify-between gap-2 mb-1">
            <div className="text-[10px] text-slate-500 font-semibold">Önizleme (örnek veri) — en: Tam / 1/2 / 1/3, yan yana için ardışık 1/2</div>
            {xsltHtml ? (
              <div className="flex gap-1 bg-slate-100 rounded-lg p-0.5" data-testid="einvoice-design-paper-tabs">
                <button type="button" onClick={() => setPaperMode("layout")} className={`px-2 py-1 rounded-md font-semibold ${paperMode === "layout" ? "bg-white shadow-sm" : "text-slate-500"}`} data-testid="einvoice-design-paper-layout">Düzenleyici</button>
                <button type="button" onClick={() => setPaperMode("xslt")} className={`px-2 py-1 rounded-md font-semibold ${paperMode === "xslt" ? "bg-white shadow-sm" : "text-slate-500"}`} data-testid="einvoice-design-paper-xslt">Yüklenen XSLT</button>
              </div>
            ) : null}
          </div>
          {paperMode === "xslt" && xsltHtml ? (
            <iframe
              title="Yüklenen XSLT önizleme"
              srcDoc={xsltHtml}
              sandbox="allow-same-origin"
              className="w-full min-h-[22rem] h-[36rem] rounded-xl border shadow-sm bg-white"
              data-testid="einvoice-design-preview"
            />
          ) : (
          <div
            className="rounded-xl border shadow-sm p-4 min-h-[22rem] grid grid-cols-12 gap-2"
            style={{ background: L.paper, color: L.text, fontFamily: `"${L.font}", Tahoma, sans-serif` }}
            data-testid="einvoice-design-preview"
          >
            {visible.length === 0 ? <p className="col-span-12 text-slate-400 text-center py-10">Paletten bölüm ekleyin.</p> : null}
            {visible.map((b) => (
              <div
                key={b.id}
                draggable
                onDragStart={onDragStart(b.id)}
                onDragOver={onDragOverItem(b.id)}
                onDrop={onDropItem(b.id, true)}
                onDragEnd={clearDrag}
                className={`relative rounded-lg p-1.5 pt-6 ${SPAN_CLASS[b.span] || "col-span-12"} ${dragId === b.id ? "opacity-40" : ""} ${overId === b.id && dragId !== b.id ? "ring-2 ring-emerald-400" : "ring-1 ring-slate-200/80 hover:ring-slate-300"}`}
                data-testid={`einvoice-design-block-${b.id}`}
              >
                <div className="absolute top-0.5 left-1 right-1 z-10 flex items-center gap-0.5 min-w-0">
                  <GripVertical className="w-3.5 h-3.5 text-slate-300 cursor-grab shrink-0" />
                  <span className="text-[9px] font-bold text-slate-400 px-1 cursor-grab truncate">{BLOCK_LABELS[b.id]}</span>
                  <span className="flex-1" />
                  {SPAN_OPTIONS.map((opt) => (
                    <button
                      key={opt.span}
                      type="button"
                      title={opt.label}
                      onClick={() => patchBlocks(setBlockSpan(L.blocks, b.id, opt.span))}
                      className={`text-[8px] font-bold px-1 py-0.5 rounded ${Number(b.span) === opt.span ? "bg-slate-800 text-white" : "text-slate-400 hover:bg-slate-100"}`}
                      data-testid={`einvoice-design-span-${b.id}-${opt.span}`}
                    >
                      {opt.label}
                    </button>
                  ))}
                  <button type="button" onClick={() => patchBlocks(moveVisible(L.blocks, b.id, -1))} className="p-0.5" title="Yukarı" data-testid={`einvoice-design-up-${b.id}`}><ArrowUp className="w-3 h-3" /></button>
                  <button type="button" onClick={() => patchBlocks(moveVisible(L.blocks, b.id, 1))} className="p-0.5" title="Aşağı" data-testid={`einvoice-design-down-${b.id}`}><ArrowDown className="w-3 h-3" /></button>
                  <button type="button" onClick={() => patchBlocks(setBlockHidden(L.blocks, b.id, true))} className="p-0.5 text-rose-600" title="Gizle" data-testid={`einvoice-design-hide-${b.id}`}><EyeOff className="w-3 h-3" /></button>
                </div>
                <PreviewBlock
                  id={b.id}
                  layout={L}
                  onPatchCols={patchCols}
                  onPatchMeta={patchMeta}
                  onPatchTotals={patchTotals}
                  onQrSize={(size) => patch({ qrSize: size })}
                  onLogoSize={(size) => patch({ logoSize: size })}
                  drag={dragId}
                  onDragStart={onDragStart}
                  onDragOver={onDragOverItem}
                  onDrop={onDropItem}
                  onDragEnd={clearDrag}
                />
              </div>
            ))}
          </div>
          )}
        </div>
      </div>
    </div>
  );
};
