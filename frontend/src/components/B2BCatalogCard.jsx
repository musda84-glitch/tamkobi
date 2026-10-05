import React, { memo, useEffect, useState } from "react";
import { Check, Package, ShoppingCart } from "lucide-react";
import { resolveImageUrl } from "../utils/imageUrl";
import { fmt, b2bGross } from "./B2BPortalParts";
import { catalogAddChrome } from "../utils/b2bCart";
import { parseDraftQty, qtyDraftAfterAdd, qtyDraftOnBlur, qtyDraftOnFocus } from "../utils/b2bSearch";

/** Tek ürün kartı: not/adet yerel — yazınca tüm ızgara yeniden boyanmaz. */
export const B2BCatalogCard = memo(function B2BCatalogCard({
  product: p,
  showPrices,
  showStock,
  allowOrders,
  inCart = 0,
  onAdd,
}) {
  const [qty, setQty] = useState("1");
  const [note, setNote] = useState("");
  useEffect(() => {
    setQty("1");
    setNote("");
  }, [p.id]);

  const addOk = !(showStock && !p.in_stock);
  const listCut = showPrices && b2bGross(p) < b2bGross(p, "list_price");
  const addChrome = catalogAddChrome(inCart);
  const handleAdd = () => {
    onAdd?.(p, parseDraftQty(qty), String(note || "").trim());
    setQty(qtyDraftAfterAdd());
  };

  return (
    <div
      className="bg-white rounded-2xl border p-2.5 sm:p-3 flex flex-col gap-2 min-w-0 [content-visibility:auto] [contain-intrinsic-size:auto_280px]"
      data-testid={`b2b-product-${p.sku}`}
    >
      <div className="relative aspect-[3/2] bg-slate-50 rounded-xl flex items-center justify-center overflow-hidden" data-testid={`b2b-image-${p.sku}`}>
        {p.image_url
          ? <img src={resolveImageUrl(p.image_url)} alt="" loading="lazy" decoding="async" className="absolute inset-0 h-full w-full object-contain" />
          : <Package className="w-8 h-8 text-slate-300" />}
        {addChrome.inCart ? (
          <span
            className="absolute top-1.5 right-1.5 inline-flex items-center gap-0.5 min-h-[22px] px-1.5 rounded-full bg-slate-800 text-white text-[10px] font-black shadow"
            data-testid={`b2b-in-cart-${p.sku}`}
          >
            <Check className="w-3 h-3" /> {addChrome.qty}
          </span>
        ) : null}
      </div>
      <div className="min-w-0">
        <div className="text-xs font-bold text-slate-900 leading-tight line-clamp-2">{p.name}</div>
        <div className="text-[10px] text-slate-400 font-mono truncate">{p.sku}{p.barcode ? ` · ${p.barcode}` : ""}</div>
        {Array.isArray(p.tags) && p.tags.length > 0 && (
          <div className="flex flex-wrap gap-0.5 mt-0.5">
            {p.tags.slice(0, 3).map((t) => (
              <span key={t} className="text-[9px] px-1 py-0 rounded bg-slate-100 text-slate-500">{t}</span>
            ))}
          </div>
        )}
      </div>
      <div className="flex items-end justify-between gap-1">
        <div className="min-w-0">
          <div className="text-base font-black text-slate-900 whitespace-nowrap" data-testid={`b2b-price-${p.sku}`}>
            {showPrices ? `${fmt(b2bGross(p))} ₺` : "—"}
          </div>
          {listCut && (
            <div className="text-[10px] text-slate-400 line-through">{fmt(b2bGross(p, "list_price"))} ₺</div>
          )}
          <div className="text-[10px] text-slate-400">
            {showPrices ? (Number(p.vat_rate) ? `KDV %${p.vat_rate} dahil` : "KDV'siz") : "Fiyat gizli"} • {p.unit}
          </div>
        </div>
        {showStock && (
          <span className={`text-[10px] font-semibold shrink-0 ${p.in_stock ? "text-emerald-600" : "text-rose-600"}`} data-testid={`b2b-stock-${p.sku}`}>
            {p.in_stock ? "Stokta" : "Yok"}
          </span>
        )}
      </div>
      {allowOrders && (
        <>
          <label className="block">
            <span className="block text-[9px] font-semibold text-slate-500 mb-0.5">Sipariş stok notu</span>
            <textarea
              rows={1}
              value={note}
              onChange={(e) => setNote(e.target.value)}
              placeholder="Fişte stok açıklamasının altında basılır"
              className="w-full min-h-[2rem] border rounded-lg px-2 py-1 text-[10px] text-slate-700 resize-none bg-slate-50"
              data-testid={`b2b-item-note-${p.sku}`}
            />
          </label>
          <div className="flex items-stretch gap-1.5 mt-auto">
            <label className="flex flex-col items-stretch justify-center w-12 shrink-0 rounded-xl border-2 border-slate-300 bg-slate-50 px-0.5">
              <span className="text-[8px] font-semibold text-slate-400 text-center leading-none pt-0.5">Adet</span>
              <input
                type="text"
                inputMode="numeric"
                pattern="[0-9]*"
                value={qty}
                onChange={(e) => setQty(e.target.value.replace(/\D/g, ""))}
                onFocus={() => setQty(qtyDraftOnFocus())}
                onBlur={() => setQty(qtyDraftOnBlur(qty))}
                onKeyDown={(e) => {
                  if (e.key === "Enter") handleAdd();
                }}
                className="w-full bg-transparent text-center font-black text-sm text-slate-900 py-0.5 outline-none"
                data-testid={`b2b-add-qty-${p.sku}`}
                aria-label="Adet"
              />
            </label>
            <button
              type="button"
              onClick={handleAdd}
              disabled={!addOk}
              className={`flex-1 min-w-0 flex items-center justify-center gap-1 py-2 text-white rounded-xl text-[10px] sm:text-xs font-bold disabled:opacity-40 ${addChrome.buttonClass}`}
              data-testid={`b2b-add-${p.sku}`}
            >
              <span className="relative inline-flex shrink-0">
                <ShoppingCart className="w-3.5 h-3.5" />
                {addChrome.inCart ? (
                  <span className="absolute -top-2 -right-2 min-w-[16px] h-4 px-0.5 rounded-full bg-amber-400 text-slate-900 text-[9px] font-black leading-4 text-center" data-testid={`b2b-add-qty-badge-${p.sku}`}>
                    {addChrome.qty}
                  </span>
                ) : null}
              </span>
              {addChrome.label}
            </button>
          </div>
        </>
      )}
    </div>
  );
});
