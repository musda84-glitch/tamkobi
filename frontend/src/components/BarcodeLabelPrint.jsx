import React, { useEffect, useMemo, useRef, useState } from "react";
import { useEscape } from "../utils/useEscape";
import JsBarcode from "jsbarcode";
import { QRCodeSVG } from "qrcode.react";
import { Printer, X, Tag } from "lucide-react";
import { resolveImageUrl } from "../utils/imageUrl";

const SIZES = [
  { key: "40x20", label: "40 × 20 mm (Raf)", w: 40, h: 20, img: false },
  { key: "50x30", label: "50 × 30 mm (Standart)", w: 50, h: 30, img: true },
  { key: "60x40", label: "60 × 40 mm (Resimli)", w: 60, h: 40, img: true },
  { key: "100x30", label: "100 × 30 mm (Geniş)", w: 100, h: 30, img: true },
  { key: "100x50", label: "100 × 50 mm (Büyük)", w: 100, h: 50, img: true }
];

const Check = ({ k, label, opts, setOpts }) => (
  <label className="flex items-center gap-1.5 text-xs text-slate-700 cursor-pointer"><input type="checkbox" checked={opts[k]} onChange={(e) => setOpts({ ...opts, [k]: e.target.checked })} className="rounded" data-testid={`label-opt-${k}`} /> {label}</label>
);

const isEan13 = (c) => /^\d{13}$/.test(c) && (10 - (c.slice(0, 12).split("").reduce((s, d, i) => s + Number(d) * (i % 2 ? 3 : 1), 0) % 10)) % 10 === Number(c[12]);

export const Barcode = ({ value, height = 40, width = 1.6, fontSize = 11, displayValue = true, className = "max-w-full" }) => {
  const ref = useRef(null);
  const showText = displayValue && fontSize > 0;
  useEffect(() => {
    if (!ref.current || !value) return;
    try {
      JsBarcode(ref.current, String(value), {
        format: isEan13(String(value)) ? "EAN13" : "CODE128",
        height, width, fontSize: showText ? fontSize : 0,
        margin: 0, displayValue: showText, textMargin: showText ? 1 : 0, font: "monospace"
      });
    } catch { /* invalid code */ }
  }, [value, height, width, fontSize, showText]);
  return <svg ref={ref} className={className} />;
};

export const BarcodeLabelPrint = ({ product, company, onClose }) => {
  useEscape(onClose);
  const targets = useMemo(() => [{ id: "main", name: product.name, sku: product.sku, barcode: product.barcode, price: product.sale_price, image_url: product.image_url, tags: product.tags || [] },
    ...(product.variants || []).map((v) => ({ id: v.variant_id || v.sku, name: `${product.name} - ${v.name}`, sku: v.sku, barcode: v.barcode, price: v.sale_price ?? product.sale_price, image_url: v.image_url || product.image_url, tags: product.tags || [] }))], [product]);
  const [target, setTarget] = useState(targets[0]);
  const [size, setSize] = useState(SIZES[1]);
  const [copies, setCopies] = useState(4);
  const [extra, setExtra] = useState("");
  const [opts, setOpts] = useState({ name: true, price: true, sku: true, image: true, company: true, tags: false, qr: false, extra: false });
  const fmt = (n) => (n || 0).toLocaleString("tr-TR", { minimumFractionDigits: 2 }) + " ₺";
  const showImg = opts.image && size.img && target.image_url;
  const labelProps = { t: target, size, opts, showImg, company, fmt, extra };

  return (
    <div className="fixed inset-0 z-[80] bg-slate-900/70 flex items-start justify-center p-4 overflow-y-auto print:p-0 print:bg-white print:static">
      <div className="bg-white w-full max-w-4xl rounded-2xl shadow-2xl print:shadow-none print:rounded-none" data-testid="barcode-label-modal">
        <div className="flex items-center justify-between px-5 py-3 border-b no-print">
          <div className="flex items-center gap-2"><Tag className="w-4 h-4 text-emerald-600" /><h3 className="text-sm font-bold text-slate-900">Barkod Etiketi Yazdır</h3></div>
          <div className="flex items-center gap-2">
            <button onClick={() => window.print()} className="flex items-center gap-1 px-3 py-1.5 bg-slate-900 text-white rounded-lg text-xs font-semibold" data-testid="label-print-btn"><Printer className="w-3.5 h-3.5" /> Yazdır ({copies} adet)</button>
            <button onClick={onClose} className="text-slate-400 hover:text-slate-700" data-testid="label-close-btn"><X className="w-5 h-5" /></button>
          </div>
        </div>
        <div className="grid grid-cols-1 md:grid-cols-3 gap-0 no-print">
          <div className="p-5 space-y-3 border-r text-xs">
            {targets.length > 1 && (
              <div><label className="block font-semibold text-slate-700 mb-1">Ürün / Varyant</label>
                <select value={target.id} onChange={(e) => setTarget(targets.find((t) => t.id === e.target.value))} className="w-full bg-slate-50 border border-slate-200 rounded-lg p-2" data-testid="label-target-select">{targets.map((t) => <option key={t.id} value={t.id}>{t.name} ({t.barcode || "barkod yok"})</option>)}</select></div>
            )}
            <div><label className="block font-semibold text-slate-700 mb-1">Etiket Boyutu</label>
              <select value={size.key} onChange={(e) => setSize(SIZES.find((s) => s.key === e.target.value))} className="w-full bg-slate-50 border border-slate-200 rounded-lg p-2" data-testid="label-size-select">{SIZES.map((s) => <option key={s.key} value={s.key}>{s.label}</option>)}</select></div>
            <div><label className="block font-semibold text-slate-700 mb-1">Adet</label>
              <input type="number" min="1" max="200" value={copies} onChange={(e) => setCopies(Math.max(1, Math.min(200, Number(e.target.value) || 1)))} className="w-full bg-slate-50 border border-slate-200 rounded-lg p-2 font-bold" data-testid="label-copies-input" /></div>
            <div className="space-y-1.5 pt-2 border-t">
              <div className="font-semibold text-slate-700">Etikette Göster</div>
              <Check k="name" label="Ürün adı" opts={opts} setOpts={setOpts} />
              <Check k="price" label="Satış fiyatı" opts={opts} setOpts={setOpts} />
              <Check k="sku" label="Stok kodu (SKU)" opts={opts} setOpts={setOpts} />
              <Check k="image" label={`Ürün resmi${size.img ? "" : " (bu boyutta yok)"}`} opts={opts} setOpts={setOpts} />
              <Check k="company" label="Firma adı" opts={opts} setOpts={setOpts} />
              <Check k="qr" label="QR kod (barkod yanında)" opts={opts} setOpts={setOpts} />
              <Check k="tags" label={`Ürün etiketleri${target.tags.length ? ` (${target.tags.join(", ")})` : " (yok)"}`} opts={opts} setOpts={setOpts} />
              <Check k="extra" label="Ek satır" opts={opts} setOpts={setOpts} />
              {opts.extra && <input value={extra} onChange={(e) => setExtra(e.target.value)} placeholder="Örn: Beden: L • Renk: Siyah • 2 yıl garanti" className="w-full bg-slate-50 border border-slate-200 rounded-lg p-2" data-testid="label-extra-input" />}
            </div>
            {!target.barcode && <div className="text-rose-600 font-semibold">Bu ürünün barkodu yok — önce stok kartından barkod üretin.</div>}
          </div>
          <div className="md:col-span-2 p-6 bg-slate-100 flex items-center justify-center min-h-[320px] overflow-hidden">
            <div className={size.w >= 100 ? "scale-[1.6] origin-center" : "scale-[2] origin-center"}><Label {...labelProps} /></div>
          </div>
        </div>
        <div id="print-area" className="hidden print:block">
          <div className="flex flex-wrap gap-[2mm] p-[3mm]">
            {Array.from({ length: copies }).map((_, i) => <Label key={i} {...labelProps} />)}
          </div>
        </div>
      </div>
    </div>
  );
};

const Label = ({ t, size, opts, showImg, company, fmt, extra }) => {
  const big = size.h >= 40;
  const wide = size.w >= 100;
  const qrSize = Math.round(size.h * 0.42);
  const barH = Math.round(size.h * (showImg || opts.qr ? 1.15 : 1.4));
  const tagText = opts.tags && t.tags?.length ? t.tags.join(" • ") : "";
  return (
    <div style={{ width: `${size.w}mm`, height: `${size.h}mm`, fontFamily: "Inter, Helvetica, Arial, sans-serif" }} className="bg-white border border-dashed border-slate-300 print:border-slate-200 rounded-[1mm] flex flex-col overflow-hidden text-slate-900 break-inside-avoid" data-testid="barcode-label">
      {opts.company && company?.name && (
        <div className="bg-slate-900 text-white px-[1.5mm] flex items-center justify-between shrink-0" style={{ height: "3.2mm" }}>
          <span className="text-[4.5pt] font-bold tracking-wide uppercase truncate">{company.name}</span>
          {opts.sku && <span className="text-[4.5pt] font-mono opacity-80">{t.sku}</span>}
        </div>
      )}
      <div className="flex-1 min-h-0 flex gap-[1.5mm] p-[1.2mm]">
        {showImg && <div className="shrink-0 h-full rounded-[0.8mm] border border-slate-200 overflow-hidden bg-white" style={{ width: `${Math.round(size.w * (wide ? 0.18 : 0.26))}mm` }}><img src={resolveImageUrl(t.image_url)} alt="" className="w-full h-full object-contain" /></div>}
        <div className="flex-1 min-w-0 flex flex-col justify-between leading-none">
          <div className="space-y-[0.4mm]">
            {opts.name && <div className={`font-bold leading-tight ${big ? "text-[8pt]" : wide ? "text-[7pt]" : "text-[6pt]"} ${big ? "line-clamp-2" : "truncate"}`}>{t.name}</div>}
            {opts.sku && !(opts.company && company?.name) && <div className="font-mono text-[5pt] text-slate-500 truncate">{t.sku}</div>}
            {tagText && <div className="text-[4.5pt] text-slate-600 truncate">{tagText}</div>}
            {opts.extra && extra && <div className="text-[4.5pt] text-slate-600 truncate">{extra}</div>}
          </div>
          <div className="flex items-end gap-[1.5mm]">
            <div className="flex-1 min-w-0 flex justify-start"><Barcode value={t.barcode || t.sku || "0000000000000"} height={barH} width={wide ? 1.4 : big ? 1.3 : 1} fontSize={big || wide ? 9 : 7} /></div>
            {opts.qr && <div className="shrink-0 bg-white"><QRCodeSVG value={t.barcode || t.sku || ""} size={qrSize * 3.78} style={{ width: `${qrSize}mm`, height: `${qrSize}mm` }} level="M" /></div>}
          </div>
        </div>
        {opts.price && (
          <div className="shrink-0 flex flex-col items-end justify-end">
            <div className={`font-black tracking-tight leading-none ${big || wide ? "text-[11pt]" : "text-[8pt]"}`}>{fmt(t.price)}</div>
            <div className="text-[4pt] text-slate-400 uppercase">KDV Dahil</div>
          </div>
        )}
      </div>
    </div>
  );
};
