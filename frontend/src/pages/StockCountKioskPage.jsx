import React, { useCallback, useEffect, useRef, useState } from "react";
import axios from "axios";
import { toast } from "sonner";
import { Link } from "react-router-dom";
import { API_URL, useAuth } from "../context/AuthContext";
import { CameraScanner } from "../components/CameraScanner";
import { parseScanQtyInput, scanQtyOnBlur, scanQtyOnFocus, scanQtyShown } from "../utils/scanQty";

import {
  ClipboardList, Plus, Scan, CheckCircle2, Minus, Maximize2, Minimize2,
  Loader2, AlertTriangle, ArrowLeft, Camera
} from "lucide-react";

const fmt = (n) => Number(n || 0).toLocaleString("tr-TR");

export default function StockCountKioskPage() {
  const { activeCompany } = useAuth();
  const companyId = activeCompany?.id || activeCompany?._id || "comp_nexus_main_01";
  const [warehouses, setWarehouses] = useState([]);
  const [counts, setCounts] = useState([]);
  const [active, setActive] = useState(null);
  const [barcode, setBarcode] = useState("");
  const [scanQty, setScanQty] = useState("1");
  const [last, setLast] = useState(null);
  const [busy, setBusy] = useState(false);
  const [kiosk, setKiosk] = useState(true);
  const [cam, setCam] = useState(null);
  const [showNew, setShowNew] = useState(false);
  const [newForm, setNewForm] = useState({ name: "", warehouse_id: "" });
  const inputRef = useRef(null);
  const qty = parseScanQtyInput(scanQty);

  const loadList = useCallback(async () => {
    try {
      const [c, w] = await Promise.all([
        axios.get(`${API_URL}/warehouses/stock-counts?company_id=${companyId}`),
        axios.get(`${API_URL}/warehouses?company_id=${companyId}`).catch(() => ({ data: [] })),
      ]);
      setCounts(c.data || []);
      setWarehouses(w.data || []);
    } catch { toast.error("Sayımlar yüklenemedi."); }
  }, [companyId]);
  useEffect(() => { loadList(); }, [loadList]);

  const open = async (id) => {
    const r = await axios.get(`${API_URL}/warehouses/stock-counts/${id}`);
    setActive(r.data);
    setLast(null);
    setTimeout(() => inputRef.current?.focus(), 80);
  };

  const create = async (e) => {
    e.preventDefault();
    try {
      const r = await axios.post(`${API_URL}/warehouses/stock-counts`, {
        company_id: companyId,
        name: newForm.name || undefined,
        warehouse_id: newForm.warehouse_id || null,
        preload_all: false,
      });
      toast.success("Sayım oturumu açıldı. Barkod okutmaya başlayın.");
      setShowNew(false);
      setNewForm({ name: "", warehouse_id: "" });
      await loadList();
      setActive(r.data);
      setTimeout(() => inputRef.current?.focus(), 80);
    } catch (err) { toast.error(err.response?.data?.detail || "Sayım açılamadı."); }
  };

  const scanCode = async (code) => {
    const c = String(code || "").trim();
    if (!c || !active?.id || active.status !== "open") return;
    const addQty = parseScanQtyInput(scanQty);
    try {
      const r = await axios.post(`${API_URL}/warehouses/stock-counts/${active.id}/scan`, { barcode: c, quantity: addQty });
      setLast(r.data.item);
      setBarcode("");
      const fresh = await axios.get(`${API_URL}/warehouses/stock-counts/${active.id}`);
      setActive(fresh.data);
      toast.success(r.data.message);
      if (navigator.vibrate) navigator.vibrate(40);
    } catch (err) {
      toast.error(err.response?.data?.detail || `Barkod eşleşmedi: ${c}`);
      setBarcode("");
      if (navigator.vibrate) navigator.vibrate([40, 40, 80]);
    }
    setTimeout(() => inputRef.current?.focus(), 50);
  };

  const bump = async (delta) => {
    if (!last || active?.status !== "open") return;
    const next = Math.max(0, Number(last.counted || 0) + delta);
    try {
      const r = await axios.put(`${API_URL}/warehouses/stock-counts/${active.id}/items`, {
        product_id: last.product_id, variant_id: last.variant_id, counted: next,
      });
      const item = (r.data.items || []).find((i) => i.product_id === last.product_id && i.variant_id === last.variant_id);
      setActive(r.data);
      if (item) setLast(item);
    } catch { toast.error("Adet güncellenemedi."); }
  };

  const complete = async (apply) => {
    if (!active) return;
    setBusy(true);
    try {
      const r = await axios.post(`${API_URL}/warehouses/stock-counts/${active.id}/complete`, { apply, only_scanned: true });
      toast.success(r.data.message);
      setActive(null);
      setLast(null);
      loadList();
    } catch (err) { toast.error(err.response?.data?.detail || "Tamamlanamadı."); }
    finally { setBusy(false); }
  };

  const scanned = (active?.items || []).filter((i) => i.scanned);
  const diffs = scanned.filter((i) => i.counted !== i.expected);
  const openSessions = counts.filter((c) => c.status === "open");

  const body = (
    <div className="max-w-xl mx-auto space-y-4 pb-8" data-testid="stock-count-kiosk">
      <div className="flex items-start justify-between gap-2">
        <div>
          <h1 className="text-xl font-black text-slate-900 tracking-tight flex items-center gap-2"><ClipboardList className="w-6 h-6 text-violet-600" /> Stok Sayımı</h1>
          <p className="text-xs text-slate-500">Telefon / tablet / el terminali — barkodu okutun, adeti düzeltin.</p>
        </div>
        <div className="flex gap-1.5">
          <button type="button" onClick={() => setKiosk(!kiosk)} className="p-2.5 bg-slate-900 text-white rounded-xl" data-testid="kiosk-toggle" title={kiosk ? "ERP menüsüne dön" : "Tam ekran"}>
            {kiosk ? <Minimize2 className="w-4 h-4" /> : <Maximize2 className="w-4 h-4" />}
          </button>
        </div>
      </div>

      {!active && (
        <div className="space-y-3">
          <button type="button" onClick={() => setShowNew(true)} className="w-full flex items-center justify-center gap-2 py-4 bg-violet-600 hover:bg-violet-700 text-white rounded-2xl text-base font-bold" data-testid="kiosk-new-count-btn">
            <Plus className="w-5 h-5" /> Yeni Sayım Başlat
          </button>
          {showNew && (
            <form onSubmit={create} className="bg-white border rounded-2xl p-4 space-y-3 text-sm" data-testid="kiosk-new-form">
              <div><label className="block text-xs font-semibold mb-1">Sayım adı</label>
                <input value={newForm.name} onChange={(e) => setNewForm({ ...newForm, name: e.target.value })} placeholder="Örn: Depo A — akşam sayımı" className="w-full border rounded-xl p-3 bg-slate-50" data-testid="kiosk-count-name" /></div>
              <div><label className="block text-xs font-semibold mb-1">Depo</label>
                <select value={newForm.warehouse_id} onChange={(e) => setNewForm({ ...newForm, warehouse_id: e.target.value })} className="w-full border rounded-xl p-3 bg-slate-50" data-testid="kiosk-warehouse">
                  <option value="">Tüm depolar</option>
                  {warehouses.map((w) => <option key={w.id} value={w.id}>{w.name}</option>)}
                </select></div>
              <div className="flex gap-2"><button type="button" onClick={() => setShowNew(false)} className="flex-1 py-3 border rounded-xl font-semibold">İptal</button>
                <button type="submit" className="flex-1 py-3 bg-violet-600 text-white rounded-xl font-bold" data-testid="kiosk-create-btn">Başlat</button></div>
            </form>
          )}
          <div className="bg-white border rounded-2xl overflow-hidden" data-testid="kiosk-session-list">
            <div className="px-4 py-2.5 text-xs font-bold text-slate-500 uppercase border-b">Açık oturumlar</div>
            {openSessions.length === 0 && <div className="p-6 text-center text-sm text-slate-400">Açık sayım yok. Yeni sayım başlatın.</div>}
            {openSessions.map((c) => (
              <button key={c.id} type="button" onClick={() => open(c.id)} className="w-full text-left px-4 py-3.5 border-b last:border-0 hover:bg-violet-50" data-testid={`kiosk-open-${c.id}`}>
                <div className="font-bold text-slate-900">{c.name}</div>
                <div className="text-xs text-slate-500">{c.warehouse_name} · {(c.items || []).filter((i) => i.scanned).length} kalem sayıldı</div>
              </button>
            ))}
          </div>
          <Link to="/stock?tab=count" className="block text-center text-xs font-semibold text-violet-700 py-2" data-testid="kiosk-desktop-link">Masaüstü sayım listesi →</Link>
        </div>
      )}

      {active && (
        <div className="space-y-3">
          <div className="flex items-center justify-between gap-2">
            <button type="button" onClick={() => { setActive(null); setLast(null); loadList(); }} className="inline-flex items-center gap-1 text-sm font-semibold text-slate-600" data-testid="kiosk-back"><ArrowLeft className="w-4 h-4" /> Oturumlar</button>
            <div className="text-right min-w-0"><div className="font-bold text-slate-900 truncate">{active.name}</div><div className="text-[11px] text-slate-500">{scanned.length} sayıldı · {diffs.length} fark</div></div>
          </div>

          {active.status === "open" && (
            <form onSubmit={(e) => { e.preventDefault(); scanCode(barcode); }} className="space-y-2">
              <div className="relative">
                <Scan className="w-6 h-6 absolute left-4 top-1/2 -translate-y-1/2 text-violet-500" />
                <input
                  ref={inputRef}
                  value={barcode}
                  onChange={(e) => setBarcode(e.target.value)}
                  autoFocus
                  autoComplete="off"
                  autoCapitalize="off"
                  autoCorrect="off"
                  spellCheck={false}
                  enterKeyHint="go"
                  placeholder="Barkod okutun veya yazın"
                  className="w-full pl-14 pr-4 py-5 text-xl font-mono font-black bg-violet-50 border-2 border-violet-300 rounded-2xl"
                  data-testid="kiosk-scan-input"
                />
              </div>
              <div className="flex gap-2 items-stretch">
                <label className="shrink-0 w-24 bg-white border-2 border-slate-200 rounded-2xl px-2 py-2 flex flex-col items-center justify-center">
                  <span className="text-[10px] font-bold uppercase text-slate-500">Adet</span>
                  <input
                    value={scanQtyShown(scanQty)}
                    onChange={(e) => setScanQty(e.target.value.replace(/[^\d]/g, ""))}
                    onFocus={() => setScanQty(scanQtyOnFocus())}
                    onBlur={() => setScanQty(scanQtyOnBlur(scanQty))}
                    inputMode="numeric"
                    aria-label="Adet çarpan"
                    className="w-full text-center text-2xl font-black text-slate-900 bg-transparent outline-none"
                    data-testid="kiosk-scan-qty"
                  />
                </label>
                <button type="submit" className="flex-1 py-4 bg-violet-600 text-white rounded-2xl font-bold text-base" data-testid="kiosk-scan-btn">Okut (+{qty})</button>
              </div>
              <div className="grid grid-cols-2 gap-2">
                <button type="button" onClick={() => setCam("serial")} className="py-4 bg-indigo-600 text-white rounded-2xl font-bold text-base inline-flex items-center justify-center gap-2" data-testid="kiosk-serial-btn">
                  <Camera className="w-5 h-5" /> Seri okut
                </button>
                <button type="button" onClick={() => setCam("once")} className="py-4 bg-slate-900 text-white rounded-2xl font-bold text-base inline-flex items-center justify-center gap-2" data-testid="kiosk-camera-btn">
                  <Camera className="w-5 h-5" /> Kamera
                </button>
              </div>
            </form>
          )}

          {last && (
            <div className="bg-white border-2 border-violet-200 rounded-2xl p-4 space-y-3 shadow-sm" data-testid="kiosk-last-item">
              <div className="text-[10px] uppercase font-bold text-violet-600">Son okutulan</div>
              <div className="font-black text-lg leading-tight text-slate-900">{last.product_name}</div>
              <div className="font-mono text-xs text-slate-500">{last.sku} · {last.barcode}</div>
              <div className="flex items-center justify-between gap-3">
                <div className="text-xs text-slate-500">Sistem: <b className="text-slate-800">{fmt(last.expected)}</b></div>
                <div className="flex items-center gap-2">
                  <button type="button" onClick={() => bump(-1)} className="w-14 h-14 rounded-2xl bg-slate-100 font-black text-2xl" data-testid="kiosk-minus"><Minus className="w-6 h-6 mx-auto" /></button>
                  <div className="min-w-[4.5rem] text-center text-3xl font-black text-slate-900" data-testid="kiosk-counted">{fmt(last.counted)}</div>
                  <button type="button" onClick={() => bump(1)} className="w-14 h-14 rounded-2xl bg-violet-600 text-white font-black" data-testid="kiosk-plus"><Plus className="w-6 h-6 mx-auto" /></button>
                </div>
              </div>
              {last.scanned && last.counted !== last.expected && (
                <div className="flex items-center gap-1 text-sm font-bold text-rose-600"><AlertTriangle className="w-4 h-4" /> Fark: {last.counted - last.expected > 0 ? "+" : ""}{fmt(last.counted - last.expected)}</div>
              )}
            </div>
          )}

          <div className="bg-white border rounded-2xl overflow-hidden" data-testid="kiosk-scanned-list">
            <div className="px-4 py-2 text-xs font-bold text-slate-500 uppercase border-b">Sayılan kalemler</div>
            {scanned.length === 0 && <div className="p-6 text-center text-sm text-slate-400">Henüz okutma yok.</div>}
            {scanned.slice().reverse().map((i) => {
              const diff = i.counted - i.expected;
              return (
                <button key={`${i.product_id}-${i.variant_id}`} type="button" onClick={() => setLast(i)} className="w-full text-left px-4 py-3 border-b last:border-0 flex items-center gap-3" data-testid={`kiosk-row-${i.sku}`}>
                  <div className="min-w-0 flex-1"><div className="font-semibold text-slate-900 truncate">{i.product_name}</div><div className="font-mono text-[11px] text-slate-400">{i.barcode || i.sku}</div></div>
                  <div className="text-right"><div className="font-black text-slate-900">{fmt(i.counted)}</div><div className={`text-[11px] font-bold ${diff === 0 ? "text-emerald-600" : "text-rose-600"}`}>{diff === 0 ? "eşleşti" : `${diff > 0 ? "+" : ""}${fmt(diff)}`}</div></div>
                </button>
              );
            })}
          </div>

          {active.status === "open" && (
            <div className="grid grid-cols-1 gap-2 pt-1">
              <button type="button" disabled={busy || scanned.length === 0} onClick={() => complete(true)} className="py-4 bg-emerald-600 disabled:opacity-40 text-white rounded-2xl font-bold inline-flex items-center justify-center gap-2" data-testid="kiosk-complete-apply">
                {busy ? <Loader2 className="w-5 h-5 animate-spin" /> : <CheckCircle2 className="w-5 h-5" />} Tamamla ve stoğu güncelle
              </button>
              <button type="button" disabled={busy} onClick={() => complete(false)} className="py-3 border rounded-2xl font-semibold text-slate-700" data-testid="kiosk-complete-save">Sadece kaydet (stok değişmesin)</button>
            </div>
          )}
        </div>
      )}
    </div>
  );

  const scanner = cam && (
    <CameraScanner
      continuous={cam === "serial"}
      qtyEnabled
      qty={scanQty}
      onQtyChange={setScanQty}
      title={cam === "serial" ? "Sayım — seri okuma" : "Sayım — kamera"}
      onScan={scanCode}
      onClose={() => { setCam(null); setTimeout(() => inputRef.current?.focus(), 80); }}
    />
  );

  if (kiosk) {
    return (
      <div className="fixed inset-0 z-[80] bg-slate-100 overflow-y-auto p-4 sm:p-6" data-testid="stock-count-kiosk-fullscreen">
        {body}
        {scanner}
      </div>
    );
  }
  return (
    <div className="space-y-4">
      {body}
      {scanner}
    </div>
  );
}
