
import React, { useEffect, useRef } from "react";
import L from "leaflet";
import "leaflet/dist/leaflet.css";

const icon = L.divIcon({ className: "", html: '<div style="width:14px;height:14px;border-radius:50%;background:#e11d48;border:3px solid #fff;box-shadow:0 0 0 2px #e11d48"></div>', iconSize: [14, 14], iconAnchor: [7, 7] });

export const LocationMap = ({ lat, lng, radius = 300, pending, onPick }) => {
  const ref = useRef(null);
  const mapRef = useRef(null);
  const layersRef = useRef({});
  useEffect(() => {
    if (!ref.current || mapRef.current) return;
    const map = L.map(ref.current, { zoomControl: true, attributionControl: false }).setView([lat || 39.0, lng || 35.0], lat ? 15 : 5);
    L.tileLayer("https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png", { maxZoom: 19 }).addTo(map);
    map.on("click", (e) => onPick?.(e.latlng.lat, e.latlng.lng));
    mapRef.current = map;
    return () => { map.remove(); mapRef.current = null; };
  }, []); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => {
    const map = mapRef.current; if (!map) return;
    const ly = layersRef.current;
    Object.values(ly).forEach((l) => l.remove());
    layersRef.current = {};
    if (lat && lng) {
      layersRef.current.marker = L.marker([lat, lng], { icon }).addTo(map);
      layersRef.current.circle = L.circle([lat, lng], { radius: Number(radius) || 300, color: "#059669", fillColor: "#10b981", fillOpacity: 0.15, weight: 2 }).addTo(map);
      if (!pending) map.fitBounds(layersRef.current.circle.getBounds(), { padding: [20, 20] });
    }
    if (pending) {
      layersRef.current.pending = L.circleMarker([pending.lat, pending.lng], { radius: 8, color: "#7c3aed", fillColor: "#a78bfa", fillOpacity: 0.9 }).addTo(map);
      layersRef.current.pendingCircle = L.circle([pending.lat, pending.lng], { radius: Number(radius) || 300, color: "#7c3aed", dashArray: "6 6", fillOpacity: 0.05 }).addTo(map);
    }
  }, [lat, lng, radius, pending]);
  return <div ref={ref} className="w-full h-64 rounded-xl overflow-hidden border border-slate-200 z-0" data-testid="company-location-map-canvas" />;
};
