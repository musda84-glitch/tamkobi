import React, { useEffect, useState } from "react";
import axios from "axios";
import { toast } from "sonner";
import { MapPin, Search, Crosshair, Loader2, ExternalLink } from "lucide-react";
import { API_URL } from "../context/AuthContext";

export const CompanyLocationPanel = ({ companyId }) => {
  const [loc, setLoc] = useState(null);
  const [q, setQ] = useState("");
  const [results, setResults] = useState([]);
  const [radius, setRadius] = useState(300);
  const [busy, setBusy] = useState(null);
  const load = () => axios.get(`${API_URL}/companies/${companyId}`).then((r) => { setLoc(r.data.location || null); if (r.data.location?.radius_m) setRadius(r.data.location.radius_m); }).catch(() => {});
  useEffect(() => { load(); }, [companyId]); // eslint-disable-line react-hooks/exhaustive-deps
  const save = async (latitude, longitude, label) => {
    setBusy("save");
    try { await axios.put(`${API_URL}/companies/${companyId}/location`, { latitude, longitude, radius_m: Number(radius) || 300, label }); toast.success("Firma konumu kaydedildi. Personel bu noktanın " + radius + " m içinden giriş/çıkış yapabilir."); setResults([]); load(); }
    catch (err) { toast.error(err.response?.data?.detail || "Kaydedilemedi."); } finally { setBusy(null); }
  };
  const search = async (e) => {
    e.preventDefault(); setBusy("search");
    try { const r = await axios.get(`${API_URL}/geocode?q=${encodeURIComponent(q)}`); setResults(r.data); if (!r.data.length) toast.info("Adres bulunamadı; il/ilçe ekleyerek deneyin."); }
    catch (err) { toast.error(err.response?.data?.detail || "Adres aranamadı."); } finally { setBusy(null); }
  };
  const locate = () => {
    if (!navigator.geolocation) return toast.error("Bu cihaz konum desteklemiyor.");
    setBusy("gps");
    navigator.geolocation.getCurrentPosition((p) => save(p.coords.latitude, p.coords.longitude, "Mevcut konum"), () => { setBusy(null); toast.error("Konum izni alınamadı."); }, { enableHighAccuracy: true, timeout: 15000 });
  };
  return (
    <div className="bg-white rounded-2xl border border-slate-200/90 shadow-sm p-5 space-y-4" data-testid="company-location-panel">
      <div><h3 className="text-sm font-bold text-slate-900 flex items-center gap-2"><MapPin className="w-4 h-4 text-rose-600" /> Firma Konumu (Konumla Giriş/Çıkış)</h3><p className="text-xs text-slate-500">Personelin telefondan mesai giriş/çıkışı yapabileceği nokta. Adres yazın ya da bulunduğunuz konumu kullanın.</p></div>
      {loc ? (
        <div className="flex flex-wrap items-center gap-3 bg-emerald-50 border border-emerald-200 rounded-xl p-3 text-xs" data-testid="company-location-current">
          <div className="flex-1 min-w-[200px]"><div className="font-semibold text-emerald-800">{loc.label || "Firma"}</div><div className="text-slate-600 font-mono">{loc.latitude.toFixed(6)}, {loc.longitude.toFixed(6)} · yarıçap {loc.radius_m} m</div></div>
          <a href={`https://www.google.com/maps?q=${loc.latitude},${loc.longitude}`} target="_blank" rel="noreferrer" className="flex items-center gap-1 text-emerald-700 font-semibold hover:underline" data-testid="company-location-map"><ExternalLink className="w-3.5 h-3.5" /> Haritada Gör</a>
        </div>
      ) : <div className="text-xs text-amber-700 bg-amber-50 border border-amber-200 rounded-xl p-3" data-testid="company-location-empty">Henüz konum tanımlı değil.</div>}
      <form onSubmit={search} className="flex flex-col sm:flex-row gap-2 text-xs">
        <div className="relative flex-1"><Search className="w-4 h-4 text-slate-400 absolute left-3 top-1/2 -translate-y-1/2" /><input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Adres ara: örn. Atatürk Cad. No:12 Kadıköy İstanbul" className="w-full pl-9 py-2 bg-slate-50 border border-slate-200 rounded-xl outline-none focus:ring-2 focus:ring-emerald-500" data-testid="company-location-search" /></div>
        <div className="flex items-center gap-1"><span className="text-slate-500">Yarıçap</span><input type="number" min="50" step="50" value={radius} onChange={(e) => setRadius(e.target.value)} className="w-20 border rounded-lg p-2 bg-slate-50" data-testid="company-location-radius" /><span className="text-slate-500">m</span></div>
        <button type="submit" disabled={busy || q.trim().length < 3} className="px-4 py-2 bg-slate-900 text-white rounded-xl font-semibold disabled:opacity-40 flex items-center gap-1.5" data-testid="company-location-search-btn">{busy === "search" ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Search className="w-3.5 h-3.5" />} Adres Bul</button>
        <button type="button" onClick={locate} disabled={!!busy} className="px-4 py-2 bg-emerald-600 text-white rounded-xl font-semibold disabled:opacity-40 flex items-center gap-1.5" data-testid="company-location-gps-btn">{busy === "gps" ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Crosshair className="w-3.5 h-3.5" />} Konumumu Bul</button>
      </form>
      {results.length > 0 && (
        <div className="divide-y border rounded-xl text-xs" data-testid="company-location-results">
          {results.map((r, i) => <button key={i} type="button" onClick={() => save(r.latitude, r.longitude, r.label)} className="w-full text-left px-3 py-2 hover:bg-emerald-50 flex items-center gap-2" data-testid={`company-location-result-${i}`}><MapPin className="w-3.5 h-3.5 text-rose-500 shrink-0" /><span className="flex-1">{r.label}</span><span className="text-emerald-700 font-semibold">Bu konumu kullan</span></button>)}
        </div>
      )}
    </div>
  );
};
