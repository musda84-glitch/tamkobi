import React from "react";
import { Package, Trash2 } from "lucide-react";
import { listThumbUrl } from "../utils/imageUrl";
import { productListImageUrl } from "../utils/productImages";
import { fmt, b2bGross } from "./B2BPortalParts";
import { LegalConsent } from "./LegalConsent";

function stockText(product) {
  return product?.in_stock ? "Stokta" : "Yok";
}

function QtyControl({ line, index, setQty, withTestId = false }) {
  const sku = line.p.sku;
  const setRaw = (raw) => {
    const digits = String(raw ?? "").replace(/\D/g, "");
    setQty(line.key, digits === "" ? 0 : Number(digits));
  };
  return (
    <div className="inline-flex items-center rounded-xl border border-slate-200 bg-white">
      <button type="button" className="px-2.5 py-1.5 text-slate-700 font-bold" aria-label="Azalt" onClick={() => setQty(line.key, Number(line.qty) - 1)}>−</button>
      <input
        aria-label="Adet"
        inputMode="numeric"
        className="w-12 border-x border-slate-200 py-1.5 text-center text-sm font-bold bg-white"
        data-testid={withTestId ? `b2b-cart-qty-${sku}-${index}` : undefined}
        value={line.qty}
        onChange={(e) => setRaw(e.target.value)}
      />
      <button type="button" className="px-2.5 py-1.5 text-slate-700 font-bold" aria-label="Artır" onClick={() => setQty(line.key, Number(line.qty) + 1)}>+</button>
    </div>
  );
}

function LineImage({ product }) {
  const src = productListImageUrl(product);
  return (
    <div className="w-14 h-14 shrink-0 rounded-lg border bg-slate-50 overflow-hidden flex items-center justify-center">
      {src
        ? <img src={listThumbUrl(src)} alt="" width={56} height={56} className="w-full h-full object-contain" loading="lazy" decoding="async" />
        : <Package className="w-5 h-5 text-slate-300" />}
    </div>
  );
}

function HeldTabs({ heldTabs, loadHeld, removeHeld }) {
  if (!heldTabs?.length) return null;
  return (
    <div className="flex flex-wrap gap-1.5" data-testid="b2b-held-tabs">
      {heldTabs.map((h) => (
        <div key={h.id} className="inline-flex items-center gap-1">
          <button
            type="button"
            onClick={() => loadHeld(h.id)}
            className="px-2 py-1 rounded-lg text-[10px] font-bold border bg-amber-50 text-amber-900 border-amber-200"
            data-testid={`b2b-held-tab-${h.id}`}
          >
            {h.label}
          </button>
          <button type="button" onClick={() => removeHeld(h.id)} className="text-[10px] text-rose-600 font-semibold px-1" data-testid={`b2b-held-discard-${h.id}`} title="Sil">×</button>
        </div>
      ))}
    </div>
  );
}

function Summary({
  lines, sub, vat, note, setNote, customerOrderNo, setCustomerOrderNo,
  submit, busy, onHold, minOrder, discount, cardOrderRequired,
  consent, setConsent, hrefExtra,
}) {
  const grand = sub + vat;
  const short = minOrder > 0 && grand + 1e-9 < minOrder;
  return (
    <div className="bg-white rounded-2xl border p-4 space-y-3 lg:sticky lg:top-4">
      <div className="text-xs space-y-1">
        <div className="flex justify-between text-slate-500">
          <span>Toplam kalem</span>
          <span>{lines.length}</span>
        </div>
        <div className="flex justify-between text-slate-500">
          <span>Ara toplam</span>
          <span data-testid="b2b-cart-subtotal">{fmt(sub)}</span>
        </div>
        <div className="flex justify-between text-slate-500">
          <span>KDV</span>
          <span data-testid="b2b-cart-vat">{fmt(vat)}</span>
        </div>
        {Number(discount) > 0 && (
          <div className="text-[11px] text-emerald-700" data-testid="b2b-cart-discount">
            {`Size özel %${discount} indirim – fiyatlara dahildir`}
          </div>
        )}
        <div className="flex justify-between font-black text-base border-t pt-1">
          <span>Genel toplam</span>
          <span data-testid="b2b-cart-grand-total">{fmt(grand)}</span>
        </div>
      </div>
      {short && (
        <div className="text-xs text-amber-900 bg-amber-50 border border-amber-200 rounded-xl px-3 py-2" data-testid="b2b-cart-min-order">
          Minimum sipariş tutarı {fmt(minOrder)}. Eksik tutar: {fmt(minOrder - grand)}.
        </div>
      )}
      <textarea
        value={note}
        onChange={(e) => setNote(e.target.value)}
        placeholder="Sipariş notu (teslimat, adres…)"
        rows={3}
        className="w-full border rounded-xl p-2.5 text-sm"
        data-testid="b2b-note"
      />
      {setCustomerOrderNo && (
        <input
          value={customerOrderNo || ""}
          onChange={(e) => setCustomerOrderNo(e.target.value)}
          placeholder="Sizin sipariş numaranız (isteğe bağlı)"
          maxLength={80}
          className="w-full border rounded-xl p-2.5 text-sm font-mono"
          data-testid="b2b-customer-order-no"
        />
      )}
      {setConsent && (
        <LegalConsent value={consent} onChange={setConsent} hrefExtra={hrefExtra} prefix="b2b-" className="bg-slate-50 border border-slate-200 rounded-xl p-2.5" />
      )}
      <div className="flex flex-col gap-2">
        {onHold && (
          <button type="button" onClick={onHold} disabled={busy} className="w-full py-2.5 border border-amber-300 bg-amber-50 text-amber-900 rounded-xl font-bold disabled:opacity-50" data-testid="b2b-hold-cart">
            Beklemeye Al
          </button>
        )}
        <button type="button" onClick={submit} disabled={busy} className="w-full py-3 bg-slate-900 hover:bg-slate-800 text-white rounded-xl font-bold disabled:opacity-50" data-testid="b2b-submit-order">
          {busy ? "Gönderiliyor…" : "Siparişi Gönder"}
        </button>
      </div>
      {cardOrderRequired && (
        <p className="text-[11px] text-slate-500" data-testid="b2b-card-order-note">Sipariş kartla ödeme sonrası oluşturulur.</p>
      )}
    </div>
  );
}

export function B2BCartPage({
  lines = [],
  sub = 0,
  vat = 0,
  note = "",
  setNote,
  customerOrderNo = "",
  setCustomerOrderNo,
  setQty,
  submit,
  busy = false,
  onHold,
  heldTabs = [],
  loadHeld,
  removeHeld,
  showStock = false,
  minOrder = 0,
  discount = 0,
  cardOrderRequired = false,
  consent,
  setConsent,
  hrefExtra = "",
  onBack,
}) {
  const summaryProps = {
    lines, sub, vat, note, setNote, customerOrderNo, setCustomerOrderNo,
    submit, busy, onHold, minOrder, discount, cardOrderRequired,
    consent, setConsent, hrefExtra,
  };
  return (
    <div className="grid grid-cols-1 lg:grid-cols-12 gap-4" data-testid="b2b-cart-page">
      <div className={`${lines.length ? "lg:col-span-8" : "lg:col-span-12"} space-y-3`}>
        <HeldTabs heldTabs={heldTabs} loadHeld={loadHeld} removeHeld={removeHeld} />
        {lines.length === 0 ? (
          <div className="bg-white rounded-2xl border p-8 text-center space-y-3">
            <p className="text-sm text-slate-500">Sepetiniz boş.</p>
            <button type="button" onClick={onBack} className="px-4 py-2 rounded-xl bg-slate-900 text-white text-sm font-bold" data-testid="b2b-cart-back">
              Ürünlere dön
            </button>
          </div>
        ) : (
          <div className="bg-white rounded-2xl border overflow-hidden">
            <div className="md:hidden divide-y">
              {lines.map((l, i) => (
                <div key={`card-${l.key || i}`} className="p-3 space-y-2">
                  <div className="flex gap-3">
                    <LineImage product={l.p} />
                    <div className="min-w-0 flex-1">
                      <div className="text-sm font-bold text-slate-900">{l.p.name}</div>
                      {l.note ? <div className="text-[11px] text-slate-500 italic truncate">{l.note}</div> : null}
                      <div className="text-[11px] font-mono text-slate-400">{l.p.sku}</div>
                      <div className="text-xs text-slate-700">{fmt(b2bGross(l.p))} <span className="text-slate-400">KDV dahil</span></div>
                      {showStock && (
                        <div className={`text-[10px] font-semibold ${l.p.in_stock ? "text-emerald-600" : "text-rose-600"}`}>{stockText(l.p)}</div>
                      )}
                    </div>
                  </div>
                  <div className="flex items-center justify-between gap-2">
                    <QtyControl line={l} index={i} setQty={setQty} />
                    <b className="text-sm whitespace-nowrap">{fmt(b2bGross(l.p) * l.qty)}</b>
                    <button type="button" onClick={() => setQty(l.key, 0)} className="text-rose-500 p-1.5" aria-label="Kaldır">
                      <Trash2 className="w-4 h-4" />
                    </button>
                  </div>
                </div>
              ))}
            </div>
            <table className="w-full text-xs hidden md:table">
              <thead className="text-[10px] uppercase tracking-wide text-slate-400 border-b">
                <tr>
                  <th className="text-left font-bold px-3 py-2">Ürün</th>
                  <th className="text-left font-bold px-2 py-2">Kod</th>
                  <th className="text-right font-bold px-2 py-2">Birim fiyat</th>
                  <th className="text-center font-bold px-2 py-2">Adet</th>
                  {showStock && <th className="text-left font-bold px-2 py-2">Stok</th>}
                  <th className="text-right font-bold px-2 py-2">Tutar</th>
                  <th className="px-2 py-2" />
                </tr>
              </thead>
              <tbody className="divide-y">
                {lines.map((l, i) => (
                  <tr key={l.key || i} data-testid={`b2b-cart-row-${l.p.sku}-${i}`}>
                    <td className="px-3 py-3">
                      <div className="flex items-center gap-3 min-w-0">
                        <LineImage product={l.p} />
                        <div className="min-w-0">
                          <div className="font-bold text-slate-900 text-sm">{l.p.name}</div>
                          {l.note ? <div className="text-[11px] text-slate-500 italic truncate">{l.note}</div> : null}
                        </div>
                      </div>
                    </td>
                    <td className="px-2 py-3 font-mono text-slate-500">{l.p.sku}</td>
                    <td className="px-2 py-3 text-right whitespace-nowrap">
                      <div className="font-semibold">{fmt(b2bGross(l.p))}</div>
                      <div className="text-[10px] text-slate-400">KDV dahil</div>
                    </td>
                    <td className="px-2 py-3 text-center">
                      <QtyControl line={l} index={i} setQty={setQty} withTestId />
                    </td>
                    {showStock && (
                      <td className={`px-2 py-3 font-semibold ${l.p.in_stock ? "text-emerald-600" : "text-rose-600"}`}>{stockText(l.p)}</td>
                    )}
                    <td className="px-2 py-3 text-right font-black whitespace-nowrap">{fmt(b2bGross(l.p) * l.qty)}</td>
                    <td className="px-2 py-3 text-right">
                      <button type="button" onClick={() => setQty(l.key, 0)} className="text-rose-500 p-1.5" aria-label="Kaldır" data-testid={`b2b-cart-remove-${l.p.sku}-${i}`}>
                        <Trash2 className="w-4 h-4" />
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
      {lines.length > 0 && (
        <aside className="lg:col-span-4">
          <Summary {...summaryProps} />
        </aside>
      )}
    </div>
  );
}
