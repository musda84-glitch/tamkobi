import React, { useCallback, useEffect, useRef, useState } from "react";
import axios from "axios";
import { toast } from "sonner";
import { useNavigate, useSearchParams } from "react-router-dom";
import { API_URL, useAuth } from "../context/AuthContext";
import { ScanButton } from "../components/CameraScanner";
import { resolveImageUrl } from "../utils/imageUrl";
import { notifyDataChanged } from "../utils/dataRefresh";

import { Barcode } from "../components/BarcodeLabelPrint";
import { expandPickLabelJobs } from "../utils/pickLabels";
import {
  ArrowLeft, Bell, CheckCircle2, Factory, Minus, Package, Plus, Printer, RefreshCw, ScanLine, Truck,
} from "lucide-react";


let _overscanAudioCtx = null;

const unlockOverscanAudio = () => {
  try {
    const Ctx = window.AudioContext || window.webkitAudioContext;
    if (!Ctx) return null;
    if (!_overscanAudioCtx) _overscanAudioCtx = new Ctx();
    if (_overscanAudioCtx.state === "suspended") _overscanAudioCtx.resume().catch(() => {});
    return _overscanAudioCtx;
  } catch (_) {
    return null;
  }
};

const playOverscanBeep = () => {
  try {
    const ctx = unlockOverscanAudio();
    if (!ctx) return;
    const now = ctx.currentTime;
    // Triple alarm beep — audible even in noisy warehouses
    [0, 0.16, 0.32, 0.55].forEach((at, i) => {
      const o = ctx.createOscillator();
      const g = ctx.createGain();
      o.type = "square";
      o.frequency.value = i % 2 === 0 ? 480 : 920;
      g.gain.setValueAtTime(0.0001, now + at);
      g.gain.exponentialRampToValueAtTime(0.32, now + at + 0.015);
      g.gain.exponentialRampToValueAtTime(0.0001, now + at + 0.13);
      o.connect(g);
      g.connect(ctx.destination);
      o.start(now + at);
      o.stop(now + at + 0.15);
    });
  } catch (_) { /* ignore */ }
};

const detailText = (detail) => {
  if (!detail) return "Okutulamadı.";
  if (typeof detail === "string") return detail;
  return detail.message || detail.detail || "Okutulamadı.";
};

const lineCodes = (it) =>
  [it?.barcode, it?.sku, it?.ean, it?.product_code]
    .filter(Boolean)
    .map((x) => String(x).trim().toLowerCase());

const findScanLine = (items, raw) => {
  const n = String(raw || "").trim().toLowerCase();
  if (!n) return null;
  const exact = (items || []).filter((it) => lineCodes(it).includes(n));
  if (!exact.length) return null;
  return exact.find((it) => Number(it.picked_qty) < Number(it.ordered_qty) - 1e-9) || exact[0];
};

const isLineComplete = (it) =>
  it && Number(it.picked_qty) >= Number(it.ordered_qty) - 1e-9;

const ST = {
  idle: ["Bekliyor", "bg-slate-100 text-slate-600"],
  open: ["Açık", "bg-sky-50 text-sky-700"],
  picking: ["Toplanıyor", "bg-amber-50 text-amber-800"],
  ready: ["Hazır", "bg-emerald-50 text-emerald-700"],
  partial: ["Kısmi", "bg-violet-50 text-violet-700"],
  shipped: ["Sevk", "bg-slate-900 text-white"],
};

export default function OrderPickKioskPage() {
  const { activeCompany } = useAuth();
  const companyId = activeCompany?.id || activeCompany?._id || "comp_nexus_main_01";
  const navigate = useNavigate();
  const [params, setParams] = useSearchParams();
  const orderId = params.get("order");
  const [rows, setRows] = useState([]);
  const [ses, setSes] = useState(null);
  const [code, setCode] = useState("");
  const [busy, setBusy] = useState(false);
  const [qtyDrafts, setQtyDrafts] = useState({});
  const [overscanFlash, setOverscanFlash] = useState(null);
  const [labelJobs, setLabelJobs] = useState(null);
  const inputRef = useRef(null);
  const overscanTimer = useRef(null);
  const qtyCancelRef = useRef(false);

  const loadList = useCallback(async () => {
    try {
      const r = await axios.get(`${API_URL}/order-picks?company_id=${companyId}`);
      setRows(r.data);
    } catch { toast.error("Siparişler alınamadı."); }
  }, [companyId]);

  const openOrder = useCallback(async (id) => {
    try {
      const r = await axios.get(`${API_URL}/order-picks/${id}`);
      setSes(r.data);
      setQtyDrafts({});
      setParams({ order: id }, { replace: true });
      setTimeout(() => inputRef.current?.focus(), 80);
    } catch (e) { toast.error(e.response?.data?.detail || "Sipariş açılamadı."); }
  }, [setParams]);

  useEffect(() => { loadList(); }, [loadList]);
  useEffect(() => { if (orderId) openOrder(orderId); else setSes(null); }, [orderId, openOrder]);

  // Unlock Web Audio on first gesture so overscan beeps work under autoplay policy.
  useEffect(() => {
    const unlock = () => unlockOverscanAudio();
    window.addEventListener("pointerdown", unlock, { once: true });
    window.addEventListener("keydown", unlock, { once: true });
    return () => {
      window.removeEventListener("pointerdown", unlock);
      window.removeEventListener("keydown", unlock);
      if (overscanTimer.current) clearTimeout(overscanTimer.current);
    };
  }, []);

  const triggerOverscan = useCallback((opts = {}) => {
    const msg = opts.message || "Sipariş adedi tamamlandı. Fazla ürün okutmayın.";
    unlockOverscanAudio();
    playOverscanBeep();
    setOverscanFlash({
      message: msg,
      productName: opts.productName,
      lineIndex: opts.lineIndex,
      at: Date.now(),
    });
    toast.error(msg, { duration: 5000 });
    if (navigator.vibrate) navigator.vibrate([80, 60, 80, 60, 160]);
    if (overscanTimer.current) clearTimeout(overscanTimer.current);
    overscanTimer.current = setTimeout(() => setOverscanFlash(null), 2800);
  }, []);

  const back = () => { setSes(null); setParams({}, { replace: true }); loadList(); };

  const printLabels = (items) => {
    const jobs = expandPickLabelJobs(items);
    if (!jobs.length) { toast.error("Yazdırılacak etiket yok."); return; }
    setLabelJobs(jobs);
    toast.success(`${jobs.length} ürün etiketi yazdırmaya gönderildi.`);
    setTimeout(() => window.print(), 250);
  };

  const scan = async (raw) => {
    const c = String(raw || code).trim();
    if (!c || !ses || busy) return;
    unlockOverscanAudio();

    // Instant client-side guard when the matched line is already full (2/2 etc.)
    const localLine = findScanLine(ses.items, c);
    if (localLine && isLineComplete(localLine)) {
      setCode("");
      triggerOverscan({
        message: `${localLine.product_name}: siparişte ${Number(localLine.ordered_qty)} adet var, ${Number(localLine.picked_qty)} okutuldu. Fazla ürün okutmayın.`,
        productName: localLine.product_name,
        lineIndex: localLine.line_index,
      });
      setTimeout(() => inputRef.current?.focus(), 50);
      return;
    }

    setBusy(true);
    try {
      const r = await axios.post(`${API_URL}/order-picks/${ses.order_id}/scan`, { barcode: c, quantity: 1 });
      setSes(r.data);
      setCode("");
      setOverscanFlash(null);
      toast.success(r.data.message);
      if (navigator.vibrate) navigator.vibrate(40);
    } catch (e) {
      const detail = e.response?.data?.detail;
      const overscan = e.response?.status === 409 || detail?.code === "overscan" || /fazla/i.test(detailText(detail));
      const msg = detailText(detail);
      setCode("");
      if (overscan) {
        triggerOverscan({
          message: msg,
          productName: detail?.product_name,
          lineIndex: detail?.line_index,
        });
      } else {
        toast.error(msg);
        if (navigator.vibrate) navigator.vibrate([40, 40, 80]);
      }
    } finally { setBusy(false); setTimeout(() => inputRef.current?.focus(), 50); }
  };

  const applyPickedQty = async (item, rawQty) => {
    if (busy) return;
    unlockOverscanAudio();
    const ordered = Number(item.ordered_qty) || 0;
    const current = Number(item.picked_qty) || 0;
    let next = Number(rawQty);
    if (!Number.isFinite(next)) next = current;
    next = Math.max(0, next);
    if (next > ordered) {
      triggerOverscan({
        message: `${item.product_name}: siparişte ${ordered} adet var, ${current} okutuldu. Fazla ürün okutmayın.`,
        productName: item.product_name,
        lineIndex: item.line_index,
      });
      next = ordered;
    }
    if (Math.abs(next - current) < 1e-9) return;
    try {
      const r = await axios.post(`${API_URL}/order-picks/${ses.order_id}/adjust`, {
        product_id: item.product_id,
        product_name: item.product_name,
        line_index: item.line_index,
        picked_qty: next,
      });
      setSes(r.data);
      setQtyDrafts({});
    } catch (e) {
      toast.error(e.response?.data?.detail || "Güncellenemedi.");
    }
  };

  const bump = async (item, delta) => {
    if (busy) return;
    unlockOverscanAudio();
    if (delta > 0 && isLineComplete(item)) {
      triggerOverscan({
        message: `${item.product_name}: siparişte ${Number(item.ordered_qty)} adet var, ${Number(item.picked_qty)} okutuldu. Fazla ürün okutmayın.`,
        productName: item.product_name,
        lineIndex: item.line_index,
      });
      return;
    }
    const next = Math.max(0, Math.min(Number(item.ordered_qty) || 0, (Number(item.picked_qty) || 0) + delta));
    await applyPickedQty(item, next);
  };

  const act = async (path, body, ok) => {
    if (!ses?.order_id || busy) return;
    setBusy(true);
    try {
      const r = await axios.post(`${API_URL}/order-picks/${ses.order_id}/${path}`, body || {});
      if (r.data.items) setSes(r.data);
      const msg = r.data.message || ok;
      if (path === "to-production" && Array.isArray(r.data.created) && r.data.created.length === 0) {
        toast.error(msg || "Üretim emri açılamadı.");
      } else {
        toast.success(msg);
      }
      if (path === "notify-missing" || path === "to-production") {
        await notifyDataChanged({ companyId, scopes: ["orders", "notifications", "all"] });
      }
      if (path === "complete" && body?.mode === "ship") {
        if (r.data.draft_invoice_number) {
          toast.message(`Taslak fatura: ${r.data.draft_invoice_number}`, { duration: 6000 });
        } else if (r.data.draft_invoice_error) {
          toast.error(r.data.draft_invoice_error, { duration: 7000 });
        }
      }
      if (path === "complete") { back(); }
      return r.data;
    } catch (e) {
      const d = e.response?.data?.detail;
      toast.error(typeof d === "string" ? d : d?.message || "İşlem başarısız.");
    } finally { setBusy(false); }
  };

  const prog = ses?.progress || {};
  const pct = prog.ordered ? Math.round((prog.picked / prog.ordered) * 100) : 0;

  if (!ses) {
    return (
      <div className="space-y-4" data-testid="order-pick-kiosk">
        <div className="flex flex-wrap items-end justify-between gap-3">
          <div>
            <h1 className="text-xl sm:text-2xl font-bold text-slate-900 flex items-center gap-2"><ScanLine className="w-6 h-6 text-emerald-600" /> Depo Sevkiyatı</h1>
            <p className="text-xs sm:text-sm text-slate-500">Siparişi açın, barkodu okutun, eksikleri yöneticiye bildirin. Kısmi teslimat desteklenir.</p>
          </div>
          <button onClick={loadList} className="p-2.5 bg-white border rounded-xl" data-testid="pick-refresh"><RefreshCw className="w-4 h-4" /></button>
        </div>
        <div className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-3 gap-3">
          {rows.length === 0 && <div className="col-span-full bg-white border rounded-2xl p-10 text-center text-slate-400" data-testid="pick-empty">Toplanacak sipariş yok.</div>}
          {rows.map((o) => {
            const [lab, cls] = ST[o.pick_status] || ST.idle;
            const p = o.progress || {};
            return (
              <button key={o.id} onClick={() => openOrder(o.id)} className="text-left bg-white border border-slate-200 rounded-2xl p-4 hover:border-emerald-400 hover:shadow-md transition space-y-2" data-testid={`pick-card-${o.order_number}`}>
                <div className="flex justify-between gap-2"><span className="font-mono font-bold text-slate-900">{o.order_number}</span><span className={`text-[10px] font-bold px-2 py-0.5 rounded-lg ${cls}`}>{lab}</span></div>
                <div className="font-semibold text-slate-800 truncate">{o.customer_name}</div>
                <div className="text-[11px] text-slate-500">{o.city || "—"} · {o.item_count} kalem</div>
                <div className="h-2 bg-slate-100 rounded-full overflow-hidden"><div className="h-2 bg-emerald-500" style={{ width: `${p.ordered ? Math.round((p.picked / p.ordered) * 100) : 0}%` }} /></div>
                <div className="text-[11px] font-semibold text-slate-600">{p.picked || 0}/{p.ordered || 0} okutuldu</div>
              </button>
            );
          })}
        </div>
      </div>
    );
  }

  return (
    <div className="fixed inset-0 z-[80] bg-slate-100 flex flex-col" data-testid="order-pick-session">
      {overscanFlash && (
        <div className="print:hidden">
          <div className="absolute inset-0 z-[89] bg-rose-600/45 animate-pulse pointer-events-none" data-testid="pick-overscan-flash" />
          <div className="absolute inset-x-0 top-0 z-[90] pointer-events-none" data-testid="pick-overscan-alert">
            <div className="m-3 rounded-2xl border-2 border-rose-500 bg-rose-600 text-white px-4 py-4 shadow-2xl animate-pulse">
              <div className="text-base sm:text-lg font-black tracking-wide">FAZLA ÜRÜN OKUTULDU</div>
              <div className="text-sm font-semibold mt-1 opacity-95">{overscanFlash.message}</div>
            </div>
          </div>
        </div>
      )}
      <div className="bg-slate-900 text-white px-3 py-3 flex items-center gap-2 print:hidden">
        <button onClick={back} className="p-2 rounded-lg bg-white/10" data-testid="pick-back"><ArrowLeft className="w-5 h-5" /></button>
        <div className="min-w-0 flex-1">
          <div className="font-mono font-bold truncate">{ses.order_number}</div>
          <div className="text-[11px] text-slate-300 truncate">{ses.customer_name} · {ses.city || ""}</div>
        </div>
        <div className="text-right"><div className="text-lg font-black">{pct}%</div><div className="text-[10px] text-slate-400">{prog.picked}/{prog.ordered}</div></div>
        <button type="button" disabled={busy || !(ses.items || []).length} onClick={() => printLabels(ses.items)} className="px-3 py-2 rounded-lg bg-white/10 font-bold text-xs flex items-center gap-1.5" data-testid="pick-print-labels">
          <Printer className="w-4 h-4" /> Etiket yazdır
        </button>
      </div>
      <form className="bg-white border-b p-3 flex gap-2 print:hidden" onSubmit={(e) => { e.preventDefault(); scan(); }}>
        <input ref={inputRef} value={code} onChange={(e) => setCode(e.target.value)} onFocus={unlockOverscanAudio} placeholder="Barkod / SKU okutun veya yazın" autoComplete="off" inputMode="text" className="flex-1 text-lg font-mono border-2 border-slate-300 rounded-xl px-3 py-3" data-testid="pick-scan-input" />
        <ScanButton onScan={(t) => scan(t)} continuous title="Sipariş barkodu" label="Kamera" className="!py-3" />
        <button type="submit" disabled={busy} className="px-4 bg-emerald-600 text-white rounded-xl font-bold" data-testid="pick-scan-btn">Okut</button>
      </form>
      <div className="flex-1 overflow-y-auto p-3 space-y-2 print:hidden">
        {(ses.items || []).map((it, idx) => {
          const done = isLineComplete(it);
          const img = resolveImageUrl(it.image_url);
          const warnLine = overscanFlash && (
            overscanFlash.lineIndex === it.line_index
            || overscanFlash.lineIndex === idx
            || String(it.product_name) === String(overscanFlash.productName)
          );
          return (
            <div key={idx} className={`bg-white rounded-2xl border p-3 flex gap-3 items-center transition ${warnLine ? "border-rose-500 ring-2 ring-rose-400 bg-rose-50 animate-pulse relative z-[91]" : done ? "border-emerald-300" : "border-slate-200"}`} data-testid={`pick-line-${idx}`}>
              {img ? <img src={img} alt="" className="w-14 h-14 rounded-xl object-cover border bg-white shrink-0" /> : <div className="w-14 h-14 rounded-xl border bg-slate-50 flex items-center justify-center text-slate-300 shrink-0"><Package className="w-6 h-6" /></div>}
              <div className="min-w-0 flex-1">
                <div className="font-bold text-slate-900 leading-tight">{it.product_name}</div>
                <div className="text-[11px] text-slate-500 font-mono">{it.sku || it.barcode || "—"}</div>
                <div className="h-1.5 bg-slate-100 rounded-full mt-1 overflow-hidden"><div className={`h-1.5 ${warnLine ? "bg-rose-500" : done ? "bg-emerald-500" : "bg-amber-400"}`} style={{ width: `${it.ordered_qty ? Math.min(100, (it.picked_qty / it.ordered_qty) * 100) : 0}%` }} /></div>
              </div>
              <div className="flex items-center gap-1 shrink-0">
                <button onClick={() => bump(it, -1)} className="w-11 h-11 rounded-xl bg-slate-100 font-bold" data-testid={`pick-minus-${idx}`}><Minus className="w-5 h-5 mx-auto" /></button>
                <div className="w-14 text-center">
                  <input
                    type="number"
                    inputMode="decimal"
                    step="any"
                    min={0}
                    max={it.ordered_qty}
                    value={qtyDrafts[idx] ?? it.picked_qty}
                    disabled={busy}
                    onFocus={(e) => { unlockOverscanAudio(); e.target.select(); setQtyDrafts((d) => ({ ...d, [idx]: String(it.picked_qty) })); }}
                    onChange={(e) => setQtyDrafts((d) => ({ ...d, [idx]: e.target.value }))}
                    onBlur={() => {
                      if (qtyCancelRef.current) {
                        qtyCancelRef.current = false;
                        setQtyDrafts((d) => { const n = { ...d }; delete n[idx]; return n; });
                        return;
                      }
                      const raw = qtyDrafts[idx];
                      setQtyDrafts((d) => { const n = { ...d }; delete n[idx]; return n; });
                      if (raw === undefined || raw === "") return;
                      applyPickedQty(it, raw);
                    }}
                    onKeyDown={(e) => {
                      if (e.key === "Enter") { e.currentTarget.blur(); }
                      if (e.key === "Escape") {
                        qtyCancelRef.current = true;
                        setQtyDrafts((d) => { const n = { ...d }; delete n[idx]; return n; });
                        e.currentTarget.blur();
                      }
                    }}
                    className={`w-full text-center text-xl font-black bg-transparent border-b-2 outline-none py-0 ${warnLine ? "text-rose-700 border-rose-400" : "border-slate-200 focus:border-emerald-500"}`}
                    data-testid={`pick-qty-input-${idx}`}
                    aria-label="Okutulan miktar"
                  />
                  <div className="text-[10px] text-slate-400">/ {it.ordered_qty}</div>
                </div>
                <button onClick={() => bump(it, 1)} className={`w-11 h-11 rounded-xl font-bold ${done ? "bg-rose-50 text-rose-700" : "bg-emerald-50 text-emerald-800"}`} data-testid={`pick-plus-${idx}`}><Plus className="w-5 h-5 mx-auto" /></button>
                <button type="button" onClick={() => printLabels([it])} className="w-11 h-11 rounded-xl bg-slate-900 text-white" title="Etiket yazdır" data-testid={`pick-label-${idx}`}><Printer className="w-4 h-4 mx-auto" /></button>
              </div>
            </div>
          );
        })}
      </div>
      <div className="bg-white border-t p-3 grid grid-cols-2 sm:grid-cols-4 gap-2 print:hidden">
        <button disabled={busy} onClick={() => act("notify-missing", {}, "Bildirildi")} className="py-3 rounded-xl bg-amber-50 text-amber-900 font-bold text-sm flex items-center justify-center gap-1.5" data-testid="pick-notify-missing"><Bell className="w-4 h-4" /> Eksikleri bildir</button>
        <button disabled={busy} onClick={() => act("to-production", {}, "Üretime alındı")} className="py-3 rounded-xl bg-indigo-50 text-indigo-900 font-bold text-sm flex items-center justify-center gap-1.5" data-testid="pick-to-production"><Factory className="w-4 h-4" /> Üretime al</button>
        <button disabled={busy} onClick={() => act("complete", { mode: "partial" }, "Kısmi teslim")} className="py-3 rounded-xl bg-violet-600 text-white font-bold text-sm flex items-center justify-center gap-1.5" data-testid="pick-partial"><Package className="w-4 h-4" /> Kısmi teslim</button>
        <button disabled={busy} onClick={() => act("complete", { mode: prog.complete ? "ship" : "ready" })} className="py-3 rounded-xl bg-slate-900 text-white font-bold text-sm flex items-center justify-center gap-1.5" data-testid="pick-complete">
          {prog.complete ? <><Truck className="w-4 h-4" /> Sevk et</> : <><CheckCircle2 className="w-4 h-4" /> Hazır</>}
        </button>
      </div>
      <button type="button" onClick={() => navigate("/orders")} className="sr-only">siparişler</button>
      {labelJobs?.length ? (
        <div id="pick-label-print" className="hidden print:block bg-white text-slate-900" data-testid="pick-label-print">
          <style>{`@page{size:50mm 30mm;margin:0}.pick-product-label{width:50mm;height:30mm;box-sizing:border-box;padding:1.4mm 1.6mm;page-break-after:always;overflow:hidden;display:flex;flex-direction:column;gap:0.5mm}`}</style>
          {labelJobs.map((job, i) => (
            <div key={`${job.code || job.sku || job.name}-${i}`} className="pick-product-label" data-testid="pick-product-label">
              {activeCompany?.name ? <div className="text-[7px] font-extrabold uppercase tracking-wide text-slate-500 truncate">{activeCompany.name}</div> : null}
              <div className="text-[10px] font-extrabold leading-tight line-clamp-2">{job.name}</div>
              {job.sku ? <div className="font-mono text-[8px] text-slate-600">{job.sku}</div> : null}
              {job.code ? <div className="mt-auto"><Barcode value={job.code} height={28} width={1.15} fontSize={8} /></div> : <div className="text-[8px] font-bold text-rose-700">Barkod yok</div>}
            </div>
          ))}
        </div>
      ) : null}
    </div>
  );
}
