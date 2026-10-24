import React, { useEffect, useState } from "react";
import axios from "axios";
import { toast } from "sonner";
import { X, Sparkles, Upload, Loader2, Link2 } from "lucide-react";
import { API_URL } from "../context/AuthContext";
import { ContactSearchSelect } from "./ContactSearchSelect";
import { DocumentLineEditor, LineTotalsFooter } from "./DocumentLineEditor";
import { DocumentFormModal } from "./DocumentFormModal";
import { computeLine, documentLineTotals, emptyLine, hydrateLine, lineFromProduct } from "../utils/documentLines";
import { orderLinesLocked } from "../utils/orderEdit";
import { orderDraftInvoiceCaption } from "../utils/orderMoreMenu";
import { postOrQueue } from "../offline/write";
import { safeReadProducts } from "../offline/db";
import { useEscape } from "../utils/useEscape";
import { formatTrAmount } from "../utils/money";
import { backdropDismissProps } from "../utils/modalBackdrop";
import { OrderAiCart } from "./B2BAiCart";

const inp = "w-full bg-slate-50 border border-slate-200 rounded-lg p-2 text-xs";
const fmt = (n) => formatTrAmount((Number(n) || 0));
const CHANNELS = [["manual", "Manuel / Telefon"], ["b2b", "B2B Bayi"], ["trendyol", "Trendyol"], ["hepsiburada", "Hepsiburada"], ["amazon", "Amazon"], ["n11", "n11"], ["shopify", "Shopify"], ["woocommerce", "WooCommerce"]];

export const NewOrderModal = ({ companyId, products, onClose, onSaved }) => {
  useEscape(onClose);
  const [catalog, setCatalog] = useState(products || []);
  useEffect(() => {
    if (products?.length) {
      setCatalog(products);
      return undefined;
    }
    let stop = false;
    safeReadProducts(companyId).then((rows) => { if (!stop && rows.length) setCatalog(rows); });
    return () => { stop = true; };
  }, [products, companyId]);
  const [f, setF] = useState({ contact_id: "", customer_name: "", customer_phone: "", customer_email: "", shipping_address: "", city: "", channel: "manual", notes: "" });
  const [items, setItems] = useState([computeLine(emptyLine())]);
  const [busy, setBusy] = useState(false);
  const pickContact = (id, c) => {
    setF({
      ...f,
      contact_id: id || "",
      customer_name: c?.name || (id ? f.customer_name : ""),
      customer_phone: c?.phone || (id ? f.customer_phone : ""),
      customer_email: c?.email || (id ? f.customer_email : ""),
      shipping_address: c?.address || (id ? f.shipping_address : ""),
      city: c?.city || (id ? f.city : ""),
    });
  };
  const totals = documentLineTotals(items);
  const save = async () => {
    if (!f.customer_name.trim()) { toast.error("Müşteri adı gerekli."); return; }
    const valid = items.map((it) => computeLine(it)).filter((it) => (it.product_name || it.name) && Number(it.quantity) > 0);
    if (!valid.length) { toast.error("En az bir ürün kalemi ekleyin."); return; }
    setBusy(true);
    try {
      const r = await postOrQueue(axios, { url: `${API_URL}/orders`, companyId, kind: "order_create", critical: true, expected: { grandTotal: totals.grandTotal }, body: { company_id: companyId, channel: f.channel, customer_name: f.customer_name.trim(), customer_phone: f.customer_phone, customer_email: f.customer_email, shipping_address: f.shipping_address || "-", city: f.city || "-", order_status: "pending", contact_id: f.contact_id || null, notes: f.notes,
        items: valid.map((it) => ({
          product_id: it.product_id || "",
          product_name: it.product_name || it.name,
          sku: it.sku || "",
          quantity: Number(it.quantity),
          unit: it.unit || "Adet",
          unit_price: Number(it.unit_price),
          unit_price_incl: Number(it.unit_price_incl),
          vat_rate: Number(it.vat_rate),
          discount_rate: Number(it.discount_rate || 0),
          total: Number(it.total),
          total_incl: Number(it.total_incl),
          vat_amount: Number(it.vat_amount),
          is_service: !!it.is_service,
        })),
        total_amount: totals.grandTotal,
        subtotal: totals.subtotal,
        vat_total: totals.vat,
        discount_total: totals.lineDiscount,
        grand_total: totals.grandTotal,
      } });
      if (r.data?.queued) { toast.success(r.data.message); onSaved(); onClose(); return; }
      toast.success(`Sipariş oluşturuldu: ${r.data.order_number}`); onSaved(); onClose();
    } catch (e) {
      const detail = e.response?.data?.detail;
      toast.error(typeof detail === "string" ? detail : detail?.message || e.message || "Sipariş oluşturulamadı.");
    } finally { setBusy(false); }
  };
  return (
    <DocumentFormModal
      testId="new-order-modal"
      zClass="z-[70]"
      maxWidthClass="max-w-6xl"
      panelClassName="text-xs"
      blur={false}
      onBackdropClose={onClose}
      header={(
        <div className="px-3 py-2 space-y-2">
        <div className="flex items-center justify-between"><h3 className="text-base font-bold text-slate-900">Yeni Sipariş Oluştur</h3><button type="button" onClick={onClose} className="p-1 rounded-lg hover:bg-slate-100" data-testid="new-order-close"><X className="w-4 h-4" /></button></div>
        <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
          <div className="md:col-span-2"><label className="block font-semibold mb-1">Cari (seçince bilgiler dolar)</label><ContactSearchSelect companyId={companyId} value={f.contact_id} valueLabel={f.customer_name} placeholder="Cari ara…" onChange={pickContact} testId="new-order-contact" /></div>
          <div><label className="block font-semibold mb-1">Kanal</label><select value={f.channel} onChange={(e) => setF({ ...f, channel: e.target.value })} className={inp} data-testid="new-order-channel">{CHANNELS.map(([k, l]) => <option key={k} value={k}>{l}</option>)}</select></div>
          <div><label className="block font-semibold mb-1">Müşteri Adı *</label><input value={f.customer_name} onChange={(e) => setF({ ...f, customer_name: e.target.value })} className={inp} data-testid="new-order-customer" /></div>
          <div><label className="block font-semibold mb-1">Telefon</label><input value={f.customer_phone} onChange={(e) => setF({ ...f, customer_phone: e.target.value })} className={inp} data-testid="new-order-phone" /></div>
          <div><label className="block font-semibold mb-1">E-posta</label><input value={f.customer_email} onChange={(e) => setF({ ...f, customer_email: e.target.value })} className={inp} data-testid="new-order-email" /></div>
          <div className="md:col-span-2"><label className="block font-semibold mb-1">Teslimat Adresi</label><input value={f.shipping_address} onChange={(e) => setF({ ...f, shipping_address: e.target.value })} className={inp} data-testid="new-order-address" /></div>
          <div><label className="block font-semibold mb-1">İl</label><input value={f.city} onChange={(e) => setF({ ...f, city: e.target.value })} className={inp} data-testid="new-order-city" /></div>
        </div>
        <OrderAiCart
          companyId={companyId}
          products={catalog}
          onApply={(sel) => {
            const byId = Object.fromEntries((catalog || []).map((p) => [p.id || p._id, p]));
            const lines = sel.map((i) => lineFromProduct(byId[i.product_id], { invoiceType: "sales", quantity: Number(i.quantity) || 1 }));
            const blank = (it) => !(it.product_id || it.product_name || it.name) && !(Number(it.unit_price) || Number(it.unit_price_incl));
            setItems((prev) => {
              const keep = (prev || []).filter((it) => !blank(it));
              const next = [...keep, ...lines];
              return next.length ? next : [computeLine(emptyLine())];
            });
          }}
        />
        </div>
      )}
      footer={(
        <div className="px-3 py-1.5 flex flex-wrap items-center justify-between gap-2">
        <LineTotalsFooter subtotal={totals.subtotal} vat={totals.vat} lineDiscount={totals.lineDiscount} grandTotal={totals.grandTotal} currency="TRY" />
        <div className="flex gap-2 ml-auto"><button type="button" onClick={onClose} className="h-8 px-3 border rounded-lg">İptal</button><button type="button" onClick={save} disabled={busy} className="h-8 px-3 bg-slate-900 text-white rounded-lg font-semibold disabled:opacity-50" data-testid="new-order-save">{busy ? "Kaydediliyor…" : "Siparişi Oluştur"}</button></div>
        </div>
      )}
    >
        <div className="px-3 py-2">
        <DocumentLineEditor
          items={items}
          onChange={setItems}
          products={catalog}
          kind="order"
          allowService
          invoiceType="sales"
          currency="TRY"
          testIdPrefix="new-order"
        />
        <details className="mt-1 rounded-md border border-slate-200 px-2 py-1">
          <summary className="cursor-pointer text-[11px] font-semibold text-slate-600">Sipariş notu</summary>
          <textarea value={f.notes} onChange={(e) => setF({ ...f, notes: e.target.value })} rows={2} placeholder="Sipariş notu" className={`${inp} mt-1`} data-testid="new-order-notes" />
        </details>
        </div>
    </DocumentFormModal>
  );
};

export const OrderEditModal = ({ order, products, onClose, onSaved }) => {
  useEscape(onClose);
  const linesLocked = orderLinesLocked(order);
  const [notes, setNotes] = useState(order?.notes || "");
  const [po, setPo] = useState(order?.customer_order_number || "");
  const [items, setItems] = useState(() => (order?.items || []).map((it) => hydrateLine(it)));
  const [busy, setBusy] = useState(false);
  const save = async () => {
    const valid = items.map((it) => computeLine(it)).filter((it) => (it.product_name || it.name) && Number(it.quantity) > 0);
    if (!linesLocked && !valid.length) { toast.error("Siparişte en az bir kalem olmalı."); return; }
    setBusy(true);
    try {
      const payload = { notes, customer_order_number: po };
      if (!linesLocked) {
        payload.items = valid.map((it) => ({
          product_id: it.product_id || "",
          product_name: it.product_name || it.name,
          sku: it.sku || "",
          quantity: Number(it.quantity),
          unit: it.unit || "Adet",
          unit_price: Number(it.unit_price),
          unit_price_incl: Number(it.unit_price_incl),
          vat_rate: Number(it.vat_rate),
          discount_rate: Number(it.discount_rate || 0),
          total: Number(it.total),
          total_incl: Number(it.total_incl),
          vat_amount: Number(it.vat_amount),
          is_service: !!it.is_service,
        }));
      }
      const r = await axios.put(`${API_URL}/orders/${order.id || order._id}`, payload);
      toast.success(r.data.message || "Sipariş güncellendi.");
      onSaved?.(r.data);
      onClose();
    } catch (e) {
      toast.error(e.response?.data?.detail || "Sipariş güncellenemedi.");
    } finally {
      setBusy(false);
    }
  };
  return (
    <DocumentFormModal
      testId="edit-order-modal"
      zClass="z-[70]"
      maxWidthClass="max-w-6xl"
      panelClassName="text-xs"
      blur={false}
      onBackdropClose={onClose}
      header={(
        <div className="p-4 sm:p-5 pb-3 space-y-3">
        <div className="flex items-center justify-between">
          <h3 className="text-base font-bold text-slate-900">Siparişi Düzenle · {order.order_number}</h3>
          <button type="button" onClick={onClose} className="p-1 rounded-lg hover:bg-slate-100" data-testid="edit-order-close"><X className="w-4 h-4" /></button>
        </div>
        <p className="text-slate-500">Onaylı sipariş düzenlenebilir. E-belge kesildiyse kayıt kapanır.</p>
        {orderDraftInvoiceCaption(order) ? (
          <p className="text-[11px] text-slate-400" data-testid="order-draft-invoice-caption">{orderDraftInvoiceCaption(order)}</p>
        ) : null}
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
          <div><label className="block font-semibold mb-1">Müşteri sipariş no</label><input value={po} onChange={(e) => setPo(e.target.value)} className={inp} data-testid="edit-order-po" /></div>
          <div><label className="block font-semibold mb-1">Not</label><input value={notes} onChange={(e) => setNotes(e.target.value)} className={inp} data-testid="edit-order-notes" /></div>
        </div>
        {linesLocked ? (
          <div className="bg-amber-50 border border-amber-200 rounded-lg p-2 text-amber-800">Pazaryeri kalemleri değiştirilemez. Not ve müşteri sipariş numarası kaydedilir.</div>
        ) : null}
        </div>
      )}
      footer={(
        <div className="p-4 sm:p-5 flex justify-end gap-2">
          <button type="button" onClick={onClose} className="px-4 py-2 border rounded-lg">İptal</button>
          <button type="button" onClick={save} disabled={busy} className="px-5 py-2 bg-slate-900 text-white rounded-lg font-semibold disabled:opacity-50" data-testid="edit-order-save">{busy ? "Kaydediliyor…" : "Kaydet"}</button>
        </div>
      )}
    >
      {linesLocked ? null : (
        <div className="px-4 sm:px-5 py-3">
          <DocumentLineEditor items={items} onChange={setItems} products={products} kind="order" allowService invoiceType="sales" currency={order?.currency || "TRY"} testIdPrefix="edit-order" />
        </div>
      )}
    </DocumentFormModal>
  );
};

export const AiOrderImportModal = ({ companyId, onClose, onSaved }) => {
  useEscape(onClose);
  const [busy, setBusy] = useState(false);
  const [res, setRes] = useState(null);
  const [sel, setSel] = useState([]);
  const upload = async (file) => {
    if (!file) return;
    setBusy(true);
    const fd = new FormData(); fd.append("file", file);
    try { const r = await axios.post(`${API_URL}/ai/order-extract?company_id=${companyId}`, fd); setRes(r.data); setSel(r.data.orders.map((_, i) => i)); if (!r.data.count) toast.info("Dosyada sipariş bulunamadı."); }
    catch (e) { toast.error(e.response?.data?.detail || "Dosya işlenemedi."); } finally { setBusy(false); }
  };
  const confirm = async () => {
    const orders = res.orders.filter((_, i) => sel.includes(i));
    if (!orders.length) { toast.error("Sipariş seçin."); return; }
    setBusy(true);
    try { const r = await axios.post(`${API_URL}/ai/order-extract/confirm`, { company_id: companyId, orders }); toast.success(r.data.message); onSaved(); onClose(); }
    catch (e) { toast.error(e.response?.data?.detail || "Siparişler oluşturulamadı."); } finally { setBusy(false); }
  };
  return (
    <div className="fixed inset-0 z-[70] bg-slate-900/60 flex items-center justify-center p-4" {...backdropDismissProps(onClose)}>
      <div className="bg-white rounded-2xl w-full max-w-4xl max-h-[92vh] overflow-y-auto p-5 space-y-4 text-xs" onClick={(e) => e.stopPropagation()} data-testid="ai-order-modal">
        <div className="flex items-center justify-between"><h3 className="text-base font-bold text-slate-900 flex items-center gap-2"><Sparkles className="w-5 h-5 text-purple-600" /> AI ile Sipariş Yükle (PDF / Excel / CSV)</h3><button onClick={onClose} className="p-1 rounded-lg hover:bg-slate-100" data-testid="ai-order-close"><X className="w-4 h-4" /></button></div>
        {!res ? (
          <label className="block border-2 border-dashed border-purple-200 bg-purple-50/40 rounded-2xl p-10 text-center cursor-pointer hover:bg-purple-50" data-testid="ai-order-dropzone" onDragOver={(e) => e.preventDefault()} onDrop={(e) => { e.preventDefault(); upload(e.dataTransfer.files?.[0]); }}>
            <input type="file" accept=".pdf,.xlsx,.xlsm,.csv,.txt" className="hidden" onChange={(e) => upload(e.target.files?.[0])} data-testid="ai-order-file" />
            {busy ? <Loader2 className="w-8 h-8 mx-auto animate-spin text-purple-500" /> : <Upload className="w-8 h-8 mx-auto text-purple-400" />}
            <div className="mt-2 font-semibold text-slate-800">{busy ? "AI belgeyi okuyor…" : "Sipariş formu, proforma, bayi sipariş listesi veya pazaryeri Excel dökümünü sürükleyin / seçin"}</div>
            <div className="text-slate-500 mt-1">Yapay zekâ müşteri, adres ve kalemleri çıkarır; stok kartı ve cari eşleşmesi otomatik önerilir. Onaylamadan hiçbir kayıt oluşmaz.</div>
          </label>
        ) : (<>
          <div className="flex items-center justify-between"><span className="font-semibold">{res.filename} → <b>{res.count}</b> sipariş bulundu</span><button onClick={() => setRes(null)} className="px-3 py-1.5 border rounded-lg" data-testid="ai-order-reupload">Başka dosya</button></div>
          <div className="space-y-2">{res.orders.map((o, i) => (
            <div key={i} className={`border rounded-xl p-3 ${sel.includes(i) ? "border-purple-300 bg-purple-50/30" : "border-slate-200 opacity-60"}`} data-testid={`ai-order-${i}`}>
              <div className="flex items-start gap-2"><input type="checkbox" checked={sel.includes(i)} onChange={() => setSel(sel.includes(i) ? sel.filter((x) => x !== i) : [...sel, i])} className="mt-0.5" data-testid={`ai-order-select-${i}`} />
                <div className="flex-1"><div className="flex flex-wrap items-center gap-2"><b className="text-slate-900">{o.customer_name || "Müşteri ?"}</b>{o.contact_match ? <span className="text-emerald-700 flex items-center gap-0.5"><Link2 className="w-3 h-3" /> {o.contact_match}</span> : <span className="text-amber-700">yeni cari açılır</span>}<span className="text-slate-400">{o.order_number || "no üretilecek"} · {o.order_date || "bugün"} · {o.channel}</span><b className="ml-auto">{fmt(o.total_amount)} ₺</b></div>
                  <div className="text-[10px] text-slate-500">{[o.customer_phone, o.customer_email, o.shipping_address, o.city].filter(Boolean).join(" · ")}</div>
                  <div className="mt-1 grid grid-cols-1 sm:grid-cols-2 gap-1">{o.items.map((it, k) => <div key={k} className="bg-white border border-slate-100 rounded-lg px-2 py-1 flex justify-between"><span>{it.quantity}× {it.product_name}{it.product_match ? <span className="text-emerald-600 ml-1">✓ {it.product_match}</span> : <span className="text-amber-600 ml-1">(stok kartı eşleşmedi)</span>}</span><span className="font-semibold">{fmt(it.total)} ₺</span></div>)}</div>
                </div></div>
            </div>))}</div>
          <div className="flex justify-end gap-2"><button onClick={onClose} className="px-4 py-2 border rounded-lg">İptal</button><button onClick={confirm} disabled={busy || !sel.length} className="px-5 py-2 bg-purple-600 text-white rounded-lg font-semibold disabled:opacity-50" data-testid="ai-order-confirm">{busy ? "Oluşturuluyor…" : `${sel.length} Siparişi Oluştur`}</button></div>
        </>)}
      </div>
    </div>
  );
};
