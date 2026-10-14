import React, { useEffect, useRef, useState } from "react";
import { EyeOff, GripVertical, ImagePlus, Plus, ArrowDown, ArrowUp } from "lucide-react";
import { QRCodeSVG } from "qrcode.react";
import { compressImageFile } from "../../utils/compressImage";
import { prepareStampFile } from "../../utils/einvoiceStampImage";
import { transformXsltToHtml } from "../../utils/einvoiceXsltPreview";
import {
  BLOCK_LABELS,
  BLOCK_FONT_SIZE_OPTIONS,
  FONT_OPTIONS,
  FONT_SIZE_OPTIONS,
  LINE_COL_LABELS,
  META_FIELD_LABELS,
  HEADER_FIELD_LABELS,
  GIB_SEAL_JPEG_DATA_URL,
  SAMPLE_INVOICE,
  SPAN_CLASS,
  unitLabel,
  previewIban,
  previewNotes,
  SPAN_OPTIONS,
  QR_SIZE_OPTIONS,
  LOGO_SIZE_OPTIONS,
  STAMP_ALIGN_OPTIONS,
  STAMP_SIZE_OPTIONS,
  TOTAL_ROW_LABELS,
  asStampAlign,
  asStampSize,
  layoutToXslt,
  blockFontFamily,
  blockFontSize,
  blockHasFont,
  gibSealAlt,
  gibSealCaption,
  gibSealKindForBlock,
  TOTAL_ROW_SAMPLE_KEY,
  hiddenLineCols,
  hiddenMetaFields,
  hiddenHeaderFields,
  hiddenTotalRows,
  isLineCol,
  isMetaField,
  isHeaderField,
  isTotalRow,
  columnAnchorId,
  detachFromColumn,
  moveBlock,
  moveVisible,
  normalizeLayout,
  packBlockRows,
  stackBlock,
  sampleQrPayload,
  setBlockFont,
  setBlockFontSize,
  setBlockHidden,
  setBlockSpan,
  visibleLineCols,
  visibleMetaFields,
  filledMetaFields,
  sampleMetaValue,
  visibleHeaderFields,
  visibleTotalRows,
} from "../../utils/einvoiceDesignLayout";
import { inputCls } from "./saasUi";

/** Her metin bloğu için yazı tipi + punto (global varsayılanın üzerine). */
const BlockFontBar = ({ blockId, layout, onFontSize, onFont }) => {
  if (!blockHasFont(blockId)) return null;
  const fs = blockFontSize(layout, blockId);
  const ff = blockFontFamily(layout, blockId);
  return (
    <div
      className="flex flex-wrap items-center gap-1.5 mt-1.5 pt-1 border-t border-slate-100"
      data-testid={`einvoice-design-block-font-${blockId}`}
      style={{ fontFamily: "Tahoma, sans-serif", fontSize: "11px" }}
    >
      <label className="inline-flex items-center gap-1">
        <span className="text-[9px] font-bold text-slate-500">Yazı tipi</span>
        <select
          value={ff}
          onChange={(e) => { e.stopPropagation(); onFont?.(e.target.value); }}
          onClick={(e) => e.stopPropagation()}
          className="text-[9px] border border-slate-200 rounded px-1 py-0.5 bg-white max-w-[7.5rem]"
          data-testid={`einvoice-design-block-font-family-${blockId}`}
        >
          {FONT_OPTIONS.map((f) => (
            <option key={f.id} value={f.id}>{f.label}</option>
          ))}
        </select>
      </label>
      <div
        className="flex items-center flex-wrap gap-1"
        data-testid={blockId === "ettn" ? "einvoice-design-ettn-font-sizes" : `einvoice-design-block-font-sizes-${blockId}`}
      >
        <span className="text-[9px] font-bold text-slate-500">Punto</span>
        {BLOCK_FONT_SIZE_OPTIONS.map((opt) => (
          <button
            key={opt.size}
            type="button"
            title={`${opt.size} px`}
            onClick={(e) => { e.stopPropagation(); onFontSize?.(opt.size); }}
            className={`text-[9px] font-bold px-1.5 py-0.5 rounded border ${fs === opt.size ? "bg-slate-800 text-white border-slate-800" : "text-slate-600 border-slate-200 hover:bg-slate-100"}`}
            data-testid={
              blockId === "ettn"
                ? `einvoice-design-ettn-font-size-${opt.size}`
                : blockId === "meta"
                  ? `einvoice-design-font-size-${opt.size}`
                  : `einvoice-design-block-font-size-${blockId}-${opt.size}`
            }
          >
            {opt.label}
          </button>
        ))}
      </div>
    </div>
  );
};

const fileToDataUrl = (file) => new Promise((resolve, reject) => {
  const r = new FileReader();
  r.onload = () => resolve(String(r.result || ""));
  r.onerror = () => reject(r.error || new Error("read"));
  r.readAsDataURL(file);
});

const PartyCard = ({ title, p, kCls, vCls }) => (
  <div className="border rounded-lg p-2.5 min-h-[7rem]" style={{ borderColor: `${kCls}33` }}>
    <div className="font-bold uppercase tracking-wide" style={{ color: kCls, fontSize: "0.85em" }}>{title}</div>
    <div className="font-bold mt-0.5" style={{ color: vCls }}>{p.name}</div>
    <div className="leading-snug mt-0.5" style={{ fontSize: "0.92em" }}>{p.address}</div>
    <div className="mt-1" style={{ fontSize: "0.92em" }}>VKN/TCKN: {p.vkn}</div>
    <div style={{ fontSize: "0.92em" }}>VD: {p.taxOffice}</div>
  </div>
);

const lineCell = (ln, colId) => {
  if (colId === "unit") return unitLabel(ln.unit);
  if (colId === "desc") return ln.desc || ln.description || "";
  if (colId === "vat_amount") return ln.vat_amount || "";
  if (colId === "qty" && !ln._showUnit) {
    const u = unitLabel(ln.unit);
    return `${ln.qty}${u ? ` ${u}` : ""}`;
  }
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

const stopDrag = (e) => e.stopPropagation();

const STAMP_ALIGN_CLASS = {
  left: "items-start text-left",
  center: "items-center text-center",
  right: "items-end text-right",
};

const StampBlock = ({ layout, onPatch }) => {
  const fileRef = useRef(null);
  const [warn, setWarn] = useState("");
  const [busy, setBusy] = useState(false);
  const size = asStampSize(layout.stampSize);
  const align = asStampAlign(layout.stampAlign);
  const onFile = async (e) => {
    const raw = e.target.files?.[0];
    e.target.value = "";
    if (!raw) return;
    setBusy(true);
    try {
      const out = await prepareStampFile(raw, { knockoutWhite: !!layout.stampKnockoutWhite });
      if (!out || out.warning || !out.dataUrl) {
        setWarn(out?.warning || "Görsel eklenemedi.");
        return;
      }
      setWarn("");
      onPatch({ stampImage: out.dataUrl });
    } catch {
      setWarn("Görsel işlenemedi.");
    } finally {
      setBusy(false);
    }
  };
  return (
    <div className={`flex flex-col gap-1.5 ${STAMP_ALIGN_CLASS[align] || STAMP_ALIGN_CLASS.right}`} data-testid="einvoice-design-stamp">
      {layout.stampImage ? (
        <img
          src={layout.stampImage}
          alt="Kaşe / İmza"
          className="object-contain"
          style={{ width: size, height: "auto", maxWidth: "100%" }}
          data-testid="einvoice-design-stamp-img"
        />
      ) : (
        <div className="text-[10px] text-slate-400 border border-dashed rounded-md px-3 py-4">Kaşe / İmza</div>
      )}
      <div className="flex flex-wrap items-center gap-1" onMouseDown={stopDrag} onClick={stopDrag}>
        <input ref={fileRef} type="file" accept="image/png,image/jpeg,.png,.jpg,.jpeg" className="hidden" onChange={onFile} data-testid="einvoice-design-stamp-input" />
        <button type="button" disabled={busy} onClick={() => fileRef.current?.click()} className="text-[9px] font-bold px-1.5 py-0.5 rounded border border-slate-200 text-slate-700 hover:bg-slate-100 inline-flex items-center gap-1" data-testid="einvoice-design-stamp-upload">
          <ImagePlus className="w-3 h-3" /> {busy ? "İşleniyor…" : "Resim yükle"}
        </button>
        {layout.stampImage ? (
          <button type="button" onClick={() => { setWarn(""); onPatch({ stampImage: "" }); }} className="text-[9px] font-bold px-1.5 py-0.5 rounded border border-slate-200 text-slate-500 hover:bg-slate-100" data-testid="einvoice-design-stamp-clear">
            Resmi kaldır
          </button>
        ) : null}
        <label className="inline-flex items-center gap-1 text-[9px] font-semibold text-slate-600" data-testid="einvoice-design-stamp-knockout-label">
          <input
            type="checkbox"
            checked={!!layout.stampKnockoutWhite}
            onChange={(e) => onPatch({ stampKnockoutWhite: e.target.checked })}
            data-testid="einvoice-design-stamp-knockout"
          />
          Beyazı şeffaf yap
        </label>
      </div>
      <div className="flex items-center flex-wrap gap-1" data-testid="einvoice-design-stamp-sizes" onMouseDown={stopDrag}>
        <span className="text-[9px] font-bold text-slate-500">Boyut</span>
        {STAMP_SIZE_OPTIONS.map((opt) => (
          <button
            key={opt.size}
            type="button"
            title={`${opt.size} px`}
            onClick={(e) => { e.stopPropagation(); onPatch({ stampSize: opt.size }); }}
            className={`text-[9px] font-bold px-1.5 py-0.5 rounded border ${size === opt.size ? "bg-slate-800 text-white border-slate-800" : "text-slate-600 border-slate-200 hover:bg-slate-100"}`}
            data-testid={`einvoice-design-stamp-size-${opt.size}`}
          >
            {opt.label}
          </button>
        ))}
      </div>
      <div className="flex items-center flex-wrap gap-1" data-testid="einvoice-design-stamp-aligns" onMouseDown={stopDrag}>
        <span className="text-[9px] font-bold text-slate-500">Hiza</span>
        {STAMP_ALIGN_OPTIONS.map((opt) => (
          <button
            key={opt.id}
            type="button"
            onClick={(e) => { e.stopPropagation(); onPatch({ stampAlign: opt.id }); }}
            className={`text-[9px] font-bold px-1.5 py-0.5 rounded border ${align === opt.id ? "bg-slate-800 text-white border-slate-800" : "text-slate-600 border-slate-200 hover:bg-slate-100"}`}
            data-testid={`einvoice-design-stamp-align-${opt.id}`}
          >
            {opt.label}
          </button>
        ))}
      </div>
      {warn ? <p className="text-[10px] text-rose-700" data-testid="einvoice-design-stamp-warn">{warn}</p> : null}
    </div>
  );
};

const PreviewBlock = ({ id, layout, onPatch, onPatchCols, onPatchMeta, onPatchHeader, onPatchTotals, onQrSize, onLogoSize, drag, onDragStart, onDragOver, onDrop, onDragEnd }) => {
  const s = SAMPLE_INVOICE;
  if (id === "header") {
    const logoSize = Number(layout.logoSize) || 72;
    const headerFields = visibleHeaderFields(layout);
    const headerValue = (fid) => {
      if (fid === "supplier_name") return s.supplier.name;
      if (fid === "supplier_address") return s.supplier.address;
      if (fid === "supplier_vkn") return `VKN/TCKN: ${s.supplier.vkn}`;
      return "";
    };
    const classic = layout.preset === "classic_isnet";
    const logoNode = layout.logo ? (
      <img src={layout.logo} alt="logo" className="object-contain" style={{ height: logoSize, width: "auto", maxWidth: "100%" }} />
    ) : (
      <div className="text-[10px] text-slate-400 border border-dashed rounded-md px-2 py-3 inline-block">Logo</div>
    );
    return (
      <div className={`pb-2 space-y-1.5 ${classic ? "text-right" : ""}`} data-testid="einvoice-design-logo" style={{ borderBottom: `3px solid ${layout.accent}` }}>
        <div className={classic ? "inline-flex items-start justify-end gap-3" : ""}>
          {logoNode}
          {classic ? <div className="text-[10px] text-slate-400 border border-dashed rounded-md px-2 py-3" data-testid="einvoice-design-qr-mark">QR</div> : null}
        </div>
        {headerFields.map((f) => (
          <div
            key={f.id}
            className={f.id === "supplier_name" ? "text-base font-bold leading-tight" : "text-[10px] leading-snug"}
            style={f.id === "supplier_name" ? { color: layout.primary } : { color: layout.text }}
            data-testid={`einvoice-design-header-value-${f.id}`}
          >
            {headerValue(f.id)}
          </div>
        ))}
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
        <FieldChipsBar
          vis={headerFields}
          hid={hiddenHeaderFields(layout)}
          labels={HEADER_FIELD_LABELS}
          testPrefix="header"
          list={layout.headerFields}
          onPatch={onPatchHeader}
          drag={drag}
          onDragStart={onDragStart}
          onDragOver={onDragOver}
          onDrop={onDrop}
          onDragEnd={onDragEnd}
        />
      </div>
    );
  }
  if (id === "gib_seal_invoice" || id === "gib_seal_archive") {
    const sealKind = gibSealKindForBlock(id);
    const testId = sealKind === "e_archive" ? "einvoice-design-gib-seal-archive" : "einvoice-design-gib-seal-invoice";
    return (
      <div className="flex flex-col items-center justify-center py-1 text-center" data-testid={testId}>
        <img src={GIB_SEAL_JPEG_DATA_URL} alt={gibSealAlt(sealKind)} style={{ width: 91 }} />
        <div className="text-base font-bold mt-1" style={{ color: layout.primary }}>{gibSealCaption(sealKind)}</div>
      </div>
    );
  }
  if (id === "supplier") {
    return <PartyCard title="Satıcı" p={s.supplier} kCls={layout.muted} vCls={layout.primary} />;
  }
  if (id === "customer") {
    return <PartyCard title="Alıcı" p={s.customer} kCls={layout.muted} vCls={layout.primary} />;
  }
  if (id === "ettn") {
    const ettnFs = blockFontSize(layout, "ettn");
    return (
      <div data-testid="einvoice-design-ettn" className="flex items-baseline gap-2 flex-wrap" style={{ color: layout.text }}>
        <span className="font-bold whitespace-nowrap" style={{ color: layout.muted, fontSize: "0.85em", letterSpacing: "0.04em" }}>ETTN</span>
        <span className="break-all leading-tight" style={{ fontSize: `${ettnFs}px`, color: layout.primary }}>{s.ettn}</span>
      </div>
    );
  }
  if (id === "meta") {
    const fields = visibleMetaFields(layout);
    const filled = filledMetaFields(layout, s);
    return (
      <div>
        <table
          className="w-full border-collapse"
          style={{ fontSize: "1em", fontWeight: 400, color: layout.text, borderBottom: `1px solid ${layout.muted}33` }}
          data-testid="einvoice-design-meta-grid"
        >
          <tbody>
            {filled.map((f) => (
              <tr key={f.id} data-testid={`einvoice-design-meta-row-${f.id}`}>
                <td className="align-top whitespace-nowrap pr-2 py-px font-normal">{META_FIELD_LABELS[f.id]}:</td>
                <td className="align-top py-px font-normal">{sampleMetaValue(f.id, s)}</td>
              </tr>
            ))}
          </tbody>
        </table>
        <p className="text-[9px] text-slate-500 mt-1" data-testid="einvoice-design-meta-empty-hint">
          Gerçek faturada boş alanlar gizlenir; kalan satırlar sırayı koruyarak yukarı kayar.
        </p>
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
    const anyDesc = (s.lines || []).some((ln) => String(ln.desc || ln.description || "").trim());
    const cols = visibleLineCols(layout).filter((c) => c.id !== "desc" || anyDesc);
    const unitOn = cols.some((c) => c.id === "unit");
    return (
      <div>
        <div className="overflow-x-auto">
          <table className="w-full text-[0.9em]">
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
          <table className="min-w-[14rem]" style={{ fontSize: "1em" }}>
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
                    <td className="text-right whitespace-nowrap">{s[TOTAL_ROW_SAMPLE_KEY[r.id] || r.id]} {s.currency || "TL"}</td>
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
    const notes = previewNotes(layout, s);
    return (
      <div className="pt-2" style={{ borderTop: `1px dashed ${layout.muted}55`, color: layout.muted }}>
        <div className="font-bold uppercase mb-0.5" style={{ fontSize: "0.85em" }}>{layout.notesTitle || "Notlar"}</div>
        {notes.map((n) => <div key={n}>{n}</div>)}
        <textarea
          value={layout.noteText || ""}
          onChange={(e) => onPatch({ noteText: e.target.value })}
          onMouseDown={stopDrag}
          draggable={false}
          rows={2}
          placeholder="Her e-belgede basılacak dipnot…"
          className="mt-1.5 w-full bg-white border border-slate-200 rounded-lg p-1.5 text-[11px] text-slate-800"
          data-testid="einvoice-design-note-text"
        />
        <p className="text-[9px] text-slate-500 mt-1" data-testid="einvoice-design-note-hint">
          Satış faturasındaki «Fatura notu» da basılır. Buraya yazılan metin her belgede eklenir.
        </p>
      </div>
    );
  }
  if (id === "iban") {
    const pay = previewIban(layout, s);
    return (
      <div className="h-full pt-2" style={{ borderTop: `1px dashed ${layout.muted}55`, color: layout.muted, background: "transparent" }}>
        <div className="font-bold uppercase mb-0.5" style={{ fontSize: "0.85em" }}>{layout.ibanTitle || "IBAN / ödeme"}</div>
        <div className="font-mono">{pay.iban}</div>
        {pay.name ? <div>{pay.name}</div> : null}
        <input
          value={layout.ibanText || ""}
          onChange={(e) => onPatch({ ibanText: e.target.value })}
          onMouseDown={stopDrag}
          draggable={false}
          placeholder="TR… şablon IBAN"
          className="mt-1.5 w-full bg-white border border-slate-200 rounded-lg p-1.5 font-mono text-[11px] text-slate-800"
          data-testid="einvoice-design-iban-text"
        />
        <input
          value={layout.ibanName || ""}
          onChange={(e) => onPatch({ ibanName: e.target.value })}
          onMouseDown={stopDrag}
          draggable={false}
          placeholder="Banka adı (isteğe bağlı)"
          className="mt-1 w-full bg-white border border-slate-200 rounded-lg p-1.5 text-[11px] text-slate-800"
          data-testid="einvoice-design-iban-name"
        />
        <p className="text-[9px] text-slate-500 mt-1" data-testid="einvoice-design-iban-hint">
          Boş bırakılırsa şirket kartındaki IBAN (Ayarlar → Şirket) basılır.
        </p>
      </div>
    );
  }
  if (id === "balance") {
    return (
      <div className="h-full pt-2" data-testid="einvoice-design-balance" style={{ borderTop: `1px dashed ${layout.muted}55`, color: layout.muted, background: "transparent" }}>
        <div className="font-bold uppercase mb-0.5" style={{ fontSize: "0.85em" }}>Güncel bakiye</div>
        <div>{s.balance}</div>
      </div>
    );
  }
  if (id === "stamp") {
    return <StampBlock layout={layout} onPatch={onPatch} />;
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
  if (id === "spacer") {
    return (
      <div
        className="min-h-[3.5rem] rounded-md border border-dashed flex items-center justify-center text-[9px] font-bold uppercase tracking-wide"
        style={{ borderColor: `${layout.muted}55`, color: layout.muted }}
        data-testid="einvoice-design-spacer"
      >
        Boş alan
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
  const [overStack, setOverStack] = useState(null);
  const [overPalette, setOverPalette] = useState(false);
  const [placeFor, setPlaceFor] = useState("");
  const [paperMode, setPaperMode] = useState(preferXsltPreview && xsltHtml ? "xslt" : "layout");
  const [realXmlHtml, setRealXmlHtml] = useState("");
  const [realXmlErr, setRealXmlErr] = useState("");
  const visible = L.blocks.filter((b) => !b.hidden);
  const rows = packBlockRows(L.blocks);
  const hidden = L.blocks.filter((b) => b.hidden);
  const hiddenCols = hiddenLineCols(L);
  const hiddenMeta = hiddenMetaFields(L);
  const hiddenHeader = hiddenHeaderFields(L);
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
  const patchHeader = (headerFields) => patch({ headerFields });
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
  const clearDrag = () => { setDragId(""); setOverId(""); setOverStack(null); setOverPalette(false); };
  const isBlockDrag = (from) => from && !isLineCol(from) && !isMetaField(from) && !isHeaderField(from) && !isTotalRow(from);
  const onDragOverStack = (id, place) => (e) => {
    if (!isBlockDrag(dragId) || dragId === id) return;
    e.preventDefault();
    e.stopPropagation();
    e.dataTransfer.dropEffect = "move";
    setOverStack({ id, place });
    setOverId("");
  };
  const onDropStack = (targetId, place) => (e) => {
    e.preventDefault();
    e.stopPropagation();
    const from = dragId || e.dataTransfer.getData("text/plain");
    clearDrag();
    if (!isBlockDrag(from) || from === targetId) return;
    const blocks = setBlockHidden(L.blocks, from, false);
    patchBlocks(stackBlock(blocks, from, targetId, place));
  };

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
    if (isHeaderField(from)) {
      let fields = L.headerFields;
      if (asVisible || isHeaderField(targetId) || targetId === "header") fields = setBlockHidden(fields, from, false);
      if (isHeaderField(targetId)) fields = moveBlock(fields, from, targetId);
      patchHeader(fields);
      return;
    }
    if (isTotalRow(from)) {
      let rows = L.totalRows;
      if (asVisible || isTotalRow(targetId) || targetId === "totals") rows = setBlockHidden(rows, from, false);
      if (isTotalRow(targetId)) rows = moveBlock(rows, from, targetId);
      patchTotals(rows);
      return;
    }
    if (isLineCol(targetId) || isMetaField(targetId) || isHeaderField(targetId) || isTotalRow(targetId)) return;
    let blocks = L.blocks;
    if (asVisible) blocks = setBlockHidden(blocks, from, false);
    blocks = detachFromColumn(blocks, from);
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
    else if (isHeaderField(from)) patchHeader(setBlockHidden(L.headerFields, from, true));
    else if (isTotalRow(from)) patchTotals(setBlockHidden(L.totalRows, from, true));
    else patchBlocks(setBlockHidden(L.blocks, from, true));
  };

  const onRealXml = () => {
    try {
      const xslt = layoutToXslt(L, kind);
      const html = transformXsltToHtml(xslt);
      if (!html) {
        setRealXmlHtml("");
        setRealXmlErr("Gerçek XML önizlemesi bu tarayıcıda üretilemedi.");
      } else {
        setRealXmlErr("");
        setRealXmlHtml(html);
      }
      setPaperMode("real");
    } catch (err) {
      setRealXmlHtml("");
      setRealXmlErr(err?.message || "XSLT üretilemedi.");
      setPaperMode("real");
    }
  };

  const onLogo = async (e) => {
    const raw = e.target.files?.[0];
    e.target.value = "";
    if (!raw) return;
    try {
      const file = await compressImageFile(raw, { maxEdge: 480, quality: 0.78, targetBytes: 80 * 1024, force: true, preferJpeg: true });
      const data = await fileToDataUrl(file);
      patch({ logo: data });
    } catch {
      /* ignore */
    }
  };

  const sharesColumn = (id) => {
    const anchor = columnAnchorId(L.blocks, id);
    return L.blocks.some((b) => !b.hidden && b.id !== id && columnAnchorId(L.blocks, b.id) === anchor);
  };

  const renderBlock = (b, stacked) => (
    <div
      key={b.id}
      draggable
      onDragStart={onDragStart(b.id)}
      onDragOver={onDragOverItem(b.id)}
      onDrop={onDropItem(b.id, true)}
      onDragEnd={clearDrag}
      className={`relative rounded-lg p-1.5 ${stacked ? "pt-6" : "pt-6 h-full"} flex flex-col ${stacked ? "" : (SPAN_CLASS[b.span] || "col-span-12")} ${dragId === b.id ? "opacity-40" : ""} ${overId === b.id && dragId !== b.id && overStack?.id !== b.id ? "ring-2 ring-emerald-400" : "ring-1 ring-slate-200/80 hover:ring-slate-300"}`}
      data-testid={`einvoice-design-block-${b.id}`}
    >
      {dragId && dragId !== b.id && isBlockDrag(dragId) ? (
        <>
          <div
            data-testid={`einvoice-design-drop-above-${b.id}`}
            title="Üstüne yerleştir"
            onDragOver={onDragOverStack(b.id, "above")}
            onDrop={onDropStack(b.id, "above")}
            className={`absolute left-0 right-0 top-0 h-4 z-20 text-[8px] font-bold flex items-center justify-center ${overStack?.id === b.id && overStack.place === "above" ? "bg-emerald-600 text-white" : "bg-emerald-100/90 text-emerald-800"}`}
          >
            Üstüne yerleştir
          </div>
          <div
            data-testid={`einvoice-design-drop-below-${b.id}`}
            title="Altına yerleştir"
            onDragOver={onDragOverStack(b.id, "below")}
            onDrop={onDropStack(b.id, "below")}
            className={`absolute left-0 right-0 bottom-0 h-4 z-20 text-[8px] font-bold flex items-center justify-center ${overStack?.id === b.id && overStack.place === "below" ? "bg-emerald-600 text-white" : "bg-emerald-100/90 text-emerald-800"}`}
          >
            Altına yerleştir
          </div>
        </>
      ) : null}
      <div className="absolute top-0.5 left-1 right-1 z-10 flex items-center gap-0.5 min-w-0">
        <GripVertical className="w-3.5 h-3.5 text-slate-300 cursor-grab shrink-0" />
        <span className="text-[9px] font-bold text-slate-400 px-1 cursor-grab truncate">{BLOCK_LABELS[b.id]}</span>
        <span className="flex-1" />
        <button
          type="button"
          title="Üstüne/altına yerleştir"
          draggable={false}
          onMouseDown={stopDrag}
          onClick={(e) => { e.stopPropagation(); setPlaceFor((cur) => (cur === b.id ? "" : b.id)); }}
          className="text-[8px] font-bold px-1 py-0.5 rounded border border-slate-200 bg-white text-slate-600"
          data-testid={`einvoice-design-place-${b.id}`}
        >
          Üstüne/altına
        </button>
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
      {placeFor === b.id ? (
        <div
          className="absolute right-1 top-6 z-30 max-h-36 overflow-auto rounded border border-slate-200 bg-white shadow-md p-1 space-y-0.5"
          data-testid={`einvoice-design-place-menu-${b.id}`}
          onMouseDown={stopDrag}
          onClick={stopDrag}
        >
          {sharesColumn(b.id) ? (
            <button
              type="button"
              className="block w-full text-left text-[9px] font-bold px-1 py-0.5 rounded hover:bg-slate-100 text-slate-700"
              data-testid={`einvoice-design-place-${b.id}-detach`}
              onClick={() => { patchBlocks(detachFromColumn(L.blocks, b.id)); setPlaceFor(""); }}
            >
              Kendi sütunu
            </button>
          ) : null}
          {visible.filter((o) => o.id !== b.id).map((o) => (
            <div key={o.id} className="flex gap-1">
              <button
                type="button"
                className="text-[8px] font-bold px-1 py-0.5 rounded border border-slate-200 hover:bg-emerald-50"
                data-testid={`einvoice-design-place-${b.id}-above-${o.id}`}
                onClick={() => { patchBlocks(stackBlock(L.blocks, b.id, o.id, "above")); setPlaceFor(""); }}
              >
                {`Üstüne yerleştir: ${BLOCK_LABELS[o.id] || o.id}`}
              </button>
              <button
                type="button"
                className="text-[8px] font-bold px-1 py-0.5 rounded border border-slate-200 hover:bg-emerald-50"
                data-testid={`einvoice-design-place-${b.id}-below-${o.id}`}
                onClick={() => { patchBlocks(stackBlock(L.blocks, b.id, o.id, "below")); setPlaceFor(""); }}
              >
                {`Altına yerleştir: ${BLOCK_LABELS[o.id] || o.id}`}
              </button>
            </div>
          ))}
        </div>
      ) : null}
      <div
        className={b.id === "iban" || b.id === "balance" ? "flex-1" : undefined}
        style={blockHasFont(b.id) ? {
          fontFamily: `"${blockFontFamily(L, b.id)}", Tahoma, sans-serif`,
          fontSize: `${blockFontSize(L, b.id)}px`,
        } : undefined}
      >
        <PreviewBlock
          id={b.id}
          layout={L}
          onPatch={patch}
          onPatchCols={patchCols}
          onPatchMeta={patchMeta}
          onPatchHeader={patchHeader}
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
      <BlockFontBar
        blockId={b.id}
        layout={L}
        onFont={(font) => patchBlocks(setBlockFont(L.blocks, b.id, font))}
        onFontSize={(size) => {
          const blocks = setBlockFontSize(L.blocks, b.id, size);
          if (b.id === "ettn") patch({ blocks, ettnFontSize: size });
          else patch({ blocks });
        }}
      />
    </div>
  );

  return (
    <div className="space-y-3" data-testid="einvoice-design-canvas">
      <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 gap-2">
        <label className="block">
          <span className="block font-semibold mb-1">Varsayılan yazı tipi</span>
          <select value={L.font} onChange={(e) => patch({ font: e.target.value })} className={inputCls} data-testid="einvoice-design-font">
            {FONT_OPTIONS.map((f) => <option key={f.id} value={f.id}>{f.label}</option>)}
          </select>
        </label>
        <label className="block">
          <span className="block font-semibold mb-1">Varsayılan punto</span>
          <select value={L.fontSize} onChange={(e) => patch({ fontSize: Number(e.target.value) })} className={inputCls} data-testid="einvoice-design-font-size">
            {FONT_SIZE_OPTIONS.map((f) => <option key={f.size} value={f.size}>{f.label} px</option>)}
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
          <div className="text-[10px] font-bold uppercase tracking-wide text-slate-500 px-1 pt-2">Logo alanları</div>
          {hiddenHeader.length === 0 ? <p className="text-[11px] text-slate-400 px-1">Logo altındaki satıcı alanları açık.</p> : null}
          {hiddenHeader.map((c) => (
            <div
              key={c.id}
              draggable
              onDragStart={onDragStart(c.id)}
              onDragEnd={clearDrag}
              className={`flex items-center gap-1 bg-white border rounded-lg px-2 py-1.5 cursor-grab active:cursor-grabbing ${dragId === c.id ? "opacity-40" : ""}`}
              data-testid={`einvoice-design-palette-header-${c.id}`}
            >
              <GripVertical className="w-3.5 h-3.5 text-slate-300 shrink-0" />
              <span className="flex-1 font-semibold text-slate-700">{HEADER_FIELD_LABELS[c.id]}</span>
              <button type="button" onClick={() => patchHeader(setBlockHidden(L.headerFields, c.id, false))} className="text-[10px] font-bold text-emerald-700 px-1.5 py-0.5 border border-emerald-200 rounded" data-testid={`einvoice-design-show-header-${c.id}`}>
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
            <div className="text-[10px] text-slate-500 font-semibold">Önizleme (örnek veri) — en: Tam / 1/2 / 1/3. Aynı sütuna yığmak için Üstüne/altına yerleştir veya sürükleyip bırakın.</div>
            <div className="flex gap-1 bg-slate-100 rounded-lg p-0.5" data-testid="einvoice-design-paper-tabs">
              <button type="button" onClick={() => setPaperMode("layout")} className={`px-2 py-1 rounded-md font-semibold ${paperMode === "layout" ? "bg-white shadow-sm" : "text-slate-500"}`} data-testid="einvoice-design-paper-layout">Düzenleyici</button>
              <button type="button" onClick={onRealXml} className={`px-2 py-1 rounded-md font-semibold ${paperMode === "real" ? "bg-white shadow-sm" : "text-slate-500"}`} data-testid="einvoice-design-preview-real-xml">Önizle (gerçek XML)</button>
              {xsltHtml ? (
                <button type="button" onClick={() => setPaperMode("xslt")} className={`px-2 py-1 rounded-md font-semibold ${paperMode === "xslt" ? "bg-white shadow-sm" : "text-slate-500"}`} data-testid="einvoice-design-paper-xslt">Yüklenen XSLT</button>
              ) : null}
            </div>
          </div>
          {paperMode === "real" ? (
            realXmlHtml ? (
              <iframe
                title="Gerçek XML önizleme"
                srcDoc={realXmlHtml}
                sandbox="allow-same-origin"
                className="w-full min-h-[22rem] h-[36rem] rounded-xl border shadow-sm bg-white"
                data-testid="einvoice-design-preview"
              />
            ) : (
              <p className="text-[11px] text-rose-800 bg-rose-50 border border-rose-200 rounded-lg px-2.5 py-1.5" data-testid="einvoice-design-real-xml-error">
                {realXmlErr || "Gerçek XML önizlemesi üretilemedi."}
              </p>
            )
          ) : paperMode === "xslt" && xsltHtml ? (
            <iframe
              title="Yüklenen XSLT önizleme"
              srcDoc={xsltHtml}
              sandbox="allow-same-origin"
              className="w-full min-h-[22rem] h-[36rem] rounded-xl border shadow-sm bg-white"
              data-testid="einvoice-design-preview"
            />
          ) : (
          <div
            className="rounded-xl border shadow-sm p-4 min-h-[22rem] flex flex-col gap-2"
            style={{ background: L.paper, color: L.text, fontFamily: `"${L.font}", Tahoma, sans-serif`, fontSize: `${L.fontSize}px` }}
            data-testid="einvoice-design-preview"
          >
            {rows.length === 0 ? <p className="text-slate-400 text-center py-10">Paletten bölüm ekleyin.</p> : null}
            {rows.map((row, ri) => (
              <div
                key={row.map((c) => (c.column || [c]).map((m) => m.id).join("+")).join("|")}
                className="grid grid-cols-12 gap-2 items-stretch"
                data-testid={`einvoice-design-row-${ri}`}
              >
                {row.map((cell) => {
                  const members = cell.column?.length ? cell.column : [cell];
                  if (members.length === 1) return renderBlock(members[0], false);
                  const colKey = members.map((m) => m.id).join("-");
                  return (
                    <div
                      key={colKey}
                      className={`${SPAN_CLASS[cell.span] || "col-span-12"} flex flex-col gap-1 h-full min-h-0 justify-start`}
                      data-testid={`einvoice-design-column-${colKey}`}
                    >
                      {members.map((m) => renderBlock(m, true))}
                    </div>
                  );
                })}
              </div>
            ))}
          </div>
          )}
        </div>
      </div>
    </div>
  );
};
