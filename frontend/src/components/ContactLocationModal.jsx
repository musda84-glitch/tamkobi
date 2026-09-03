import React, { useState } from "react";
import axios from "axios";
import { toast } from "sonner";
import { MapPin, X, LocateFixed, Link as LinkIcon, Loader2 } from "lucide-react";
import { API_URL } from "../context/AuthContext";

const parseMapsUrl = (url) => {
  const m = url.match(/@(-?\d+\.\d+),(-?\d+\.\d+)/) || url.match(/[?&]q=(-?\d+\.\d+),(-?\d+\.\d+)/) || url.match(/(-?\d{1,2}\.\d+)[,\s]+(-?\d{1,3}\.\d+)/);
  return m ? { lat: parseFloat(m[1]), lng: parseFloat(m[2]) } : null;
};

export const mapsLink = (c) => c.location_url || (c.latitude && c.longitude ? `https://www.google.com/maps?q=${c.latitude},${c.longitude}` : null);

export const ContactLocationModal = ({ contact, onClose, onSaved }) => {
  const [lat, setLat] = useState(contact.latitude ?? "");
  const [lng, setLng] = useState(contact.longitude ?? "");
  const [url, setUrl] = useState(contact.location_url || "");
  const [busy, setBusy] = useState(false);

  const useMyLocation = () => {
    if (!navigator.geolocation) { toast.error("Tarayıcı konum desteklemiyor."); return; }
    navigator.geolocation.getCurrentPosition((p) => { setLat(p.coords.latitude.toFixed(6)); setLng(p.coords.longitude.toFixed(6)); toast.success("Mevcut konum alındı."); }, () => toast.error("Konum alınamadı."));
  };
  const onUrlChange = (v) => { setUrl(v); const p = parseMapsUrl(v); if (p) { setLat(p.lat); setLng(p.lng); } };

  const save = async (e) => {
    e.preventDefault(); setBusy(true);
    try {
      const payload = { latitude: lat === "" ? null : Number(lat), longitude: lng === "" ? null : Number(lng), location_url: url || null };
      const r = await axios.put(`${API_URL}/contacts/${contact.id}`, payload);
      toast.success("Konum bilgisi kaydedildi."); onSaved(r.data); onClose();
    } catch (err) { toast.error(err.response?.data?.detail || "Kaydedilemedi."); } finally { setBusy(false); }
  };

  const preview = lat && lng ? `https://maps.google.com/maps?q=${lat},${lng}&z=15&output=embed` : null;

  return (
    <div className="fixed inset-0 z-50 bg-slate-900/60 backdrop-blur-sm flex items-center justify-center p-4">
      <div className="bg-white rounded-2xl max-w-md w-full p-6 space-y-4 shadow-2xl border border-slate-200" data-testid="contact-location-modal">
        <div className="flex items-center justify-between border-b pb-2">
          <div><h3 className="text-base font-bold text-slate-900 flex items-center gap-2"><MapPin className="w-4 h-4 text-rose-600" /> Müşteri Konumu</h3><p className="text-[11px] text-slate-500">{contact.name} • {contact.address || ""} {contact.district || ""} / {contact.city || ""}</p></div>
          <button onClick={onClose} className="text-slate-400"><X className="w-5 h-5" /></button>
        </div>
        <form onSubmit={save} className="space-y-3 text-xs">
          <div><label className="block font-semibold mb-1 flex items-center gap-1"><LinkIcon className="w-3 h-3" /> Google Maps Linki (yapıştırın, koordinat otomatik çözülür)</label><input value={url} onChange={(e) => onUrlChange(e.target.value)} placeholder="https://maps.google.com/..." className="w-full bg-slate-50 border border-slate-200 rounded-lg p-2" data-testid="location-url-input" /></div>
          <div className="grid grid-cols-2 gap-2">
            <div><label className="block font-semibold mb-1">Enlem (lat)</label><input type="number" step="any" value={lat} onChange={(e) => setLat(e.target.value)} className="w-full bg-slate-50 border border-slate-200 rounded-lg p-2 font-mono" data-testid="location-lat-input" /></div>
            <div><label className="block font-semibold mb-1">Boylam (lng)</label><input type="number" step="any" value={lng} onChange={(e) => setLng(e.target.value)} className="w-full bg-slate-50 border border-slate-200 rounded-lg p-2 font-mono" data-testid="location-lng-input" /></div>
          </div>
          <button type="button" onClick={useMyLocation} className="flex items-center gap-1.5 px-3 py-1.5 border rounded-lg font-semibold hover:bg-slate-50" data-testid="use-my-location-btn"><LocateFixed className="w-3.5 h-3.5" /> Mevcut Konumumu Kullan</button>
          {preview && <iframe title="map" src={preview} className="w-full h-44 rounded-xl border border-slate-200" loading="lazy" data-testid="location-map-preview" />}
          <div className="flex justify-end gap-2 pt-2 border-t"><button type="button" onClick={onClose} className="px-3 py-1.5 border rounded-lg">İptal</button><button type="submit" disabled={busy} className="flex items-center gap-1.5 px-4 py-1.5 bg-rose-600 text-white rounded-lg font-semibold disabled:opacity-60" data-testid="save-location-btn">{busy && <Loader2 className="w-3.5 h-3.5 animate-spin" />} Konumu Kaydet</button></div>
        </form>
      </div>
    </div>
  );
};
