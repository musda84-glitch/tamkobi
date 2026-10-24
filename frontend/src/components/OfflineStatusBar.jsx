import { useEffect, useState } from "react";
import axios from "axios";
import { toast } from "sonner";
import { API_URL, useAuth } from "../context/AuthContext";
import { activeCompanyId } from "../utils/activeCompanyId";
import { clampOfflineMinutes, isOnline, remainingMs } from "../offline/policy";
import { clearOfflineWindow, ensureDeviceId, flushOfflineQueue, markOfflineWindow, pendingCount, readOfflineClock, readOfflinePolicy, rememberOfflinePolicy } from "../offline/write";
import { idbReady, mergeDelta, sharedDb } from "../offline/db";

function formatClock(value) {
  if (!value) return "—";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "—";
  return date.toLocaleString("tr-TR", { hour: "2-digit", minute: "2-digit", day: "2-digit", month: "2-digit" });
}

export default function OfflineStatusBar() {
  const { activeCompany } = useAuth();
  const companyId = activeCompanyId(activeCompany);
  const [online, setOnline] = useState(() => isOnline());
  const [pending, setPending] = useState(0);
  const [lastSync, setLastSync] = useState(null);
  const [offlineSince, setOfflineSince] = useState(null);
  const [policy, setPolicy] = useState(null);
  const [now, setNow] = useState(() => Date.now());
  const companyMax = clampOfflineMinutes(policy?.maxMinutes ?? activeCompany?.offline_max_minutes);
  const policySeed = activeCompany
    ? `${activeCompany.offline_enabled ?? ""}|${activeCompany.offline_max_minutes ?? ""}|${JSON.stringify(activeCompany.offline_modules || {})}`
    : "";

  useEffect(() => {
    const pull = async () => {
      const clock = await readOfflineClock();
      setOfflineSince(clock.offlineSince);
      let stored = await readOfflinePolicy();
      if (!stored && activeCompany) {
        stored = {
          enabled: activeCompany.offline_enabled !== false,
          maxMinutes: activeCompany.offline_max_minutes,
          modules: activeCompany.offline_modules || { pos: true, pick: true, order: true },
        };
        await rememberOfflinePolicy(stored);
      }
      setPolicy(stored);
      setPending(await pendingCount());
      const db = sharedDb();
      if (!db) return;
      try {
        const row = await db.meta.get(`lastSync:${companyId || "_"}`);
        setLastSync(row?.value || null);
      } catch {
        setLastSync(null);
      }
    };
    pull();
    const on = () => setOnline(true);
    const off = () => {
      setOnline(false);
      markOfflineWindow(companyMax);
    };
    window.addEventListener("online", on);
    window.addEventListener("offline", off);
    const timer = window.setInterval(() => {
      setNow(Date.now());
      pull();
    }, 2000);
    return () => {
      window.removeEventListener("online", on);
      window.removeEventListener("offline", off);
      window.clearInterval(timer);
    };
    // activeCompany nesnesi her render'da yeni olabiliyor; alanları policySeed'de.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [companyId, companyMax, policySeed]);

  useEffect(() => {
    if (!online) return undefined;
    let stop = false;
    (async () => {
      await clearOfflineWindow();
      const db = sharedDb();
      const reportPending = async (count) => {
        if (!companyId) return null;
        const deviceId = await ensureDeviceId();
        const cursorRow = db && idbReady() ? await db.meta.get(`cursor:${companyId}`) : null;
        const { data } = await axios.get(`${API_URL}/offline/sync`, {
          params: {
            company_id: companyId,
            updated_since: cursorRow?.value || undefined,
            pending: count,
            device_id: deviceId,
          },
        });
        return data;
      };
      const applyPolicy = async (data) => {
        if (!data) return;
        const next = {
          enabled: data.offline_enabled !== false,
          maxMinutes: data.offline_max_minutes,
          modules: data.offline_modules,
          ttlHours: data.idempotency_ttl_hours,
        };
        await rememberOfflinePolicy(next);
        setPolicy(next);
        if (db && idbReady()) {
          await mergeDelta(db, companyId, data);
          await db.meta.put({ key: `cursor:${companyId}`, value: data.server_time });
          await db.meta.put({ key: `lastSync:${companyId}`, value: data.server_time });
        }
        setLastSync(data.server_time);
      };
      if (companyId && db && idbReady()) {
        try {
          const data = await reportPending(await pendingCount());
          if (!stop && data) await applyPolicy(data);
        } catch {
          /* senkron sonra yeniden dener */
        }
      }
      const report = await flushOfflineQueue({
        axios,
        onReject: async (_item, error) => {
          const detail = error?.detail;
          const text = typeof detail === "string" ? detail : detail?.message || "Sunucu işlemi reddetti. Yerel kayıt geri alındı.";
          toast.error(text);
          window.dispatchEvent(new CustomEvent("tamkobi:offline-rejected", { detail: error }));
        },
      });
      if (!stop) {
        const left = await pendingCount();
        setPending(left);
        if (companyId && db && idbReady() && report.length) {
          try {
            const data = await reportPending(left);
            if (!stop && data) await applyPolicy(data);
          } catch {
            /* kuyruk sayacı sonraki senkronda gider */
          }
        }
      }
    })();
    return () => { stop = true; };
  }, [online, companyId]);

  const left = remainingMs({ offlineSince, maxMinutes: companyMax, now });
  const expired = !online && !!offlineSince && left <= 0;
  const minutes = Math.ceil(left / 60000);
  const tone = expired ? "bg-rose-50 border-rose-200 text-rose-900" : online ? "bg-slate-50 border-slate-200 text-slate-600" : "bg-amber-50 border-amber-200 text-amber-950";

  return (
    <div className={`border-b px-3 py-1.5 text-xs flex flex-wrap items-center gap-x-3 gap-y-1 ${tone}`} data-testid="offline-status-bar" role="status">
      <span className="font-semibold" data-testid="offline-status-link">{online ? "Çevrimiçi" : "Çevrimdışı"}</span>
      <span data-testid="offline-status-pending">Bekleyen {pending}</span>
      <span data-testid="offline-status-sync">Son senkron {formatClock(lastSync)}</span>
      {!online && <span data-testid="offline-status-remaining">{expired ? "Kalan süre 0 dk" : `Kalan ${minutes} dk`}</span>}
      {expired && <span data-testid="offline-status-expired">Yeni satış ve stok düşümü durdu. Kuyruk silinmedi.</span>}
      {!online && policy?.enabled === false && <span data-testid="offline-status-disabled">Bu firmada çevrimdışı kapalı.</span>}
      {!online && <span data-testid="offline-status-blocked">e-Fatura, ödeme, banka ve AI çevrimdışı kapalı.</span>}
    </div>
  );
}
