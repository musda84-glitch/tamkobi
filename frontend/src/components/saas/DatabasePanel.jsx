import React, { useEffect, useState } from "react";
import axios from "axios";
import { toast } from "sonner";
import { Database, HardDriveDownload, Loader2, PlugZap, ServerCog } from "lucide-react";
import { API_URL } from "../../context/AuthContext";
import { inputCls } from "./saasUi";

const emptyTarget = { db_host: "", db_port: 3306, db_name: "tamkobi", db_user: "tamkobi", db_password: "", ssl_mode: "", ssl_ca: "" };
const tl = (n) => Number(n || 0).toLocaleString("tr-TR");
export const SSL_LABELS = {
  disabled: "Şifreleme kapalı",
  required: "Şifreli, sertifika doğrulanmaz",
  verify_ca: "Şifreli, CA doğrulamalı",
  verify_identity: "Şifreli, CA ve sunucu adı doğrulamalı",
};
// Mirrors db_ssl.default_mode so the form can say what "otomatik" will do.
// The decision itself stays on the server.
const LOCAL_HOSTS = new Set(["", "localhost", "127.0.0.1", "::1"]);
export const autoSslMode = (host) => (LOCAL_HOSTS.has(String(host || "").trim().toLowerCase()) ? "disabled" : "verify_identity");
export const UNVERIFIED_MODES = new Set(["disabled", "required"]);

export const DatabasePanel = () => {
  const [info, setInfo] = useState(null);
  const [form, setForm] = useState(emptyTarget);
  const [probe, setProbe] = useState(null);
  const [moved, setMoved] = useState(null);
  const [overwrite, setOverwrite] = useState(false);
  const [busy, setBusy] = useState("");

  const load = () =>
    axios
      .get(`${API_URL}/system/database`)
      .then((r) => setInfo(r.data))
      .catch((e) => toast.error(e.response?.data?.detail || "Veritabanı bilgisi alınamadı."));
  useEffect(() => {
    load();
  }, []);

  const set = (k, v) => {
    setForm((f) => ({ ...f, [k]: v }));
    setProbe(null);
  };
  // An empty ssl_mode means "decide from the host" on the server, so it is left out.
  const payload = () => ({
    ...form,
    db_host: form.db_host.trim(),
    db_port: Number(form.db_port) || 3306,
    ssl_mode: form.ssl_mode || null,
  });

  const test = async () => {
    setBusy("test");
    setProbe(null);
    try {
      const r = await axios.post(`${API_URL}/system/database/test`, payload());
      setProbe(r.data);
      toast.success(`Bağlantı kuruldu · MySQL ${r.data.server_version || ""}`.trim());
    } catch (e) {
      toast.error(e.response?.data?.detail || "Hedef sunucuya bağlanılamadı.");
    } finally {
      setBusy("");
    }
  };

  const move = async () => {
    const target = `${form.db_host.trim()}:${Number(form.db_port) || 3306}/${form.db_name}`;
    if (!window.confirm(`Tüm tablolar ve veriler ${target} sunucusuna kopyalanacak ve TamKobi bundan sonra o veritabanını kullanacak. Devam edilsin mi?`)) return;
    setBusy("move");
    try {
      const r = await axios.post(`${API_URL}/system/database/move`, { ...payload(), overwrite });
      setMoved(r.data);
      if (r.data.rebound === false) toast.warning(r.data.rebind_error || "Veriler taşındı; backend'i yeniden başlatın.");
      else toast.success("Veriler taşındı, uygulama yeni sunucuya bağlandı.");
      // The target is now the live database; a second submit with the same form would be a no-op.
      setForm(emptyTarget);
      setProbe(null);
      setOverwrite(false);
      await load();
    } catch (e) {
      toast.error(e.response?.data?.detail || "Taşıma yapılamadı.");
    } finally {
      setBusy("");
    }
  };

  if (!info) return <div className="text-xs text-slate-400">Yükleniyor…</div>;
  const rows = Object.entries(info.tables || {});
  const canMove = probe && form.db_host.trim() && (probe.empty || overwrite);
  const needsCa = form.ssl_mode === "verify_ca" || form.ssl_mode === "verify_identity";
  const effectiveSsl = form.ssl_mode || autoSslMode(form.db_host);
  const unverified = UNVERIFIED_MODES.has(effectiveSsl);

  return (
    <div className="space-y-4 text-xs max-w-3xl" data-testid="saas-database-panel">
      <div className="bg-white border border-slate-200 rounded-2xl p-4 space-y-3">
        <h3 className="font-bold text-slate-900 text-sm flex items-center gap-2">
          <Database className="w-4 h-4 text-slate-500" /> Şu an kullanılan veritabanı
        </h3>
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-2" data-testid="db-current">
          {[
            ["Sunucu", `${info.current.host}:${info.current.port}`],
            ["Veritabanı", info.current.db],
            ["Kullanıcı", info.current.user],
            ["Şifreleme", SSL_LABELS[info.current.ssl_mode] || info.current.ssl_mode],
            ["Ayar kaynağı", info.settings_source === "file" ? "Kurulum dosyası (database.json)" : "Ortam değişkeni"],
          ].map(([l, v]) => (
            <div key={l} className="bg-slate-50 rounded-xl px-3 py-2">
              <div className="text-[10px] text-slate-500">{l}</div>
              <div className="font-semibold text-slate-800 break-all">{v}</div>
            </div>
          ))}
        </div>
        {info.reachable ? (
          <div className="flex flex-wrap gap-2" data-testid="db-tables">
            {rows.map(([t, n]) => (
              <span key={t} className="bg-emerald-50 text-emerald-700 rounded-lg px-2.5 py-1 font-semibold">
                {t}: {tl(n)} satır
              </span>
            ))}
          </div>
        ) : (
          <div className="bg-rose-50 text-rose-700 rounded-xl px-3 py-2" data-testid="db-unreachable">
            Bu veritabanına şu an ulaşılamıyor. {info.error}
          </div>
        )}
      </div>

      <div className="bg-white border border-slate-200 rounded-2xl p-4 space-y-3">
        <div>
          <h3 className="font-bold text-slate-900 text-sm flex items-center gap-2">
            <ServerCog className="w-4 h-4 text-slate-500" /> Kendi sunucunuzdaki MySQL'e taşı
          </h3>
          <p className="text-[11px] text-slate-500 mt-1">
            Tablolar ve veriler hedef sunucuya kopyalanır, satır sayıları karşılaştırılır ve ancak doğrulama geçerse TamKobi yeni
            veritabanına bağlanır. Kopyalama öncesi mevcut veritabanının yedeği <code>backend/data/backups</code> klasörüne yazılır.
            Yüklenen dosyalar MySQL dışında tutulduğu için ayrıca kopyalanmalıdır.
          </p>
        </div>
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
          <div>
            <label className="block font-semibold text-slate-700 mb-1">Sunucu adresi</label>
            <input value={form.db_host} onChange={(e) => set("db_host", e.target.value)} placeholder="db.firmaniz.com" className={inputCls} data-testid="db-host" />
          </div>
          <div>
            <label className="block font-semibold text-slate-700 mb-1">Port</label>
            <input type="number" value={form.db_port} onChange={(e) => set("db_port", e.target.value)} className={inputCls} data-testid="db-port" />
          </div>
          <div>
            <label className="block font-semibold text-slate-700 mb-1">Veritabanı adı</label>
            <input value={form.db_name} onChange={(e) => set("db_name", e.target.value)} className={inputCls} data-testid="db-name" />
          </div>
          <div>
            <label className="block font-semibold text-slate-700 mb-1">Kullanıcı</label>
            <input value={form.db_user} onChange={(e) => set("db_user", e.target.value)} className={inputCls} data-testid="db-user" autoComplete="off" />
          </div>
          <div className="sm:col-span-2">
            <label className="block font-semibold text-slate-700 mb-1">Şifre</label>
            <input type="password" value={form.db_password} onChange={(e) => set("db_password", e.target.value)} className={inputCls} data-testid="db-password" autoComplete="new-password" />
          </div>
          <div className={needsCa ? "" : "sm:col-span-2"}>
            <label className="block font-semibold text-slate-700 mb-1">Bağlantı şifrelemesi</label>
            <select value={form.ssl_mode} onChange={(e) => set("ssl_mode", e.target.value)} className={inputCls} data-testid="db-ssl-mode">
              <option value="">Sunucuya göre otomatik seç ({SSL_LABELS[autoSslMode(form.db_host)]})</option>
              {Object.entries(SSL_LABELS).map(([v, l]) => <option key={v} value={v}>{l}</option>)}
            </select>
            <p className="text-[10px] text-slate-500 mt-1">
              Şifreniz ve tüm veri bu bağlantıdan geçer. Otomatik seçimde başka bir sunucu için sertifika doğrulamalı TLS,
              bu makinedeki MySQL için şifresiz bağlantı kullanılır.
            </p>
            {unverified && (
              <p className="text-[10px] text-amber-700 bg-amber-50 rounded-lg px-2 py-1.5 mt-1" data-testid="db-ssl-warning">
                Sertifika doğrulanmadığı için araya giren biri kendi sunucusunu TamKobi'ye gösterebilir. Bunu yalnızca bağlantı
                özel ağ veya VPN ile korunuyorsa seçin.
              </p>
            )}
          </div>
          {needsCa && (
            <div>
              <label className="block font-semibold text-slate-700 mb-1">
                CA sertifika dosyası{form.ssl_mode === "verify_identity" ? " (isteğe bağlı)" : ""}
              </label>
              <input value={form.ssl_ca} onChange={(e) => set("ssl_ca", e.target.value)} placeholder="/etc/ssl/certs/mysql-ca.pem" className={inputCls} data-testid="db-ssl-ca" />
            </div>
          )}
        </div>
        {probe && (
          <div className={`rounded-xl px-3 py-2 ${probe.empty ? "bg-emerald-50 text-emerald-700" : "bg-amber-50 text-amber-900"}`} data-testid="db-probe">
            MySQL {probe.server_version} · {probe.created ? "veritabanı oluşturuldu" : "veritabanı mevcut"} ·{" "}
            {SSL_LABELS[probe.target?.ssl_mode] || probe.target?.ssl_mode} · {probe.summary}
          </div>
        )}
        {probe && !probe.empty && (
          <label className="flex items-center gap-2 text-[11px] text-rose-700">
            <input type="checkbox" checked={overwrite} onChange={(e) => setOverwrite(e.target.checked)} data-testid="db-overwrite" />
            Hedefteki tüm tabloları silip üzerine yaz
          </label>
        )}
        <div className="flex flex-wrap justify-end gap-2">
          <button type="button" onClick={test} disabled={!!busy || !form.db_host.trim()} className="px-4 py-2 border border-slate-300 text-slate-700 rounded-xl font-bold disabled:opacity-50 flex items-center gap-1.5" data-testid="db-test">
            {busy === "test" ? <Loader2 className="w-4 h-4 animate-spin" /> : <PlugZap className="w-4 h-4" />} Bağlantıyı test et
          </button>
          <button type="button" onClick={move} disabled={!!busy || !canMove} className="px-4 py-2 bg-slate-900 text-white rounded-xl font-bold disabled:opacity-60 flex items-center gap-1.5" data-testid="db-move">
            {busy === "move" ? <Loader2 className="w-4 h-4 animate-spin" /> : <HardDriveDownload className="w-4 h-4" />} Verileri taşı ve buraya bağlan
          </button>
        </div>
      </div>

      {moved && (
        <div className="bg-white border border-emerald-200 rounded-2xl p-4 space-y-2" data-testid="db-move-result">
          <h3 className="font-bold text-emerald-700 text-sm">Taşıma tamamlandı</h3>
          <div className="text-[11px] text-slate-600">
            {moved.source.host}:{moved.source.port}/{moved.source.db} → {moved.target.host}:{moved.target.port}/{moved.target.db}
          </div>
          <div className="flex flex-wrap gap-2">
            {Object.entries(moved.tables || {}).map(([t, n]) => (
              <span key={t} className="bg-slate-100 text-slate-700 rounded-lg px-2.5 py-1 font-semibold">
                {t}: {tl(n)} satır
              </span>
            ))}
          </div>
          {moved.snapshot && <div className="text-[11px] text-slate-500 break-all">Yedek: {moved.snapshot}</div>}
          {moved.rebound === false && (
            <div className="bg-amber-50 text-amber-900 rounded-xl px-3 py-2 text-[11px]" data-testid="db-rebind-warning">
              {moved.rebind_error}
            </div>
          )}
        </div>
      )}
    </div>
  );
};
