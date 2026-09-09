import React, { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import axios from "axios";
import { Check, ChevronRight, Database, Globe, Mail, ShieldCheck } from "lucide-react";
import { API_URL } from "../api/client";
import { readInstalledCache, resolveSetupStatus, writeInstalledCache } from "../utils/setupStatus";

const emptyForm = {
  db_host: "127.0.0.1",
  db_port: 3306,
  db_name: "tamkobi",
  db_user: "tamkobi",
  db_password: "",
  site_name: "",
  admin_email: "",
  admin_password: "",
  admin_name: "",
};

export default function SetupPage() {
  const [status, setStatus] = useState(null);
  const [step, setStep] = useState(1);
  const [form, setForm] = useState(emptyForm);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [dbOk, setDbOk] = useState(null);

  useEffect(() => {
    axios
      .get(`${API_URL}/setup/status`, { timeout: 8000 })
      .then((r) => {
        const next = resolveSetupStatus(r.data || {});
        writeInstalledCache(next.installed);
        setStatus({ ...r.data, installed: next.installed });
        const d = r.data?.defaults || {};
        setForm((f) => ({
          ...f,
          db_host: d.db_host || f.db_host,
          db_port: d.db_port || f.db_port,
          db_name: d.db_name || f.db_name,
          db_user: d.db_user || f.db_user,
        }));
      })
      .catch(() => {
        const next = resolveSetupStatus(null, { error: true, cached: readInstalledCache() });
        setStatus({ installed: next.installed });
      });
  }, []);

  const set = (k, v) => setForm((f) => ({ ...f, [k]: v }));

  const testDb = async () => {
    setBusy(true);
    setError("");
    setDbOk(null);
    try {
      const r = await axios.post(`${API_URL}/setup/test-db`, {
        db_host: form.db_host,
        db_port: Number(form.db_port) || 3306,
        db_name: form.db_name,
        db_user: form.db_user,
        db_password: form.db_password,
      });
      setDbOk(r.data);
      setStep(3);
    } catch (e) {
      const detail = e.response?.data?.detail;
      setError(Array.isArray(detail) ? detail.map((d) => d.msg || d).join(" ") : (detail || "Veritabanına bağlanılamadı."));
    } finally {
      setBusy(false);
    }
  };

  const install = async (e) => {
    e.preventDefault();
    setBusy(true);
    setError("");
    try {
      await axios.post(`${API_URL}/setup/install`, {
        ...form,
        db_port: Number(form.db_port) || 3306,
      });
      window.location.href = "/";
    } catch (err) {
      const detail = err.response?.data?.detail;
      setError(Array.isArray(detail) ? detail.map((d) => d.msg || d).join(" ") : (detail || "Kurulum tamamlanamadı."));
      setBusy(false);
    }
  };

  if (!status) {
    return (
      <div className="min-h-screen bg-[#0b0f1a] text-slate-400 flex items-center justify-center text-xs" data-testid="setup-loading">
        Yükleniyor…
      </div>
    );
  }

  if (status.installed) {
    return (
      <div className="min-h-screen bg-[#0b0f1a] text-slate-100 flex items-center justify-center p-6" data-testid="setup-already-installed">
        <div className="bg-white text-slate-900 rounded-3xl shadow-2xl w-full max-w-md p-8 space-y-4">
          <div className="text-2xl font-black">Tam<span className="text-emerald-600">Kobi</span></div>
          <h1 className="text-lg font-bold">Zaten kurulu</h1>
          <p className="text-sm text-slate-500">
            Bu sunucuda kurulum tamamlanmış. Web sitesini açın veya panele giriş yapın.
          </p>
          <div className="flex gap-2 pt-2">
            <Link to="/" className="flex-1 py-2.5 bg-slate-900 text-white rounded-xl font-bold text-sm text-center" data-testid="setup-go-site">
              Web sitesine git
            </Link>
            <Link to="/login" className="flex-1 py-2.5 border border-slate-200 rounded-xl font-bold text-sm text-center" data-testid="setup-go-login">
              Giriş
            </Link>
          </div>
        </div>
      </div>
    );
  }

  const steps = [
    { n: 1, label: "Karşılama" },
    { n: 2, label: "Veritabanı" },
    { n: 3, label: "Site" },
  ];

  return (
    <div className="min-h-screen bg-[#0b0f1a] text-slate-100 flex items-center justify-center p-6" data-testid="setup-page">
      <div className="w-full max-w-lg">
        <div className="text-center mb-6">
          <div className="text-3xl font-black tracking-tight">Tam<span className="text-emerald-400">Kobi</span></div>
          <p className="text-xs text-slate-400 mt-1">Kurulum sihirbazı</p>
        </div>
        <div className="flex items-center justify-center gap-2 mb-6 text-[11px]">
          {steps.map((s, i) => (
            <React.Fragment key={s.n}>
              {i > 0 && <ChevronRight className="w-3.5 h-3.5 text-slate-600" />}
              <span className={`px-2.5 py-1 rounded-full font-semibold ${step === s.n ? "bg-emerald-500 text-slate-900" : step > s.n ? "bg-emerald-500/20 text-emerald-300" : "bg-white/10 text-slate-400"}`}>
                {s.n}. {s.label}
              </span>
            </React.Fragment>
          ))}
        </div>
        <div className="bg-white text-slate-900 rounded-3xl shadow-2xl p-8 space-y-5">
          {error && (
            <div className="text-sm text-rose-600 bg-rose-50 border border-rose-100 rounded-xl px-3 py-2" data-testid="setup-error">
              {error}
            </div>
          )}
          {step === 1 && (
            <div className="space-y-4" data-testid="setup-step-welcome">
              <h1 className="text-xl font-black">TamKobi’ye hoş geldiniz</h1>
              <p className="text-sm text-slate-500">
                Birkaç adımda veritabanını bağlayın, site adını ve yönetici hesabını oluşturun. Kurulumdan sonra bu adrese girdiğinizde web sitesi açılır.
              </p>
              <ul className="text-sm space-y-2 text-slate-600">
                <li className="flex items-center gap-2"><Database className="w-4 h-4 text-emerald-600" /> MySQL 8 bağlantısı</li>
                <li className="flex items-center gap-2"><Globe className="w-4 h-4 text-emerald-600" /> Site adı</li>
                <li className="flex items-center gap-2"><Mail className="w-4 h-4 text-emerald-600" /> Yönetici e-posta ve şifre</li>
              </ul>
              <button type="button" onClick={() => setStep(2)} className="w-full py-2.5 bg-slate-900 text-white rounded-xl font-bold" data-testid="setup-start">
                Kuruluma başla
              </button>
            </div>
          )}
          {step === 2 && (
            <form
              className="space-y-3"
              data-testid="setup-step-db"
              onSubmit={(e) => {
                e.preventDefault();
                testDb();
              }}
            >
              <h1 className="text-xl font-black">Veritabanı</h1>
              <p className="text-sm text-slate-500">MySQL sunucu bilgilerini girin. Veritabanı yoksa ve kullanıcının yetkisi varsa oluşturulur.</p>
              <div className="grid grid-cols-3 gap-2">
                <label className="col-span-2 text-xs font-semibold">Sunucu
                  <input required value={form.db_host} onChange={(e) => set("db_host", e.target.value)} className="mt-1 w-full border rounded-xl p-2.5 text-sm" data-testid="setup-db-host" />
                </label>
                <label className="text-xs font-semibold">Port
                  <input required type="number" value={form.db_port} onChange={(e) => set("db_port", e.target.value)} className="mt-1 w-full border rounded-xl p-2.5 text-sm" data-testid="setup-db-port" />
                </label>
              </div>
              <label className="block text-xs font-semibold">Veritabanı adı
                <input required value={form.db_name} onChange={(e) => set("db_name", e.target.value)} className="mt-1 w-full border rounded-xl p-2.5 text-sm" data-testid="setup-db-name" />
              </label>
              <label className="block text-xs font-semibold">Kullanıcı
                <input required value={form.db_user} onChange={(e) => set("db_user", e.target.value)} className="mt-1 w-full border rounded-xl p-2.5 text-sm" data-testid="setup-db-user" />
              </label>
              <label className="block text-xs font-semibold">Şifre
                <input type="password" value={form.db_password} onChange={(e) => set("db_password", e.target.value)} className="mt-1 w-full border rounded-xl p-2.5 text-sm" data-testid="setup-db-password" />
              </label>
              {dbOk?.ok && (
                <div className="text-xs text-emerald-700 bg-emerald-50 rounded-xl px-3 py-2 flex items-center gap-1.5">
                  <Check className="w-3.5 h-3.5" /> MySQL {dbOk.server_version} · {dbOk.database}
                </div>
              )}
              <div className="flex gap-2 pt-2">
                <button type="button" onClick={() => setStep(1)} className="px-4 py-2.5 border rounded-xl font-semibold text-sm">Geri</button>
                <button disabled={busy} className="flex-1 py-2.5 bg-slate-900 text-white rounded-xl font-bold" data-testid="setup-test-db">
                  {busy ? "Bağlanılıyor…" : "Bağlantıyı dene"}
                </button>
              </div>
            </form>
          )}
          {step === 3 && (
            <form className="space-y-3" data-testid="setup-step-site" onSubmit={install}>
              <h1 className="text-xl font-black">Site ve yönetici</h1>
              <p className="text-sm text-slate-500">Kurulumdan sonra ana sayfada bu adla web sitesi görünür.</p>
              <label className="block text-xs font-semibold">Site adı
                <input required value={form.site_name} onChange={(e) => set("site_name", e.target.value)} className="mt-1 w-full border rounded-xl p-2.5 text-sm" placeholder="Örn. Acme Ticaret" data-testid="setup-site-name" />
              </label>
              <label className="block text-xs font-semibold">Yönetici adı
                <input value={form.admin_name} onChange={(e) => set("admin_name", e.target.value)} className="mt-1 w-full border rounded-xl p-2.5 text-sm" placeholder="Yönetici" data-testid="setup-admin-name" />
              </label>
              <label className="block text-xs font-semibold">Yönetici e-posta
                <input required type="email" value={form.admin_email} onChange={(e) => set("admin_email", e.target.value)} className="mt-1 w-full border rounded-xl p-2.5 text-sm" data-testid="setup-admin-email" />
              </label>
              <label className="block text-xs font-semibold">Yönetici şifresi
                <input required type="password" minLength={8} value={form.admin_password} onChange={(e) => set("admin_password", e.target.value)} className="mt-1 w-full border rounded-xl p-2.5 text-sm" data-testid="setup-admin-password" />
                <span className="text-[11px] text-slate-400 font-normal">En az 8 karakter</span>
              </label>
              <div className="flex items-start gap-2 text-[11px] text-slate-500 bg-slate-50 rounded-xl px-3 py-2">
                <ShieldCheck className="w-4 h-4 text-emerald-600 shrink-0 mt-0.5" />
                Kurulum bir kez çalışır. Sonraki ziyaretlerde bu sihirbaz yerine web sitesi açılır.
              </div>
              <div className="flex gap-2 pt-2">
                <button type="button" onClick={() => setStep(2)} className="px-4 py-2.5 border rounded-xl font-semibold text-sm">Geri</button>
                <button disabled={busy} className="flex-1 py-2.5 bg-emerald-500 text-slate-900 rounded-xl font-bold" data-testid="setup-install">
                  {busy ? "Kuruluyor…" : "Kurulumu tamamla"}
                </button>
              </div>
            </form>
          )}
        </div>
      </div>
    </div>
  );
}
