import React, { useCallback, useEffect, useState } from "react";
import axios from "axios";
import { toast } from "sonner";
import { QRCodeSVG } from "qrcode.react";
import { Loader2, MonitorSmartphone, RefreshCw } from "lucide-react";
import { API_URL, useAuth } from "../context/AuthContext";
import {
  canManageShopfloorDevices,
  deviceStatusLabel,
  formatCodeExpiry,
  formatDeviceSeen,
  pairingQrValue,
  stationModeLabel,
} from "../utils/shopfloorDeviceSession";

const MODES = [
  ["all", "Tüm istasyonlar"],
  ["one", "Tek istasyon"],
  ["many", "Seçili istasyonlar"],
];

function stationPayload(mode, selected) {
  if (mode === "all") return { station_mode: "all", stations: [] };
  return { station_mode: mode, stations: selected };
}

function stationError(mode, selected) {
  if (mode === "one" && selected.length !== 1) return "Tek istasyon modunda tam bir istasyon seçin.";
  if (mode === "many" && selected.length < 1) return "En az bir istasyon seçin.";
  return "";
}

export function ShopfloorDevicesPanel({ companyId }) {
  const { user } = useAuth();
  const allowed = canManageShopfloorDevices(user);
  const [rows, setRows] = useState([]);
  const [stations, setStations] = useState([]);
  const [loading, setLoading] = useState(false);
  const [denied, setDenied] = useState(false);
  const [label, setLabel] = useState("");
  const [mode, setMode] = useState("all");
  const [selected, setSelected] = useState([]);
  const [busy, setBusy] = useState("");
  const [issued, setIssued] = useState(null);
  const [names, setNames] = useState({});

  const load = useCallback(async () => {
    if (!companyId || !allowed) return;
    setLoading(true);
    try {
      const [devices, stationRes] = await Promise.all([
        axios.get(`${API_URL}/shopfloor/devices`, { params: { company_id: companyId } }),
        axios.get(`${API_URL}/production/work-orders/stations`, { params: { company_id: companyId } }).catch(() => ({ data: [] })),
      ]);
      const list = Array.isArray(devices.data) ? devices.data : [];
      setRows(list);
      setNames((prev) => {
        const next = { ...prev };
        list.forEach((row) => {
          if (next[row.id] == null) next[row.id] = row.label || "";
        });
        return next;
      });
      const raw = stationRes.data;
      const namesOnly = Array.isArray(raw) ? raw : (raw?.stations || []);
      setStations(namesOnly.map((item) => (typeof item === "string" ? item : (item?.name || ""))).filter(Boolean));
      setDenied(false);
    } catch (err) {
      if (err.response?.status === 403) setDenied(true);
      else toast.error(typeof err.response?.data?.detail === "string" ? err.response.data.detail : "Cihazlar yüklenemedi.");
    } finally {
      setLoading(false);
    }
  }, [companyId, allowed]);

  useEffect(() => { load(); }, [load]);

  const toggleStation = (name) => {
    setSelected((cur) => (cur.includes(name) ? cur.filter((item) => item !== name) : [...cur, name]));
  };

  const createCode = async (event) => {
    event.preventDefault();
    const problem = stationError(mode, selected);
    if (problem) {
      toast.error(problem);
      return;
    }
    const trimmed = label.trim();
    if (!trimmed) {
      toast.error("Cihaz adı gerekli.");
      return;
    }
    setBusy("create");
    try {
      const res = await axios.post(`${API_URL}/shopfloor/devices/pairing-codes`, {
        company_id: companyId,
        label: trimmed,
        ...stationPayload(mode, selected),
      });
      const code = String(res.data?.code || "");
      setIssued({
        code,
        expires_at: res.data?.expires_at || "",
        label: res.data?.label || trimmed,
      });
      toast.success("Eşleştirme kodu üretildi.");
    } catch (err) {
      const detail = err.response?.data?.detail;
      toast.error(typeof detail === "string" ? detail : "Kod üretilemedi.");
    } finally {
      setBusy("");
    }
  };

  const rename = async (row) => {
    const next = String(names[row.id] ?? row.label ?? "").trim();
    if (!next) {
      toast.error("Cihaz adı gerekli.");
      return;
    }
    setBusy(row.id);
    try {
      await axios.put(`${API_URL}/shopfloor/devices/${encodeURIComponent(row.id)}`, {
        company_id: companyId,
        label: next,
      });
      toast.success("Cihaz adı kaydedildi.");
      await load();
    } catch (err) {
      const detail = err.response?.data?.detail;
      toast.error(typeof detail === "string" ? detail : "Ad kaydedilemedi.");
    } finally {
      setBusy("");
    }
  };

  const revoke = async (row) => {
    const ok = window.confirm("Bu cihazın oturumu iptal edilsin mi? Tablet yeniden kod ile eşleşmeden giremez.");
    if (!ok) return;
    setBusy(`revoke-${row.id}`);
    try {
      await axios.post(`${API_URL}/shopfloor/devices/${encodeURIComponent(row.id)}/revoke`, null, {
        params: { company_id: companyId },
      });
      toast.success("Cihaz iptal edildi.");
      await load();
    } catch (err) {
      const detail = err.response?.data?.detail;
      toast.error(typeof detail === "string" ? detail : "Cihaz iptal edilemedi.");
    } finally {
      setBusy("");
    }
  };

  const copyCode = async () => {
    if (!issued?.code) return;
    try {
      if (!navigator.clipboard?.writeText) throw new Error("copy");
      await navigator.clipboard.writeText(issued.code);
      toast.success("Kod kopyalandı.");
    } catch {
      toast.error("Kopyalanamadı.");
    }
  };

  if (!allowed || denied) {
    return (
      <div className="bg-white border border-slate-200 rounded-2xl p-5 text-sm text-slate-700" data-testid="shopfloor-devices-denied">
        Bu ekran yalnız şirket yöneticisine açıktır.
      </div>
    );
  }

  if (!companyId) {
    return <div className="text-sm text-slate-500" data-testid="shopfloor-devices-no-company">Şirket seçilmedi.</div>;
  }

  const qr = issued ? pairingQrValue(issued.code) : "";

  return (
    <div className="space-y-4" data-testid="shopfloor-devices">
      <div className="bg-white border border-slate-200 rounded-2xl p-4 sm:p-5 space-y-3">
        <h2 className="text-sm font-bold text-slate-900 flex items-center gap-2">
          <MonitorSmartphone className="w-4 h-4 text-emerald-600" /> Atölye Cihazları
        </h2>
        <p className="text-xs sm:text-sm text-slate-500">
          Tablete tek kullanımlık bir kod verin. Kod ve QR yalnız üretildiği anda görünür. Eşleşen tablet Atölye iş ekranında kalır.
        </p>
        {issued ? (
          <div className="border-2 border-emerald-600 rounded-2xl p-4 sm:p-6 space-y-3" data-testid="shopfloor-device-code">
            <p className="text-sm font-semibold text-emerald-800">Bu kod bir kez kullanılır ve süresi dolunca geçersiz olur. Kapatınca bir daha gösterilmez.</p>
            <p className="text-center font-mono text-4xl sm:text-5xl tracking-[0.28em] font-bold text-slate-900 break-all" data-testid="shopfloor-device-code-value">{issued.code}</p>
            {qr ? (
              <div className="flex justify-center" data-testid="shopfloor-device-qr">
                <QRCodeSVG value={qr} size={220} level="M" />
              </div>
            ) : null}
            <p className="text-center text-sm text-slate-600" data-testid="shopfloor-device-code-expiry">
              {issued.label ? `${issued.label} · ` : ""}Geçerlilik: {formatCodeExpiry(issued.expires_at) || "10 dakika"}
            </p>
            <p className="text-center text-xs text-slate-500">QR düz koddur. Adres çubuğuna yazılmaz.</p>
            <div className="flex flex-col sm:flex-row gap-2">
              <button type="button" onClick={copyCode} className="min-h-12 flex-1 rounded-xl border-2 border-slate-300 bg-white font-bold" data-testid="shopfloor-device-code-copy">Kodu kopyala</button>
              <button type="button" onClick={() => setIssued(null)} className="min-h-12 flex-1 rounded-xl bg-slate-900 text-white font-bold" data-testid="shopfloor-device-code-close">Kodu gördüm, kapat</button>
            </div>
          </div>
        ) : (
          <form onSubmit={createCode} className="space-y-3" data-testid="shopfloor-device-create">
            <label className="block text-xs font-semibold text-slate-700">
              Cihaz adı
              <input
                value={label}
                onChange={(e) => setLabel(e.target.value)}
                maxLength={80}
                required
                placeholder="Kesim tableti"
                className="mt-1 w-full min-h-12 bg-slate-50 border border-slate-200 rounded-xl px-3 text-base"
                data-testid="shopfloor-device-label"
              />
            </label>
            <label className="block text-xs font-semibold text-slate-700">
              İstasyon
              <select
                value={mode}
                onChange={(e) => { setMode(e.target.value); setSelected([]); }}
                className="mt-1 w-full min-h-12 bg-white border border-slate-200 rounded-xl px-3 text-base font-semibold"
                data-testid="shopfloor-device-mode"
              >
                {MODES.map(([value, text]) => <option key={value} value={value}>{text}</option>)}
              </select>
            </label>
            {mode !== "all" ? (
              <div className="flex flex-wrap gap-2" data-testid="shopfloor-device-stations">
                {stations.length === 0 ? <p className="text-xs text-slate-400">İstasyon bulunamadı.</p> : stations.map((name) => (
                  <label key={name} className="inline-flex items-center gap-2 min-h-11 rounded-xl border border-slate-200 bg-slate-50 px-3 text-sm font-semibold">
                    <input type="checkbox" checked={selected.includes(name)} onChange={() => toggleStation(name)} data-testid={`shopfloor-device-station-${name}`} />
                    {name}
                  </label>
                ))}
              </div>
            ) : null}
            <button type="submit" disabled={busy === "create"} className="min-h-12 w-full sm:w-auto px-4 rounded-xl bg-emerald-600 text-white font-bold disabled:opacity-60" data-testid="shopfloor-device-create-submit">
              {busy === "create" ? <Loader2 className="w-4 h-4 animate-spin inline" /> : "Eşleştirme kodu üret"}
            </button>
          </form>
        )}
      </div>

      <div className="flex items-center justify-between gap-2">
        <h3 className="text-sm font-bold text-slate-900">Kayıtlı cihazlar</h3>
        <button type="button" onClick={load} className="min-h-11 min-w-11 inline-flex items-center justify-center rounded-xl border border-slate-200 bg-white" title="Yenile" data-testid="shopfloor-devices-refresh">
          <RefreshCw className={`w-4 h-4 ${loading ? "animate-spin" : ""}`} />
        </button>
      </div>
      {!rows.length ? (
        <div className="text-sm text-slate-400" data-testid="shopfloor-devices-empty">{loading ? "Yükleniyor…" : "Henüz eşleşmiş cihaz yok."}</div>
      ) : (
        <div className="grid grid-cols-1 xl:grid-cols-2 gap-3" data-testid="shopfloor-devices-list">
          {rows.map((row) => {
            const revoked = row.status === "revoked";
            return (
              <article key={row.id} className="bg-white border border-slate-200 rounded-2xl p-4 space-y-3" data-testid={`shopfloor-device-row-${row.id}`}>
                <div className="flex flex-wrap items-center gap-2">
                  <span className={`rounded-lg px-2 py-1 text-xs font-bold ${revoked ? "bg-slate-100 text-slate-500" : "bg-emerald-50 text-emerald-800"}`} data-testid={`shopfloor-device-status-${row.id}`}>
                    {deviceStatusLabel(row.status)}
                  </span>
                  <span className="text-xs text-slate-500" data-testid={`shopfloor-device-seen-${row.id}`}>Son görülme: {formatDeviceSeen(row.last_seen)}</span>
                </div>
                <label className="block text-xs font-semibold text-slate-700">
                  Ad
                  <input
                    value={names[row.id] ?? row.label ?? ""}
                    disabled={revoked}
                    onChange={(e) => setNames((prev) => ({ ...prev, [row.id]: e.target.value }))}
                    className="mt-1 w-full min-h-12 bg-slate-50 border border-slate-200 rounded-xl px-3 text-base disabled:text-slate-400"
                    data-testid={`shopfloor-device-name-${row.id}`}
                  />
                </label>
                <p className="text-xs text-slate-500" data-testid={`shopfloor-device-stations-label-${row.id}`}>
                  İstasyon: {stationModeLabel(row.station_mode, row.stations)}
                </p>
                {!revoked ? (
                  <div className="flex flex-col sm:flex-row gap-2">
                    <button type="button" disabled={!!busy} onClick={() => rename(row)} className="min-h-12 flex-1 rounded-xl bg-slate-900 text-white font-bold disabled:opacity-60" data-testid={`shopfloor-device-rename-${row.id}`}>Kaydet</button>
                    <button type="button" disabled={!!busy} onClick={() => revoke(row)} className="min-h-12 flex-1 rounded-xl border-2 border-rose-200 text-rose-700 font-bold disabled:opacity-60" data-testid={`shopfloor-device-revoke-${row.id}`}>İptal et</button>
                  </div>
                ) : null}
              </article>
            );
          })}
        </div>
      )}
    </div>
  );
}
