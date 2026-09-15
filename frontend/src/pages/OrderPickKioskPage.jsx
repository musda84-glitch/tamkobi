import React, { useCallback, useEffect, useRef, useState } from "react";
import axios from "axios";
import { toast } from "sonner";
import { useNavigate, useSearchParams } from "react-router-dom";
import { API_URL, useAuth } from "../context/AuthContext";
import { ScanButton } from "../components/CameraScanner";
import { resolveImageUrl } from "../utils/imageUrl";

import {
  ArrowLeft, Bell, CheckCircle2, Factory, Minus, Package, Plus, RefreshCw, ScanLine, Truck,
} from "lucide-react";


let _overscanAudioCtx = null;
const getOverscanAudioCtx = () => {
  const Ctx = window.AudioContext || window.webkitAudioContext;
  if (!Ctx) return null;
  if (!_overscanAudioCtx || _overscanAudioCtx.state === "closed") {
    _overscanAudioCtx = new Ctx();
  }
  return _overscanAudioCtx;
};

const playOverscanBeep = async () => {
  try {
    const ctx = getOverscanAudioCtx();
    if (!ctx) return;
    if (ctx.state === "suspended") await ctx.resume().catch(() => {});
    const now = ctx.currentTime;
    [0, 0.16, 0.32].forEach((at, i) => {
      const o = ctx.createOscillator();
      const g = ctx.createGain();
      o.type = "square";
      o.frequency.value = i === 1 ? 980 : 480;
      g.gain.setValueAtTime(0.0001, now + at);
      g.gain.exponentialRampToValueAtTime(0.28, now + at + 0.015);
      g.gain.exponentialRampToValueAtTime(0.0001, now + at + 0.13);
      o.connect(g); g.connect(ctx.destination);
      o.start(now + at); o.stop(now + at + 0.15);
    });
  } catch (_) { /* ignore */ }
};

const unlockOverscanAudio = async () => {
  try {
    const ctx = getOverscanAudioCtx();
    if (ctx?.state === "suspended") await ctx.resume().catch(() => {});
  } catch (_) { /* ignore */ }
};

const detailText = (detail) => {
  if (!detail) return "Okutulamadı.";
  if (typeof detail === "string") return detail;
  return detail.message || detail.detail || "Okutulamadı.";
};

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
  const [overscanFlash, setOverscanFlash] = useState(null);
  const inputRef = useRef(null);
  const overscanTimer = useRef(null);

  const triggerOverscan = useCallback((payload) => {
    const msg = payload?.message || "Fazla ürün okutuldu.";
    playOverscanBeep();
    if (overscanTimer.current) clearTimeout(overscanTimer.current);
    setOverscanFlash({
      message: msg,
      productName: payload?.product_name || payload?.productName,
      lineIndex: payload?.line_index ?? payload?.lineIndex,
      at: Date.now(),
    });
    toast.error(msg, { duration: 5000 });
    if (navigator.vibrate) navigator.vibrate([80, 60, 80, 60, 160]);
    overscanTimer.current = setTimeout(() => setOverscanFlash(null), 2800);
  }, []);

  const loadList = useCallback(async () => {
    try {
      const r = await axios.get(`${API_URL}/order-picks?company_id=${companyId}`);
      setRows(r.data);
    } catch { toast.error("Siparişler alınamadı."); }
  }, [companyId]);

  const openOrder = useCallback(async (id) => {
    try {
      unlockOverscanAudio();
      const r = await axios.get(`${API_URL}/order-picks/${id}`);
      setSes(r.data);
      setParams({ order: id }, { replace: true });
      setTimeout(() => inputRef.current?.focus(), 80);
    } catch (e) { toast.error(e.response?.data?.detail || "Sipariş açılamadı."); }
  }, [setParams]);

  useEffect(() => { loadList(); }, [loadList]);
  useEffect(() => { if (orderId) openOrder(orderId); else setSes(null); }, [orderId, openOrder]);

  const back = () => { setSes(null); setParams({}, { replace: true }); loadList(); };

  const scan = async (raw) => {
    const c = String(raw || code).trim();
    if (!c || !ses || busy) return;
    unlockOverscanAudio();
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
      if (overscan) {
        triggerOverscan(typeof detail === "object" && detail ? { ...detail, message: detailText(detail) } : { message: detailText(detail) });
      } else {
        toast.error(detailText(detail));
        if (navigator.vibrate) navigator.vibrate([40, 40, 80]);
      }
    } finally { setBusy(false); setTimeout(() => inputRef.current?.focus(), 50); }
  };

  const bump = async (item, delta) => {
    if (busy) return;
    const ordered = Number(item.ordered_qty) || 0;
    const picked = Number(item.picked_qty) || 0;
    if (delta > 0 && picked + delta > ordered + 1e-9) {
      triggerOverscan({
        message: `${item.product_name}: siparişte ${ordered} adet var, ${picked} okutuldu. Fazla ürün eklemeyin.`,
        product_name: item.product_name,
        line_index: item.line_index,
      });
      return;
    }
    const next = Math.max(0, Math.min(ordered, picked + delta));
    try {
      const r = await axios.post(`${API_URL}/order-picks/${ses.order_id}/adjust`, { product_id: item.product_id, product_name: item.product_name, line_index: item.line_index, picked_qty: next });
      setSes(r.data);
    } catch (e) { toast.error(e.response?.data?.detail || "Güncellenemedi."); }
  };

  const act = async (path, body, ok) => {
    setBusy(true);
    try {
      const r = await axios.post(`${API_URL}/order-picks/${ses.order_id}/${path}`, body || {});
      if (r.data.items) setSes(r.data);
      const msg = r.data.message || ok;
      toast.success(msg);
      if (path === "complete" && r.data.draft_invoice_number) {
        toast.message(`Taslak fatura: ${r.data.draft_invoice_number}`, { duration: 5000 });
      }
      if (path === "complete") { back(); }
      return r.data;
    } catch (e) { toast.error(e.response?.data?.detail || "İşlem başarısız."); }
    finally { setBusy(false); }
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
        <div className="absolute inset-0 z-[90] pointer-events-none" data-testid="pick-overscan-alert">
          <div className="absolute inset-0 bg-rose-600/25 animate-pulse" />
          <div className="relative m-3 rounded-2xl border-2 border-rose-500 bg-rose-600 text-white px-4 py-3 shadow-xl animate-pulse">
            <div className="text-sm font-black tracking-wide">FAZLA ÜRÜN OKUTULDU</div>
            <div className="text-xs font-semibold mt-0.5 opacity-95">{overscanFlash.message}</div>
          </div>
        </div>
      )}
      <div className="bg-slate-900 text-white px-3 py-3 flex items-center gap-2">
        <button onClick={back} className="p-2 rounded-lg bg-white/10" data-testid="pick-back"><ArrowLeft className="w-5 h-5" /></button>
        <div className="min-w-0 flex-1">
          <div className="font-mono font-bold truncate">{ses.order_number}</div>
          <div className="text-[11px] text-slate-300 truncate">{ses.customer_name} · {ses.city || ""}</div>
        </div>
        <div className="text-right"><div className="text-lg font-black">{pct}%</div><div className="text-[10px] text-slate-400">{prog.picked}/{prog.ordered}</div></div>
      </div>
      <form className="bg-white border-b p-3 flex gap-2" onSubmit={(e) => { e.preventDefault(); scan(); }}>
        <input ref={inputRef} value={code} onChange={(e) => setCode(e.target.value)} placeholder="Barkod / SKU okutun veya yazın" autoComplete="off" inputMode="text" className="flex-1 text-lg font-mono border-2 border-slate-300 rounded-xl px-3 py-3" data-testid="pick-scan-input" />
        <ScanButton onScan={(t) => scan(t)} continuous title="Sipariş barkodu" label="Kamera" className="!py-3" />
        <button type="submit" disabled={busy} className="px-4 bg-emerald-600 text-white rounded-xl font-bold" data-testid="pick-scan-btn">Okut</button>
      </form>
      <div className="flex-1 overflow-y-auto p-3 space-y-2">
        {(ses.items || []).map((it, idx) => {
          const done = Number(it.picked_qty) >= Number(it.ordered_qty) - 1e-9;
          const img = resolveImageUrl(it.image_url);
          return (
            <div key={idx} className={`bg-white rounded-2xl border p-3 flex gap-3 items-center transition ${overscanFlash?.lineIndex === it.line_index || overscanFlash?.lineIndex === idx || (overscanFlash && String(it.product_name) === String(overscanFlash.productName)) ? "border-rose-500 ring-2 ring-rose-400 bg-rose-50 animate-pulse" : done ? "border-emerald-300" : "border-slate-200"}`} data-testid={`pick-line-${idx}`}>
              {img ? <img src={img} alt="" className="w-14 h-14 rounded-xl object-cover border bg-white shrink-0" /> : <div className="w-14 h-14 rounded-xl border bg-slate-50 flex items-center justify-center text-slate-300 shrink-0"><Package className="w-6 h-6" /></div>}
              <div className="min-w-0 flex-1">
                <div className="font-bold text-slate-900 leading-tight">{it.product_name}</div>
                <div className="text-[11px] text-slate-500 font-mono">{it.sku || it.barcode || "—"}</div>
                <div className="h-1.5 bg-slate-100 rounded-full mt-1 overflow-hidden"><div className={`h-1.5 ${done ? "bg-emerald-500" : "bg-amber-400"}`} style={{ width: `${it.ordered_qty ? Math.min(100, (it.picked_qty / it.ordered_qty) * 100) : 0}%` }} /></div>
              </div>
              <div className="flex items-center gap-1 shrink-0">
                <button onClick={() => bump(it, -1)} className="w-11 h-11 rounded-xl bg-slate-100 font-bold" data-testid={`pick-minus-${idx}`}><Minus className="w-5 h-5 mx-auto" /></button>
                <div className="w-14 text-center"><div className="text-xl font-black">{it.picked_qty}</div><div className="text-[10px] text-slate-400">/ {it.ordered_qty}</div></div>
                <button onClick={() => bump(it, 1)} className="w-11 h-11 rounded-xl bg-emerald-50 text-emerald-800 font-bold" data-testid={`pick-plus-${idx}`}><Plus className="w-5 h-5 mx-auto" /></button>
              </div>
            </div>
          );
        })}
      </div>
      <div className="bg-white border-t p-3 grid grid-cols-2 sm:grid-cols-4 gap-2">
        <button disabled={busy} onClick={() => act("notify-missing", {}, "Bildirildi")} className="py-3 rounded-xl bg-amber-50 text-amber-900 font-bold text-sm flex items-center justify-center gap-1.5" data-testid="pick-notify-missing"><Bell className="w-4 h-4" /> Eksikleri bildir</button>
        <button disabled={busy} onClick={() => act("to-production", {}, "Üretime alındı")} className="py-3 rounded-xl bg-indigo-50 text-indigo-900 font-bold text-sm flex items-center justify-center gap-1.5" data-testid="pick-to-production"><Factory className="w-4 h-4" /> Üretime al</button>
        <button disabled={busy} onClick={() => act("complete", { mode: "partial" }, "Kısmi teslim")} className="py-3 rounded-xl bg-violet-600 text-white font-bold text-sm flex items-center justify-center gap-1.5" data-testid="pick-partial"><Package className="w-4 h-4" /> Kısmi teslim</button>
        <button disabled={busy} onClick={() => act("complete", { mode: prog.complete ? "ship" : "ready" })} className="py-3 rounded-xl bg-slate-900 text-white font-bold text-sm flex items-center justify-center gap-1.5" data-testid="pick-complete">
          {prog.complete ? <><Truck className="w-4 h-4" /> Sevk et</> : <><CheckCircle2 className="w-4 h-4" /> Hazır</>}
        </button>
      </div>
      <button type="button" onClick={() => navigate("/orders")} className="sr-only">siparişler</button>
    </div>
  );
}
