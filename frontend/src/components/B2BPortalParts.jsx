
import React, { useState } from "react";
import axios from "axios";
import { toast } from "sonner";
import { ShoppingCart, Truck, Trash2, Building2, X, ExternalLink, Package, PackageCheck, Clock, Pencil, Ban, Plus, Minus, Loader2, KeyRound, Factory, CheckCircle2, Circle } from "lucide-react";
import { API_URL } from "../context/AuthContext";
import { useEscape } from "../utils/useEscape";
import { resolveImageUrl } from "../utils/imageUrl";
import { statusTr } from "../utils/labels";
import { orderStatusLabel, trackingCarrierLabel } from "../utils/warehouseShip";
import { B2BOrderPreview, PreviewOrderBtn } from "./B2BOrderPreview";
import { formatOrderItemLabel, cartHeading, cartKalemLabel, cartLinesQtyTotal } from "../utils/b2bCart";
import { lineUnitIncl } from "../utils/printFormLayout";
import { LegalConsent } from "./LegalConsent";
import { fmtDate, fmtMoney } from "../utils/money";
import { backdropDismissProps } from "../utils/modalBackdrop";

export const fmt = (n, c = "TRY") => fmtMoney(n, c);

const findB2bProduct = (products, productId) =>
  (products || []).find((x) => String(x.id || x._id || "") === String(productId || ""));

/** Sipariş düzenleme satırı: katalogdan görsel + KDV alanları. */
export function b2bEditLineFromItem(item, products) {
  const p = findB2bProduct(products, item?.product_id) || {};
  const vat = item?.vat_rate != null && item?.vat_rate !== "" ? Number(item.vat_rate) : Number(p.vat_rate) || 20;
  const hasOrderUnit = item?.unit_price != null && item?.unit_price !== "";
  return {
    product_id: item.product_id,
    product_name: item.product_name || p.name || "",
    sku: item.sku || p.sku || "",
    quantity: Number(item.quantity) || 0,
    unit_price: hasOrderUnit ? Number(item.unit_price) : Number(p.price) || 0,
    vat_rate: vat,
    unit_price_incl: item.unit_price_incl != null && item.unit_price_incl !== ""
      ? Number(item.unit_price_incl)
      : null,
    total_incl: item.total_incl,
    image_url: item.image_url || p.image_url || p.thumbnail_url || "",
    note: item.note || item.line_note || "",
    price: hasOrderUnit ? null : p.price,
    price_gross: hasOrderUnit ? null : p.price_gross,
    price_includes_vat: p.price_includes_vat,
  };
}

/** Düzenleme satırında KDV dahil birim fiyat. */
export function b2bEditUnitGross(line) {
  if (!line) return 0;
  if (line.unit_price_incl != null && line.unit_price_incl !== "") return Number(line.unit_price_incl) || 0;
  if (line.unit_price != null && line.unit_price !== "" && (line.vat_rate != null || line.total_incl != null)) {
    return lineUnitIncl({
      unit_price: line.unit_price,
      vat_rate: line.vat_rate,
      quantity: line.quantity,
      total_incl: line.total_incl,
      unit_price_incl: line.unit_price_incl,
    });
  }
  if (line.price_gross != null && line.price_gross !== "") return Number(line.price_gross) || 0;
  return b2bGross({
    price: line.price != null ? line.price : line.unit_price,
    price_gross: line.price_gross,
    vat_rate: line.vat_rate,
    price_includes_vat: line.price_includes_vat,
  });
}

export function b2bEditLineGross(line) {
  return Math.round(b2bEditUnitGross(line) * (Number(line?.quantity) || 0) * 100) / 100;
}

export function b2bEditLinesGrossTotal(lines) {
  return Math.round((lines || []).reduce((s, l) => s + b2bEditLineGross(l), 0) * 100) / 100;
}

export function b2bEditLinesQtyTotal(lines) {
  return (lines || []).reduce((s, l) => s + (Number(l?.quantity) || 0), 0);
}

/** KDV dahil birim fiyat. price_gross yoksa vat_rate + price_includes_vat ile hesaplanır. */
export const b2bGross = (p, field = "price") => {
  if (!p || p[field] == null || p[field] === "") return 0;
  if (field === "price" && p.price_gross != null && p.price_gross !== "") return Number(p.price_gross) || 0;
  if (field === "list_price" && p.list_price_gross != null && p.list_price_gross !== "") return Number(p.list_price_gross) || 0;
  const n = Number(p[field]) || 0;
  const r = Number(p.vat_rate) || 0;
  if (p.price_includes_vat) return n;
  return Math.round(n * (1 + r / 100) * 100) / 100;
};

export const b2bNet = (p) => {
  if (!p || p.price == null || p.price === "") return 0;
  const n = Number(p.price) || 0;
  const r = Number(p.vat_rate) || 0;
  if (p.price_includes_vat && r) return Math.round((n / (1 + r / 100)) * 100) / 100;
  return n;
};

export const b2bOrderGross = (o) => {
  if (!o) return 0;
  if (o.grand_total != null && o.grand_total !== "") return Number(o.grand_total) || 0;
  const items = o.items || [];
  if (items.length) {
    // enrich_line sonrası unit_price/total her zaman KDV hariçtir; price_includes_vat sadece ürün bayrağıdır.
    return Math.round(items.reduce((s, it) => {
      const incl = Number(it.total_incl);
      if (Number.isFinite(incl)) return s + incl;
      const net = it.total != null && it.total !== ""
        ? Number(it.total) || 0
        : (Number(it.unit_price) || 0) * (Number(it.quantity) || 0);
      const vatAmt = Number(it.vat_amount);
      if (Number.isFinite(vatAmt)) return s + net + vatAmt;
      const vat = Number(it.vat_rate) || 0;
      return s + (vat ? net * (1 + vat / 100) : net);
    }, 0) * 100) / 100;
  }
  return Number(o.total_amount) || 0;
};


export const B2BHeader = ({ company, contact, token, onPasswordChanged }) => {
  const bal = contact.balance || 0;
  const [open, setOpen] = useState(false);
  const hasPassword = contact.has_password !== false;
  const [f, setF] = useState({ current_password: "", new_password: "", new_password2: "" });
  const [busy, setBusy] = useState(false);
  const close = () => { setOpen(false); setF({ current_password: "", new_password: "", new_password2: "" }); };
  const submit = async (e) => {
    e.preventDefault();
    if (f.new_password !== f.new_password2) { toast.error("Yeni şifreler eşleşmiyor."); return; }
    setBusy(true);
    try {
      await axios.post(`${API_URL}/public/b2b/${token}/change-password`, { current_password: f.current_password, new_password: f.new_password });
      toast.success("Şifreniz güncellendi.");
      close();
      onPasswordChanged?.();
    } catch (err) { toast.error(err.response?.data?.detail || "Şifre değiştirilemedi."); } finally { setBusy(false); }
  };
  return (
    <header className="bg-slate-900 text-white" data-testid="b2b-header">
      <div className="max-w-7xl mx-auto px-4 py-3 sm:py-4 flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3">
        <div className="flex items-center gap-3 min-w-0">
          {company.logo_url ? <img src={resolveImageUrl(company.logo_url)} alt="" className="h-9 sm:h-10 w-9 sm:w-auto bg-white rounded-lg p-1 object-contain shrink-0" /> : <Building2 className="w-7 h-7 text-slate-400 shrink-0" />}
          <div className="min-w-0"><div className="font-bold leading-tight text-sm sm:text-base truncate">{company.name} <span className="text-[10px] bg-emerald-600 rounded px-1.5 py-0.5 ml-1 align-middle">B2B</span></div><div className="text-[11px] sm:text-xs text-slate-400 truncate">{[company.phone, company.email].filter(Boolean).join(" • ")}</div></div>
        </div>
        <div className="flex items-center justify-between sm:justify-end gap-3 border-t border-white/10 sm:border-0 pt-2 sm:pt-0 text-xs">
          <div className="min-w-0">
            <div className="font-bold text-sm truncate" data-testid="b2b-contact-name">{contact.name}</div>
            {token && (
              <button type="button" onClick={() => setOpen(true)} className="mt-0.5 inline-flex items-center gap-1 text-[11px] text-slate-300 hover:text-white underline decoration-dotted" data-testid="b2b-change-password-btn">
                <KeyRound className="w-3 h-3" /> Şifre değiştir
              </button>
            )}
          </div>
          <div className="text-right shrink-0"><div className="text-slate-400">Bakiye</div><div className={`font-bold ${bal > 0 ? "text-rose-300" : "text-emerald-300"}`} data-testid="b2b-balance">{fmt(Math.abs(bal))} {bal > 0 ? "borç" : bal < 0 ? "alacak" : ""}</div>{contact.discount > 0 && <span className="inline-block mt-0.5 bg-emerald-600/30 text-emerald-200 rounded px-1.5 text-[10px]">Size özel %{contact.discount} indirim</span>}</div>
        </div>
      </div>
      {open && (
        <div className="fixed inset-0 z-50 bg-slate-950/70 backdrop-blur-sm flex items-center justify-center p-4" {...backdropDismissProps(close)} data-testid="b2b-change-password-overlay">
          <form onSubmit={submit} onClick={(e) => e.stopPropagation()} className="bg-white text-slate-900 w-full max-w-md rounded-2xl p-5 space-y-3 shadow-2xl" data-testid="b2b-change-password-modal">
            <div className="flex items-center justify-between">
              <h3 className="font-bold text-sm flex items-center gap-2"><KeyRound className="w-4 h-4 text-emerald-600" /> Şifre değiştir</h3>
              <button type="button" onClick={close} className="p-1.5 text-slate-400 hover:text-slate-700" aria-label="Kapat" data-testid="b2b-change-password-close"><X className="w-5 h-5" /></button>
            </div>
            <p className="text-[11px] text-slate-500">{hasPassword ? "Mevcut şifrenizi doğrulayın; yeni şifre en az 6 karakter olmalıdır." : "Bu hesap için ilk şifrenizi belirleyin (en az 6 karakter)."}</p>
            {hasPassword && <div><label className="block text-xs font-semibold mb-1">Mevcut şifre</label><input type="password" required value={f.current_password} onChange={(e) => setF({ ...f, current_password: e.target.value })} className="w-full border rounded-xl p-2.5 text-sm" data-testid="b2b-chg-current-password" autoComplete="current-password" /></div>}
            <div><label className="block text-xs font-semibold mb-1">Yeni şifre</label><input type="password" required minLength={6} value={f.new_password} onChange={(e) => setF({ ...f, new_password: e.target.value })} className="w-full border rounded-xl p-2.5 text-sm" data-testid="b2b-chg-new-password" autoComplete="new-password" /></div>
            <div><label className="block text-xs font-semibold mb-1">Yeni şifre (tekrar)</label><input type="password" required value={f.new_password2} onChange={(e) => setF({ ...f, new_password2: e.target.value })} className="w-full border rounded-xl p-2.5 text-sm" data-testid="b2b-chg-new-password2" autoComplete="new-password" /></div>
            <button type="submit" disabled={busy} className="w-full py-2.5 bg-emerald-600 hover:bg-emerald-700 text-white rounded-xl font-bold flex items-center justify-center gap-2 disabled:opacity-60" data-testid="b2b-chg-password-save">{busy ? <Loader2 className="w-4 h-4 animate-spin" /> : <KeyRound className="w-4 h-4" />} {busy ? "Kaydediliyor…" : "Şifreyi Kaydet"}</button>
          </form>
        </div>
      )}
    </header>
  );
};

export const CartBody = ({ lines, sub, vat, note, setNote, setQty, submit, busy, suffix = "", customerOrderNo, setCustomerOrderNo, consent, setConsent, hrefExtra = "", onHold }) => (
  <>
    {lines.length === 0 && <div className="text-xs text-slate-400 py-6 text-center">Sepetiniz boş.</div>}
    <div className="divide-y text-xs max-h-60 sm:max-h-72 overflow-y-auto">{lines.map((l, i) => (
      <div key={l.key || `${l.p.id}-${i}`} className="py-2 flex items-center gap-2" data-testid={`b2b-cart-line-${l.p.sku}-${i}${suffix}`}>
        <div className="w-11 h-11 shrink-0 rounded-lg border bg-slate-50 overflow-hidden flex items-center justify-center" data-testid={`b2b-cart-line-img-${l.p.sku}-${i}${suffix}`}>
          {l.p?.image_url
            ? <img src={resolveImageUrl(l.p.image_url)} alt="" className="w-full h-full object-contain" loading="lazy" decoding="async" />
            : <Package className="w-5 h-5 text-slate-300" />}
        </div>
        <div className="flex-1 min-w-0">
          <div className="font-semibold truncate">{l.p.name}</div>
          {l.note ? <div className="text-[10px] text-slate-500 italic truncate" title={l.note} data-testid={`b2b-cart-line-note-${l.p.sku}-${i}${suffix}`}>{l.note}</div> : null}
          <div className="text-slate-400">{l.qty} × {fmt(b2bGross(l.p))}</div>
        </div>
        <b className="whitespace-nowrap">{fmt(b2bGross(l.p) * l.qty)}</b>
        <button onClick={() => setQty(l.key || l.p.id, 0)} className="text-rose-500 p-1.5" aria-label="Kaldır"><Trash2 className="w-4 h-4" /></button>
      </div>
    ))}</div>
    {lines.length > 0 && <>
      <div className="text-xs space-y-1 border-t pt-2">
        <div className="flex justify-between text-slate-500" data-testid={`b2b-cart-kalem${suffix}`}>
          <span>Toplam kalem</span>
          <span>{cartKalemLabel(cartLinesQtyTotal(lines))}</span>
        </div>
        <div className="flex justify-between text-slate-500"><span>Ara Toplam</span><span>{fmt(sub)}</span></div>
        <div className="flex justify-between text-slate-500"><span>KDV</span><span>{fmt(vat)}</span></div>
        <div className="flex justify-between font-black text-base border-t pt-1"><span>Toplam (KDV dahil)</span><span data-testid={`b2b-cart-total${suffix}`}>{fmt(sub + vat)}</span></div>
      </div>
      <input value={note} onChange={(e) => setNote(e.target.value)} placeholder="Sipariş notu (teslimat, adres…)" className="w-full border rounded-xl p-2.5 text-sm sm:text-xs" data-testid={`b2b-note${suffix}`} />
      {setCustomerOrderNo && <input value={customerOrderNo || ""} onChange={(e) => setCustomerOrderNo(e.target.value)} placeholder="Sizin sipariş numaranız (isteğe bağlı)" maxLength={80} className="w-full border rounded-xl p-2.5 text-sm sm:text-xs font-mono" data-testid={`b2b-customer-order-no${suffix}`} />}
      {setConsent && <LegalConsent value={consent} onChange={setConsent} hrefExtra={hrefExtra} prefix={`b2b${suffix}-`} className="bg-slate-50 border border-slate-200 rounded-xl p-2.5" />}
      <div className="flex flex-col gap-2">
        {onHold && (
          <button type="button" onClick={onHold} disabled={busy} className="w-full py-2.5 border border-amber-300 bg-amber-50 text-amber-900 rounded-xl font-bold disabled:opacity-50" data-testid={`b2b-hold-cart${suffix}`}>
            Beklemeye Al
          </button>
        )}
        <button onClick={submit} disabled={busy} className="w-full py-3 bg-slate-900 hover:bg-slate-800 text-white rounded-xl font-bold disabled:opacity-50" data-testid={`b2b-submit-order${suffix}`}>{busy ? "Gönderiliyor…" : "Siparişi Gönder"}</button>
      </div>
    </>}
  </>
);

/* Mobil: alt sabit sepet çubuğu + açılır alt panel */
export const MobileCartBar = ({ lines, total, open, setOpen, children, heldCount = 0 }) => {
  if (lines.length === 0 && !heldCount) return null;
  const count = lines.reduce((s, l) => s + l.qty, 0);
  return (
    <>
      <div className="lg:hidden fixed bottom-0 inset-x-0 z-40 p-3 pointer-events-none">
        <button onClick={() => setOpen(true)} className="pointer-events-auto w-full flex items-center justify-between bg-slate-900 text-white rounded-2xl px-4 py-3 shadow-2xl" data-testid="b2b-mobile-cart-bar">
          <span className="flex items-center gap-2 font-bold text-sm">
            <span className="relative">
              <ShoppingCart className="w-5 h-5" />
              <span className="absolute -top-2 -right-2 bg-emerald-500 text-[10px] rounded-full w-4.5 h-4.5 min-w-[18px] px-1 flex items-center justify-center">{count || heldCount}</span>
            </span>
            {count ? "Sepet" : "Bekleyen sepetler"}
          </span>
          <span className="font-black">{count ? <>{fmt(total)} <span className="text-xs font-semibold text-emerald-300 ml-1">Siparişe geç →</span></> : <span className="text-xs font-semibold text-amber-300">Görüntüle →</span>}</span>
        </button>
      </div>
      {open && (
        <div className="lg:hidden fixed inset-0 z-50 bg-slate-900/60 backdrop-blur-sm flex items-end" {...backdropDismissProps(() => setOpen(false))}>
          <div className="bg-white w-full rounded-t-3xl p-4 pb-6 space-y-3 max-h-[85vh] overflow-y-auto" onClick={(e) => e.stopPropagation()} data-testid="b2b-mobile-cart-sheet">
            <div className="flex items-center justify-between"><div className="font-bold text-slate-900 flex items-center gap-2" data-testid="b2b-mobile-cart-heading"><ShoppingCart className="w-4 h-4" /> {cartHeading(lines)}</div><button onClick={() => setOpen(false)} className="p-2 text-slate-400" aria-label="Kapat" data-testid="b2b-mobile-cart-close"><X className="w-5 h-5" /></button></div>
            {children}
          </div>
        </div>
      )}
    </>
  );
};

const STEP_LABELS = { created: "Hazırlanıyor", picked_up: "Kargoya Verildi", in_transit: "Yolda", out_for_delivery: "Dağıtımda", delivered: "Teslim Edildi", returned: "İade" };

/** Üretimdeyken kargo yerine aşamalar; kargo çıktıysa veya teslimde üretim gizlenir. */
export function orderShowsProduction(o) {
  const p = o?.production;
  if (!p?.status) return false;
  const ost = String(o?.order_status || "").toLowerCase();
  if (["cancelled", "delivered", "completed", "shipped", "returned", "partially_returned"].includes(ost)) return false;
  if (o?.tracking && !p.active) return false;
  return true;
}

export const ProductionCard = ({ p, orderNumber }) => {
  if (!p) return null;
  const doneAll = p.status === "completed" || (p.total > 0 && p.done >= p.total);
  return (
    <div
      className={`rounded-xl border p-2.5 text-xs space-y-1.5 ${doneAll ? "bg-emerald-50 border-emerald-200" : "bg-amber-50 border-amber-200"}`}
      data-testid={`b2b-production-${orderNumber}`}
    >
      <div className="flex flex-wrap items-center justify-between gap-2">
        <span className={`inline-flex items-center gap-1 font-bold ${doneAll ? "text-emerald-700" : "text-amber-800"}`}>
          <Factory className="w-4 h-4" /> {p.status_label || "Üretimde"}
          {p.product_name ? <span className="font-normal text-slate-500"> · {p.product_name}</span> : null}
        </span>
        {p.total > 0 ? (
          <span className="text-[11px] text-slate-500 font-semibold" data-testid={`b2b-production-progress-${orderNumber}`}>
            {p.done}/{p.total}
          </span>
        ) : null}
      </div>
      {p.total > 0 && (
        <div className="flex items-center gap-1" aria-label="Üretim adımları">
          {(p.steps || []).map((s) => (
            <div
              key={`${s.no}-${s.name}`}
              className={`h-1.5 flex-1 rounded-full ${s.done ? "bg-emerald-500" : s.current ? "bg-amber-500" : "bg-slate-200"}`}
              title={s.name}
            />
          ))}
        </div>
      )}
      {(p.steps || []).length > 0 && (
        <ul className="space-y-0.5" data-testid={`b2b-production-steps-${orderNumber}`}>
          {(p.steps || []).map((s) => (
            <li
              key={`${s.no}-${s.name}`}
              className={`flex items-start gap-1.5 text-[11px] leading-tight ${s.done ? "text-emerald-700" : s.current ? "text-amber-800 font-semibold" : "text-slate-500"}`}
              data-testid={`b2b-production-step-${orderNumber}-${s.no}`}
            >
              {s.done ? <CheckCircle2 className="w-3 h-3 shrink-0 mt-0.5" /> : s.current ? <Factory className="w-3 h-3 shrink-0 mt-0.5" /> : <Circle className="w-3 h-3 shrink-0 mt-0.5 text-slate-300" />}
              <span className="min-w-0">
                <span className="font-mono text-slate-400 mr-1">{s.no}.</span>
                {s.name}
                {s.station ? <span className="ml-1 text-[10px] font-semibold text-indigo-700 bg-indigo-50 px-1 py-0.5 rounded">{s.station}</span> : null}
              </span>
            </li>
          ))}
        </ul>
      )}
      {p.current_step_name && !doneAll ? (
        <div className="text-[11px] text-amber-800">Şu an: <b>{p.current_step_name}</b></div>
      ) : null}
    </div>
  );
};

export const TrackingCard = ({ t, orderNumber }) => {
  if (!t) return <span className="text-slate-400 text-xs">Kargo bekleniyor</span>;
  const done = t.status === "delivered";
  const carrier = trackingCarrierLabel(t.carrier, t.tracking_number);
  return (
    <div className={`rounded-xl border p-2.5 text-xs space-y-1.5 ${done ? "bg-emerald-50 border-emerald-200" : t.is_late ? "bg-rose-50 border-rose-200" : "bg-sky-50 border-sky-200"}`} data-testid={`b2b-tracking-${orderNumber}`}>
      <div className="flex flex-wrap items-center justify-between gap-2">
        <span className={`inline-flex items-center gap-1 font-bold ${done ? "text-emerald-700" : t.is_late ? "text-rose-700" : "text-sky-800"}`}>{done ? <PackageCheck className="w-4 h-4" /> : <Truck className="w-4 h-4" />} {STEP_LABELS[t.status] || t.status}{carrier ? <span className="font-normal text-slate-500"> · {carrier}</span> : null}</span>
        {t.tracking_number && (t.tracking_url ? <a href={t.tracking_url} target="_blank" rel="noreferrer" className="inline-flex items-center gap-1 font-mono font-semibold text-indigo-700 underline decoration-dotted" data-testid={`b2b-tracking-link-${orderNumber}`}>{t.tracking_number} <ExternalLink className="w-3 h-3" /></a> : <span className="font-mono font-semibold">{t.tracking_number}</span>)}
      </div>
      {t.step >= 0 && <div className="flex items-center gap-1" aria-label="Kargo adımları">{t.steps.map((s, i) => <div key={s} className={`h-1.5 flex-1 rounded-full ${i <= t.step ? (done ? "bg-emerald-500" : "bg-sky-500") : "bg-slate-200"}`} title={STEP_LABELS[s]} />)}</div>}
      <div className="flex flex-wrap items-center gap-x-3 gap-y-0.5 text-[11px] text-slate-600">
        {done ? <span>Teslim: <b>{fmtDate((t.delivered_at || "").slice(0, 10)) || "—"}</b></span> : t.estimated_delivery ? <span className="inline-flex items-center gap-1"><Clock className="w-3 h-3" /> Tahmini teslim <b className={t.is_late ? "text-rose-700" : ""} data-testid={`b2b-eta-${orderNumber}`}>{fmtDate(t.estimated_delivery)}</b>{t.is_late ? " (gecikti)" : ""}</span> : null}
        {t.shipped_at && !done && <span>Kargolandı {fmtDate(t.shipped_at)}</span>}
      </div>
    </div>
  );
};

/** Kargo hücresi: üretimde aşamalar, aksi halde kargo kartı. */
export const OrderProgressCell = ({ o }) => {
  if (o?.is_held_cart) return <span className="text-slate-400 text-[11px]">—</span>;
  if (orderShowsProduction(o)) return <ProductionCard p={o.production} orderNumber={o.order_number} />;
  return <TrackingCard t={o.tracking} orderNumber={o.order_number} />;
};

const Th = ({ children, right }) => <th className={`p-3 ${right ? "text-right" : "text-left"}`}>{children}</th>;
const pendingStatus = (s) => ["pending", "new"].includes(s);
const approvedStatus = (s) => ["approved", "preparing"].includes(s);

const OrderStatusBadge = ({ o }) => {
  const showProd = orderShowsProduction(o);
  const statusText = showProd
    ? (o.production?.status_label || "Üretimde")
    : orderStatusLabel(o, statusTr(o.order_status));
  const statusClass = showProd
    ? (o.production?.status === "completed" ? "bg-emerald-50 text-emerald-800" : "bg-amber-50 text-amber-800")
    : "bg-slate-100";
  return (
    <div className="flex flex-col items-start gap-1">
      {o.is_held_cart ? (
        <span className={`px-1.5 py-0.5 rounded font-semibold ${o.is_active_cart ? "bg-sky-50 text-sky-800" : "bg-amber-50 text-amber-800"}`} data-testid={`b2b-held-badge-${o.id}`}>
          {o.is_active_cart ? "Aktif sepet" : (o.held_seq ? `Bekleyen sepet #${o.held_seq}` : "Bekleyen sepet")}
        </span>
      ) : (
        <span className={`px-1.5 py-0.5 rounded font-semibold ${statusClass}`} data-testid={showProd ? `b2b-prod-status-${o.order_number}` : undefined}>
          {statusText}
        </span>
      )}
      {o.cancel_request?.status === "pending" && <span className="bg-amber-50 text-amber-800 px-1.5 py-0.5 rounded font-semibold" data-testid={`b2b-cancel-pending-${o.order_number}`}>İptal talebi iletildi</span>}
      {o.cancel_request?.status === "rejected" && <span className="bg-slate-100 text-slate-500 px-1.5 py-0.5 rounded">İptal talebi reddedildi</span>}
    </div>
  );
};

const OrderActions = ({ o, onPreview, onEdit, onDelete, onCancel, busy }) => (
  <div className="flex flex-wrap gap-1.5" data-testid={`b2b-order-actions-${o.order_number}`}>
    {onPreview && <PreviewOrderBtn onClick={() => onPreview(o)} orderNumber={o.order_number} />}
    {!o.view_only && onEdit && pendingStatus(o.order_status) && (
      <>
        <button type="button" onClick={() => onEdit(o)} disabled={busy} className="inline-flex items-center gap-1 px-2 py-1 rounded-lg bg-slate-900 text-white text-[11px] font-semibold disabled:opacity-50" data-testid={`b2b-order-edit-${o.order_number}`}><Pencil className="w-3 h-3" /> Düzenle</button>
        <button type="button" onClick={() => onDelete(o)} disabled={busy} className="inline-flex items-center gap-1 px-2 py-1 rounded-lg border border-rose-200 text-rose-700 text-[11px] font-semibold hover:bg-rose-50 disabled:opacity-50" data-testid={`b2b-order-delete-${o.order_number}`}><Trash2 className="w-3 h-3" /> Sil</button>
      </>
    )}
    {!o.view_only && onCancel && approvedStatus(o.order_status) && o.cancel_request?.status !== "pending" && (
      <button type="button" onClick={() => onCancel(o)} disabled={busy} className="inline-flex items-center gap-1 px-2 py-1 rounded-lg border border-amber-200 text-amber-800 text-[11px] font-semibold hover:bg-amber-50 disabled:opacity-50" data-testid={`b2b-order-cancel-${o.order_number}`}><Ban className="w-3 h-3" /> İptal talebi</button>
    )}
  </div>
);

const EditOrderModal = ({ order, products, token, onClose, onDone }) => {
  useEscape(onClose);
  const [lines, setLines] = useState(() => (order.items || []).map((i) => b2bEditLineFromItem(i, products)));
  const [note, setNote] = useState(order.notes || "");
  const [addId, setAddId] = useState("");
  const [busy, setBusy] = useState(false);
  const setQty = (idx, qty) => setLines((ls) => ls.map((l, i) => (i === idx ? { ...l, quantity: qty } : l)).filter((l) => l.quantity > 0));
  const addLine = () => {
    const p = findB2bProduct(products, addId);
    if (!p) return;
    setLines((ls) => {
      const hit = ls.find((l) => l.product_id === p.id && !String(l.note || "").trim());
      if (hit) return ls.map((l) => (l === hit ? { ...l, quantity: l.quantity + 1 } : l));
      return [...ls, b2bEditLineFromItem({
        product_id: p.id,
        product_name: p.name,
        sku: p.sku,
        quantity: 1,
        unit_price: p.price,
        vat_rate: p.vat_rate,
        unit_price_incl: p.price_gross,
        image_url: p.image_url,
        note: "",
      }, products)];
    });
    setAddId("");
  };
  const total = b2bEditLinesGrossTotal(lines);
  const kalemCount = b2bEditLinesQtyTotal(lines);
  const save = async () => {
    if (!lines.length) { toast.error("Siparişte en az bir ürün olmalı."); return; }
    setBusy(true);
    try {
      const r = await axios.put(`${API_URL}/public/b2b/${token}/orders/${order.id}`, { items: lines.map((l) => ({ product_id: l.product_id, quantity: l.quantity, note: l.note || "" })), note });
      toast.success(r.data.message);
      onDone();
      onClose();
    } catch (e) { toast.error(e.response?.data?.detail || "Güncellenemedi."); } finally { setBusy(false); }
  };
  return (
    <div className="fixed inset-0 z-[70] bg-slate-900/50 flex items-end sm:items-center justify-center p-0 sm:p-4" {...backdropDismissProps(onClose)}>
      <div className="bg-white rounded-t-2xl sm:rounded-2xl max-w-lg w-full p-4 sm:p-5 space-y-3 text-xs shadow-2xl max-h-[90vh] overflow-y-auto" onClick={(e) => e.stopPropagation()} data-testid="b2b-edit-order-modal">
        <div className="flex justify-between items-start"><div><h3 className="text-sm font-bold text-slate-900">Siparişi düzenle</h3><p className="text-slate-500 font-mono">{order.order_number}</p></div><button type="button" onClick={onClose} className="text-slate-400" data-testid="b2b-edit-close"><X className="w-5 h-5" /></button></div>
        <div className="divide-y">{lines.map((l, idx) => {
          const unitGross = b2bEditUnitGross(l);
          const lineGross = b2bEditLineGross(l);
          const img = l.image_url;
          return (
          <div key={`${l.product_id}-${l.note || ""}-${idx}`} className="py-2 flex items-center gap-2" data-testid={`b2b-edit-line-${l.sku || idx}`}>
            <div className="w-11 h-11 shrink-0 rounded-lg border bg-slate-50 overflow-hidden flex items-center justify-center" data-testid={`b2b-edit-line-img-${l.sku || idx}`}>
              {img
                ? <img src={resolveImageUrl(img)} alt="" className="w-full h-full object-contain" loading="lazy" decoding="async" />
                : <Package className="w-5 h-5 text-slate-300" />}
            </div>
            <div className="flex-1 min-w-0">
              <div className="font-semibold truncate">{l.product_name}</div>
              <div className="text-slate-400" data-testid={`b2b-edit-line-price-${l.sku || idx}`}>{l.quantity} × {fmt(unitGross)} <span className="text-[10px]">KDV dahil</span></div>
              {l.note ? <div className="text-[10px] text-amber-800 truncate" title={l.note} data-testid={`b2b-edit-line-note-${l.sku}`}>Sipariş stok notu · {l.note}</div> : null}
            </div>
            <b className="whitespace-nowrap shrink-0" data-testid={`b2b-edit-line-total-${l.sku || idx}`}>{fmt(lineGross)}</b>
            <div className="flex items-center gap-1 bg-slate-100 rounded-lg">
              <button type="button" onClick={() => setQty(idx, l.quantity - 1)} className="p-1.5" aria-label="Azalt" data-testid={`b2b-edit-dec-${l.sku}`}><Minus className="w-3.5 h-3.5" /></button>
              <span className="w-7 text-center font-bold">{l.quantity}</span>
              <button type="button" onClick={() => setQty(idx, l.quantity + 1)} className="p-1.5" aria-label="Artır" data-testid={`b2b-edit-inc-${l.sku}`}><Plus className="w-3.5 h-3.5" /></button>
            </div>
            <button type="button" onClick={() => setQty(idx, 0)} className="text-rose-500 p-1" aria-label="Kaldır"><Trash2 className="w-3.5 h-3.5" /></button>
          </div>
          );
        })}</div>
        {(products || []).length > 0 && (
          <div className="flex gap-1.5">
            <select value={addId} onChange={(e) => setAddId(e.target.value)} className="flex-1 border rounded-lg p-2 bg-slate-50" data-testid="b2b-edit-add-product">
              <option value="">Ürün ekle…</option>
              {(products || []).filter((p) => p.in_stock !== false).map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
            </select>
            <button type="button" onClick={addLine} disabled={!addId} className="px-3 py-2 bg-slate-900 text-white rounded-lg font-semibold disabled:opacity-40" data-testid="b2b-edit-add-btn">Ekle</button>
          </div>
        )}
        <input value={note} onChange={(e) => setNote(e.target.value)} placeholder="Sipariş notu" className="w-full border rounded-xl p-2.5" data-testid="b2b-edit-note" />
        <div className="space-y-1 border-t pt-2">
          <div className="flex justify-between text-slate-500" data-testid="b2b-edit-kalem">
            <span>Toplam kalem</span>
            <span>{cartKalemLabel(kalemCount)}</span>
          </div>
          <div className="flex items-center justify-between">
            <b data-testid="b2b-edit-total">Toplam (KDV dahil) {fmt(total)}</b>
            <div className="flex gap-2">
              <button type="button" onClick={onClose} className="px-3 py-1.5 border rounded-lg">Vazgeç</button>
              <button type="button" onClick={save} disabled={busy} className="px-4 py-1.5 bg-emerald-600 text-white rounded-lg font-semibold disabled:opacity-50" data-testid="b2b-edit-save">{busy ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : "Kaydet"}</button>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
};

const CancelRequestModal = ({ order, token, onClose, onDone }) => {
  useEscape(onClose);
  const [reason, setReason] = useState("");
  const [busy, setBusy] = useState(false);
  const submit = async () => {
    setBusy(true);
    try {
      const r = await axios.post(`${API_URL}/public/b2b/${token}/orders/${order.id}/cancel-request`, { reason });
      toast.success(r.data.message);
      onDone();
      onClose();
    } catch (e) { toast.error(e.response?.data?.detail || "Talep gönderilemedi."); } finally { setBusy(false); }
  };
  return (
    <div className="fixed inset-0 z-[70] bg-slate-900/50 flex items-center justify-center p-4" {...backdropDismissProps(onClose)}>
      <div className="bg-white rounded-2xl max-w-md w-full p-5 space-y-3 text-xs shadow-2xl" onClick={(e) => e.stopPropagation()} data-testid="b2b-cancel-modal">
        <div className="flex justify-between items-start"><div><h3 className="text-sm font-bold text-slate-900">İptal talebi gönder</h3><p className="text-slate-500">{order.order_number} onaylandı; satıcı talebinizi değerlendirecek.</p></div><button type="button" onClick={onClose} className="text-slate-400"><X className="w-5 h-5" /></button></div>
        <textarea value={reason} onChange={(e) => setReason(e.target.value)} rows={3} placeholder="İptal gerekçesi (isteğe bağlı)" className="w-full border rounded-xl p-2.5" data-testid="b2b-cancel-reason" />
        <div className="flex justify-end gap-2"><button type="button" onClick={onClose} className="px-3 py-1.5 border rounded-lg">Vazgeç</button><button type="button" onClick={submit} disabled={busy} className="px-4 py-1.5 bg-amber-600 text-white rounded-lg font-semibold disabled:opacity-50" data-testid="b2b-cancel-submit">{busy ? "Gönderiliyor…" : "Talep gönder"}</button></div>
      </div>
    </div>
  );
};

export const OrdersList = ({ orders, heldRows = [], token, products, company, onChanged }) => {
  const [edit, setEdit] = useState(null);
  const [cancel, setCancel] = useState(null);
  const [preview, setPreview] = useState(null);
  const [busyId, setBusyId] = useState(null);
  const canMutate = Boolean(token);
  const rows = [...(heldRows || []), ...(orders || [])];
  const remove = async (o) => {
    if (o.view_only || o.is_held_cart) return;
    if (!window.confirm(`${o.order_number} silinsin mi? Beklemedeki sipariş çöp kutusuna taşınır.`)) return;
    setBusyId(o.id);
    try {
      const r = await axios.delete(`${API_URL}/public/b2b/${token}/orders/${o.id}`);
      toast.success(r.data.message);
      onChanged?.();
    } catch (e) { toast.error(e.response?.data?.detail || "Silinemedi."); } finally { setBusyId(null); }
  };
  const rowClass = (o) => (o.is_held_cart ? "opacity-60 bg-slate-50/80" : "");
  return (
    <div className="bg-white rounded-2xl border overflow-hidden" data-testid="b2b-orders">
      {rows.length === 0 && <div className="p-8 text-center text-slate-400 text-xs">Henüz sipariş yok.</div>}
      <div className="md:hidden divide-y">{rows.map((o) => (
        <div key={o.id} className={`p-3 text-xs space-y-2 ${rowClass(o)}`} data-testid={o.is_held_cart ? `b2b-held-row-${o.id}` : `b2b-order-${o.order_number}`}>
          <div className="flex items-center justify-between gap-2"><span className={`font-mono font-bold ${o.is_held_cart ? "text-slate-500" : ""}`}>{o.order_number}</span><OrderStatusBadge o={o} /></div>
          {o.customer_order_number ? <div className="text-slate-500">Sizin no: <span className="font-mono font-semibold">{o.customer_order_number}</span></div> : null}
          <div className="text-slate-500">{(o.order_date || "").slice(0, 10)} · {(o.items || []).map((i) => formatOrderItemLabel(i)).join(", ")}</div>
          <div className="flex items-center justify-between gap-2"><span className="font-bold text-sm">{fmt(b2bOrderGross(o))}</span></div>
          {!o.is_held_cart && <OrderProgressCell o={o} />}
          <OrderActions
            o={o}
            onPreview={setPreview}
            onEdit={!o.view_only && canMutate ? setEdit : undefined}
            onDelete={!o.view_only && canMutate ? remove : undefined}
            onCancel={!o.view_only && canMutate ? setCancel : undefined}
            busy={busyId === o.id}
          />
        </div>))}</div>
      {rows.length > 0 && (
        <table className="hidden md:table w-full text-xs">
          <thead className="bg-slate-50 text-slate-500 uppercase text-[10px] border-b">
            <tr><Th>Sipariş</Th><Th>Sizin no</Th><Th>Tarih</Th><Th>Kalem</Th><Th right>Tutar</Th><Th>Durum</Th><Th>Takip</Th><Th>İşlem</Th></tr>
          </thead>
          <tbody className="divide-y">
            {rows.map((o) => (
              <tr key={o.id} className={rowClass(o)} data-testid={o.is_held_cart ? `b2b-held-row-${o.id}` : `b2b-order-row-${o.order_number}`}>
                <td className={`p-3 font-mono font-bold ${o.is_held_cart ? "text-slate-500" : ""}`}>{o.order_number}</td>
                <td className="p-3 font-mono text-slate-600">{o.customer_order_number || "—"}</td>
                <td className="p-3 text-slate-500">{(o.order_date || "").slice(0, 10)}</td>
                <td className="p-3">{(o.items || []).map((i) => formatOrderItemLabel(i)).join(", ")}</td>
                <td className="p-3 text-right font-bold">{fmt(b2bOrderGross(o))}</td>
                <td className="p-3"><OrderStatusBadge o={o} /></td>
                <td className="p-3 min-w-[220px]"><OrderProgressCell o={o} /></td>
                <td className="p-3">
                  <OrderActions
                    o={o}
                    onPreview={setPreview}
                    onEdit={!o.view_only && canMutate ? setEdit : undefined}
                    onDelete={!o.view_only && canMutate ? remove : undefined}
                    onCancel={!o.view_only && canMutate ? setCancel : undefined}
                    busy={busyId === o.id}
                  />
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
      {preview && <B2BOrderPreview order={preview} products={products} company={company} onClose={() => setPreview(null)} />}
      {edit && <EditOrderModal order={edit} products={products} token={token} onClose={() => setEdit(null)} onDone={onChanged} />}
      {cancel && <CancelRequestModal order={cancel} token={token} onClose={() => setCancel(null)} onDone={onChanged} />}
    </div>
  );
};

const payStatus = (v) => (["paid", "partially_paid", "unpaid", "overdue"].includes(v) ? v : "unpaid");

export const StatementList = ({ invoices, company, balance }) => {
  const bal = balance || 0;
  return (
    <div className="bg-white rounded-2xl border overflow-hidden" data-testid="b2b-statement">
      <div className="p-3 border-b flex flex-col sm:flex-row sm:justify-between gap-1 text-sm"><b>Faturalarım</b><span className="text-xs sm:text-sm">Güncel bakiye: <b className={bal > 0 ? "text-rose-600" : "text-emerald-600"}>{fmt(Math.abs(bal))} {bal > 0 ? "(borcunuz)" : bal < 0 ? "(alacağınız)" : ""}</b></span></div>
      {invoices.length === 0 && <div className="p-8 text-center text-slate-400 text-xs">Fatura yok.</div>}
      <div className="md:hidden divide-y">{invoices.map((i) => (
        <div key={i.invoice_number} className="p-3 text-xs space-y-1" data-testid={`b2b-invoice-${i.invoice_number}`}>
          <div className="flex items-center justify-between gap-2"><span className="font-mono font-bold">{i.invoice_number}</span><span className={`px-1.5 py-0.5 rounded font-semibold ${payStatus(i.payment_status) === "paid" ? "bg-emerald-50 text-emerald-700" : "bg-amber-50 text-amber-700"}`}>{statusTr(payStatus(i.payment_status))}</span></div>
          <div className="text-slate-500">Tarih {fmtDate(i.issue_date)}{i.due_date ? ` · Vade ${fmtDate(i.due_date)}` : ""}</div>
          <div className="flex items-center justify-between"><span className="font-bold text-sm">{fmt(i.grand_total)}</span><span className="text-slate-500">Ödenen {fmt(i.paid_amount)}{i.grand_total - (i.paid_amount || 0) > 0.01 && <b className="text-rose-600 ml-1">· kalan {fmt(i.grand_total - (i.paid_amount || 0))}</b>}</span></div>
        </div>))}</div>
      {invoices.length > 0 && <table className="hidden md:table w-full text-xs"><thead className="bg-slate-50 text-slate-500 uppercase text-[10px] border-b"><tr><Th>Fatura</Th><Th>Tarih</Th><Th>Vade</Th><Th right>Tutar</Th><Th right>Ödenen</Th><Th>Durum</Th></tr></thead><tbody className="divide-y">{invoices.map((i) => <tr key={i.invoice_number}><td className="p-3 font-mono font-bold">{i.invoice_number}</td><td className="p-3">{fmtDate(i.issue_date)}</td><td className="p-3">{i.due_date ? fmtDate(i.due_date) : "-"}</td><td className="p-3 text-right font-bold">{fmt(i.grand_total)}</td><td className="p-3 text-right">{fmt(i.paid_amount)}</td><td className="p-3"><span className={`px-1.5 py-0.5 rounded font-semibold ${payStatus(i.payment_status) === "paid" ? "bg-emerald-50 text-emerald-700" : "bg-amber-50 text-amber-700"}`}>{statusTr(payStatus(i.payment_status))}</span></td></tr>)}</tbody></table>}
      {company.iban && <div className="p-3 text-xs text-slate-500 border-t break-all">Ödeme için: <b>{company.bank_name}</b> IBAN <span className="font-mono">{company.iban}</span></div>}
    </div>
  );
};
