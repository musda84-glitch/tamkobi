import React, { useEffect, useMemo, useState } from "react";
import axios from "axios";
import { Loader2, LogOut, Search } from "lucide-react";
import { API_URL } from "../context/AuthContext";
import { SupplierFace, cartBadgeText } from "../components/B2BSupplierSwitch";
import {
  b2bNav,
  b2bSessionHeaders,
  logoutB2B,
  readB2BSession,
  readB2BSessionEmail,
  selectB2BSupplier,
  supplierCartUnits,
  supplierErrorMessage,
} from "../utils/b2bSession";

const EMPTY_ACCESS = "B2B erişiminiz tanımlı değil. Tedarikçinizle iletişime geçin.";

function matchesQuery(row, query) {
  const q = String(query || "").trim().toLocaleLowerCase("tr-TR");
  if (!q) return true;
  const blob = `${row?.company_name || ""} ${row?.contact_name || ""}`.toLocaleLowerCase("tr-TR");
  return blob.includes(q);
}

export default function B2BSupplierPickerPage() {
  const [suppliers, setSuppliers] = useState([]);
  const [email, setEmail] = useState("");
  const [query, setQuery] = useState("");
  const [err, setErr] = useState("");
  const [loaded, setLoaded] = useState(false);
  const [busyId, setBusyId] = useState("");

  useEffect(() => {
    const selectToken = readB2BSession();
    setEmail(readB2BSessionEmail());
    if (!selectToken) {
      b2bNav.go("/b2b/giris");
      return undefined;
    }
    let cancelled = false;
    axios.get(`${API_URL}/public/b2b/suppliers`, { headers: b2bSessionHeaders(selectToken) })
      .then((res) => {
        if (cancelled) return;
        const list = Array.isArray(res.data?.suppliers) ? res.data.suppliers : [];
        setSuppliers(list);
        setLoaded(true);
      })
      .catch((error) => {
        if (cancelled) return;
        setErr(supplierErrorMessage(error, "Tedarikçi listesi alınamadı."));
        setSuppliers([]);
        setLoaded(true);
      });
    return () => { cancelled = true; };
  }, []);

  const shown = useMemo(
    () => suppliers.filter((row) => matchesQuery(row, query)),
    [suppliers, query],
  );

  const choose = async (row) => {
    if (!row?.contact_id || busyId) return;
    setBusyId(row.contact_id);
    setErr("");
    try {
      const path = await selectB2BSupplier(row.contact_id);
      b2bNav.go(path);
    } catch (error) {
      setErr(supplierErrorMessage(error, "Tedarikçi seçilemedi."));
    } finally {
      setBusyId("");
    }
  };

  return (
    <div className="min-h-screen bg-slate-100 text-slate-900" data-testid="b2b-supplier-picker">
      <header className="bg-slate-950 text-white">
        <div className="max-w-3xl mx-auto px-3 sm:px-4 h-14 flex items-center gap-2 min-w-0">
          <img src="/brand/tamkobi-mark.svg" alt="TamKobi" className="w-8 h-8 shrink-0" data-testid="b2b-tamkobi-logo" />
          <div className="font-bold text-sm sm:text-base shrink-0 whitespace-nowrap">TamKobi <span className="text-emerald-400">B2B</span></div>
          <div className="flex-1 min-w-0 flex items-center justify-end gap-2">
            {email ? (
              <span className="text-[11px] sm:text-xs text-slate-300 truncate min-w-0" data-testid="b2b-session-email">{email}</span>
            ) : null}
            <button
              type="button"
              onClick={logoutB2B}
              className="shrink-0 inline-flex items-center gap-1 rounded-lg border border-white/20 px-2.5 py-1 text-xs font-semibold hover:bg-white/10"
              data-testid="b2b-logout"
            >
              <LogOut className="w-3.5 h-3.5" /> Çıkış
            </button>
          </div>
        </div>
      </header>

      <main className="max-w-3xl mx-auto px-3 sm:px-4 py-5 sm:py-8 space-y-4">
        <div>
          <h1 className="text-xl sm:text-2xl font-black text-slate-900">Tedarikçi Seçin</h1>
          {loaded && suppliers.length > 0 ? (
            <p className="text-sm text-slate-500 mt-1" data-testid="b2b-supplier-count">
              Hesabınız {suppliers.length} tedarikçiye bağlı. Girmek istediğiniz portalı seçin.
            </p>
          ) : null}
        </div>

        {err ? (
          <div className="text-sm text-rose-800 bg-rose-50 border border-rose-200 rounded-xl px-3 py-2" data-testid="b2b-supplier-error">{err}</div>
        ) : null}

        {!loaded ? (
          <div className="flex justify-center py-16" data-testid="b2b-supplier-loading">
            <Loader2 className="w-6 h-6 animate-spin text-slate-400" />
          </div>
        ) : null}

        {loaded && suppliers.length === 0 && !err ? (
          <div className="bg-white rounded-2xl border border-slate-200 shadow-sm p-6 text-sm text-slate-700" data-testid="b2b-supplier-empty">
            {EMPTY_ACCESS}
          </div>
        ) : null}

        {loaded && suppliers.length > 0 ? (
          <>
            <div className="relative">
              <Search className="w-4 h-4 absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" />
              <input
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                placeholder="Tedarikçi veya cari adı ara..."
                className="w-full bg-white border border-slate-200 rounded-2xl pl-9 pr-3 py-2.5 text-sm shadow-sm"
                data-testid="b2b-supplier-search"
                autoComplete="off"
                inputMode="search"
              />
            </div>
            <div className="space-y-3" data-testid="b2b-supplier-list">
              {shown.map((row) => {
                const count = supplierCartUnits(row.contact_id);
                const badge = cartBadgeText(count);
                return (
                  <article
                    key={row.contact_id || row.company_name}
                    className="bg-white rounded-2xl border border-slate-200 shadow-sm p-3 sm:p-4"
                    data-testid={`b2b-supplier-${row.contact_id}`}
                  >
                    <div className="flex flex-col gap-3 sm:flex-row sm:items-center">
                      <div className="flex items-center gap-3 min-w-0 flex-1">
                        <SupplierFace name={row.company_name} logoUrl={row.logo_url} className="w-11 h-11 text-xs" />
                        <div className="min-w-0">
                          <div className="font-bold text-slate-900 truncate">{row.company_name}</div>
                          <div className="text-xs text-slate-500 truncate">Cari: {row.contact_name}</div>
                        </div>
                      </div>
                      <div className="flex flex-wrap items-center justify-between sm:justify-end gap-2 min-w-0">
                        {badge ? (
                          <span className="text-[11px] font-semibold text-emerald-800 bg-emerald-50 border border-emerald-100 rounded-full px-2.5 py-1 whitespace-nowrap" data-testid={`b2b-supplier-cart-${row.contact_id}`}>
                            {badge}
                          </span>
                        ) : null}
                        <button
                          type="button"
                          disabled={!!busyId}
                          onClick={() => choose(row)}
                          className="shrink-0 rounded-xl bg-emerald-600 hover:bg-emerald-700 text-white text-sm font-bold px-3.5 py-2 disabled:opacity-60 whitespace-nowrap"
                          data-testid={`b2b-supplier-enter-${row.contact_id}`}
                        >
                          {busyId === row.contact_id ? "Giriliyor…" : "Portala Gir"}
                        </button>
                      </div>
                    </div>
                  </article>
                );
              })}
              {shown.length === 0 ? (
                <div className="text-sm text-slate-500 text-center py-8" data-testid="b2b-supplier-no-match">Aramanızla eşleşen tedarikçi yok.</div>
              ) : null}
            </div>
          </>
        ) : null}
      </main>
    </div>
  );
}
