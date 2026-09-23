import React, { useCallback, useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import axios from "axios";
import { toast } from "sonner";
import { Bell, CalendarDays, Check, Clock, Coins, Loader2, MapPin, MessageSquareWarning, RefreshCw, Wallet, X, ArrowLeftRight } from "lucide-react";
import { API_URL } from "../context/AuthContext";
import { useDataRefresh } from "../utils/dataRefresh";

export const KIND_META = {
  leave: { label: "İzin", Icon: CalendarDays, chip: "bg-indigo-50 text-indigo-700 border-indigo-100" },
  early_leave: { label: "Erken çıkış", Icon: Clock, chip: "bg-amber-50 text-amber-800 border-amber-100" },
  intraday_leave: { label: "Gün içi izin", Icon: ArrowLeftRight, chip: "bg-sky-50 text-sky-800 border-sky-100" },
  dispute: { label: "İtiraz", Icon: MessageSquareWarning, chip: "bg-rose-50 text-rose-700 border-rose-100" },
  advance: { label: "Avans", Icon: Wallet, chip: "bg-amber-50 text-amber-800 border-amber-100" },
  yevmiye_adjustment: { label: "Yevmiye", Icon: Coins, chip: "bg-amber-50 text-amber-900 border-amber-200" },
  location_exit: { label: "Konum dışı", Icon: MapPin, chip: "bg-emerald-50 text-emerald-800 border-emerald-200" },
};

const chipBtn = "inline-flex items-center gap-0.5 px-1.5 py-0.5 rounded-md text-[9px] font-bold disabled:opacity-50";

export function EmployeeRequestChips({
  items,
  testId,
  busyId,
  onDecideLeave,
  onDecideEarly,
  onDecideIntraday,
  onDecideAdvance,
  onDecideYevmiye,
  onDecideLocationExit,
  onDecideDispute,
  onViewDispute,
  maxVisible = 3,
}) {
  if (!items?.length) return null;
  const shown = items.slice(0, maxVisible);
  const extra = items.length - shown.length;
  return (
    <div className="space-y-1.5 pt-2 border-t border-amber-100" data-testid={testId}>
      <div className="flex items-center gap-1 text-[10px] font-bold text-amber-800 uppercase tracking-wide">
        <Bell className="w-3 h-3" /> Talepler ({items.length})
      </div>
      {shown.map((it) => {
        const meta = KIND_META[it.kind] || KIND_META.leave;
        const Icon = meta.Icon;
        const busy = busyId === it.id;
        return (
          <div key={`${it.kind}-${it.id}`} className="rounded-lg border border-slate-100 bg-amber-50/50 px-2 py-1.5 space-y-1" data-testid={`emp-card-request-${it.kind}-${it.id}`}>
            <div className="flex items-start gap-1.5 min-w-0">
              <span className={`inline-flex items-center gap-0.5 px-1 py-0.5 rounded border text-[9px] font-bold shrink-0 ${meta.chip}`}>
                <Icon className="w-2.5 h-2.5" /> {meta.label}
              </span>
              <div className="min-w-0">
                <div className="text-[11px] font-semibold text-slate-800 leading-tight">{it.title}</div>
                <div className="text-[10px] text-slate-500 truncate" title={it.detail}>{it.detail}</div>
              </div>
            </div>
            <div className="flex items-center gap-1 justify-end">
              {it.kind === "leave" && (
                <>
                  <button type="button" disabled={busy} onClick={() => onDecideLeave?.(it.id, "approved")} className={`${chipBtn} bg-emerald-600 text-white hover:bg-emerald-700`} data-testid={`card-approve-leave-${it.id}`}>
                    <Check className="w-2.5 h-2.5" /> Onayla
                  </button>
                  <button type="button" disabled={busy} onClick={() => onDecideLeave?.(it.id, "rejected")} className={`${chipBtn} bg-rose-600 text-white hover:bg-rose-700`} data-testid={`card-reject-leave-${it.id}`}>
                    <X className="w-2.5 h-2.5" /> Reddet
                  </button>
                </>
              )}
              {it.kind === "early_leave" && (
                <>
                  <button type="button" disabled={busy} onClick={() => onDecideEarly?.(it.id, "approve")} className={`${chipBtn} bg-emerald-600 text-white hover:bg-emerald-700`} data-testid={`card-approve-early-${it.id}`}>
                    <Check className="w-2.5 h-2.5" /> Onayla
                  </button>
                  <button type="button" disabled={busy} onClick={() => onDecideEarly?.(it.id, "reject")} className={`${chipBtn} bg-rose-600 text-white hover:bg-rose-700`} data-testid={`card-reject-early-${it.id}`}>
                    <X className="w-2.5 h-2.5" /> Reddet
                  </button>
                </>
              )}
              {it.kind === "intraday_leave" && (
                <>
                  <button type="button" disabled={busy} onClick={() => onDecideIntraday?.(it.id, "approve")} className={`${chipBtn} bg-emerald-600 text-white hover:bg-emerald-700`} data-testid={`card-approve-intraday-${it.id}`}>
                    <Check className="w-2.5 h-2.5" /> Onayla
                  </button>
                  <button type="button" disabled={busy} onClick={() => onDecideIntraday?.(it.id, "reject")} className={`${chipBtn} bg-rose-600 text-white hover:bg-rose-700`} data-testid={`card-reject-intraday-${it.id}`}>
                    <X className="w-2.5 h-2.5" /> Reddet
                  </button>
                </>
              )}
              {it.kind === "advance" && (
                <>
                  <button type="button" disabled={busy} onClick={() => onDecideAdvance?.(it.id, "approved")} className={`${chipBtn} bg-emerald-600 text-white hover:bg-emerald-700`} data-testid={`card-approve-advance-${it.id}`}>
                    <Check className="w-2.5 h-2.5" /> Onayla
                  </button>
                  <button type="button" disabled={busy} onClick={() => onDecideAdvance?.(it.id, "rejected")} className={`${chipBtn} bg-rose-600 text-white hover:bg-rose-700`} data-testid={`card-reject-advance-${it.id}`}>
                    <X className="w-2.5 h-2.5" /> Reddet
                  </button>
                </>
              )}
              {it.kind === "yevmiye_adjustment" && (
                <>
                  <button type="button" disabled={busy} onClick={() => onDecideYevmiye?.(it.id, "approve")} className={`${chipBtn} bg-emerald-600 text-white hover:bg-emerald-700`} data-testid={`card-approve-yevmiye-${it.id}`}>
                    <Check className="w-2.5 h-2.5" /> Onayla
                  </button>
                  <button type="button" disabled={busy} onClick={() => onDecideYevmiye?.(it.id, "reject")} className={`${chipBtn} bg-rose-600 text-white hover:bg-rose-700`} data-testid={`card-reject-yevmiye-${it.id}`}>
                    <X className="w-2.5 h-2.5" /> Kart ücreti
                  </button>
                </>
              )}
              {it.kind === "location_exit" && (
                <>
                  <button type="button" disabled={busy} onClick={() => onDecideLocationExit?.(it.id, "ack", false)} className={`${chipBtn} bg-slate-800 text-white hover:bg-slate-900`} data-testid={`card-ack-locexit-${it.id}`}>
                    Haberim var
                  </button>
                  <button type="button" disabled={busy} onClick={() => onDecideLocationExit?.(it.id, "approve", false)} className={`${chipBtn} bg-emerald-600 text-white hover:bg-emerald-700`} data-testid={`card-approve-locexit-${it.id}`}>
                    Kesinti olmasın
                  </button>
                  <button type="button" disabled={busy} onClick={() => onDecideLocationExit?.(it.id, "approve", true)} className={`${chipBtn} bg-amber-500 text-white hover:bg-amber-600`} data-testid={`card-deduct-locexit-${it.id}`}>
                    Kesinti olsun
                  </button>
                  <button type="button" disabled={busy} onClick={() => onDecideLocationExit?.(it.id, "reject", false)} className={`${chipBtn} bg-rose-600 text-white hover:bg-rose-700`} data-testid={`card-reject-locexit-${it.id}`}>
                    <X className="w-2.5 h-2.5" /> Reddet
                  </button>
                </>
              )}
              {it.kind === "dispute" && (
                <>
                  <button type="button" disabled={busy} onClick={() => onDecideDispute?.(it.id, "approve")} className={`${chipBtn} bg-emerald-600 text-white hover:bg-emerald-700`} data-testid={`card-approve-dispute-${it.id}`}>
                    <Check className="w-2.5 h-2.5" /> Düzeltildi
                  </button>
                  <button type="button" disabled={busy} onClick={() => onDecideDispute?.(it.id, "reject")} className={`${chipBtn} bg-rose-600 text-white hover:bg-rose-700`} data-testid={`card-reject-dispute-${it.id}`}>
                    <X className="w-2.5 h-2.5" /> Reddet
                  </button>
                  <button type="button" onClick={() => onViewDispute?.(it)} className="px-1.5 py-0.5 rounded-md border border-slate-200 text-[9px] font-bold text-slate-700 hover:bg-white" data-testid={`card-view-dispute-${it.id}`}>
                    Puantajda aç
                  </button>
                </>
              )}
            </div>
          </div>
        );
      })}
      {extra > 0 && (
        <div className="text-[10px] text-amber-800 font-semibold" data-testid={`${testId}-more`}>
          +{extra} talep daha — üstteki Personel Talepleri kutusundan bakın
        </div>
      )}
    </div>
  );
}

/** Personel talepleri bildirim kutusu — izin / erken çıkış / puantaj itirazı */
export function PersonnelRequestsInbox({ companyId, onChanged }) {
  const navigate = useNavigate();
  const [items, setItems] = useState([]);
  const [count, setCount] = useState(0);
  const [loading, setLoading] = useState(true);
  const [busyId, setBusyId] = useState(null);

  const load = useCallback(async () => {
    if (!companyId) return;
    try {
      const r = await axios.get(`${API_URL}/personnel/pending-requests`, { params: { company_id: companyId } });
      setItems(r.data?.items || []);
      setCount(Number(r.data?.count || 0));
    } catch {
      /* sessiz — sayfa yine açılır */
    } finally {
      setLoading(false);
    }
  }, [companyId]);

  useEffect(() => { setLoading(true); load(); }, [load]);
  useDataRefresh(load, { companyId, scopes: ["personnel", "attendance"] });

  const decideLeave = async (id, status) => {
    setBusyId(id);
    try {
      await axios.post(`${API_URL}/personnel/leaves/${id}/decide`, { status });
      toast.success(status === "approved" ? "İzin onaylandı." : "İzin reddedildi.");
      await load();
      onChanged?.();
    } catch (err) {
      toast.error(err.response?.data?.detail || "İşlem başarısız.");
    } finally {
      setBusyId(null);
    }
  };

  const decideAdvance = async (id, status) => {
    setBusyId(id);
    try {
      await axios.post(`${API_URL}/personnel/bonuses/${id}/decide`, { status });
      toast.success(status === "approved" ? "Avans talebi onaylandı." : "Avans talebi reddedildi.");
      await load();
      onChanged?.();
    } catch (err) {
      toast.error(err.response?.data?.detail || "İşlem başarısız.");
    } finally {
      setBusyId(null);
    }
  };

  const decideEarly = async (id, decision) => {
    setBusyId(id);
    try {
      const r = await axios.post(`${API_URL}/personnel/attendance/${id}/early-leave-decision`, { decision });
      toast.success(r.data?.message || (decision === "approve" ? "Onaylandı" : "Reddedildi"));
      await load();
      onChanged?.();
    } catch (err) {
      toast.error(err.response?.data?.detail || "İşlem başarısız.");
    } finally {
      setBusyId(null);
    }
  };

  const decideLocationExit = async (id, decision, wageDeduction) => {
    setBusyId(id);
    try {
      const r = await axios.post(`${API_URL}/personnel/attendance/${id}/location-exit-decision`, { decision, wage_deduction: !!wageDeduction });
      toast.success(r.data?.message || "Konum dışı çıkış yanıtlandı.");
      await load();
      onChanged?.();
    } catch (err) {
      toast.error(err.response?.data?.detail || "İşlem başarısız.");
    } finally {
      setBusyId(null);
    }
  };

  const decideYevmiye = async (id, decision) => {
    setBusyId(id);
    try {
      const r = await axios.post(`${API_URL}/personnel/attendance/${id}/yevmiye-decision`, { decision });
      toast.success(r.data?.message || (decision === "approve" ? "Yevmiye onaylandı." : "Kart ücreti bırakıldı."));
      await load();
      onChanged?.();
    } catch (err) {
      toast.error(err.response?.data?.detail || "İşlem başarısız.");
    } finally {
      setBusyId(null);
    }
  };

  const decideIntraday = async (id, decision) => {
    setBusyId(id);
    try {
      const r = await axios.post(`${API_URL}/personnel/attendance/${id}/intraday-leave-decision`, { decision });
      toast.success(r.data?.message || (decision === "approve" ? "Onaylandı" : "Reddedildi"));
      await load();
      onChanged?.();
    } catch (err) {
      toast.error(err.response?.data?.detail || "İşlem başarısız.");
    } finally {
      setBusyId(null);
    }
  };

  const decideDispute = async (id, decision) => {
    setBusyId(id);
    try {
      const r = await axios.post(`${API_URL}/personnel/attendance/${id}/dispute-decision`, { decision });
      toast.success(r.data?.message || (decision === "approve" ? "İtiraz düzeltildi." : "İtiraz reddedildi."));
      await load();
      onChanged?.();
    } catch (err) {
      toast.error(err.response?.data?.detail || "İşlem başarısız.");
    } finally {
      setBusyId(null);
    }
  };

  return (
    <div className="bg-white rounded-2xl border border-slate-200/90 shadow-sm overflow-hidden" data-testid="personnel-requests-inbox">
      <div className="flex items-center justify-between gap-3 px-4 py-3 border-b border-slate-100 bg-slate-50/80">
        <div className="flex items-center gap-2 min-w-0">
          <div className="relative shrink-0">
            <Bell className="w-4 h-4 text-amber-600" />
            {count > 0 && (
              <span className="absolute -top-1.5 -right-1.5 min-w-[1rem] h-4 px-1 rounded-full bg-rose-600 text-white text-[9px] font-bold flex items-center justify-center" data-testid="personnel-requests-count">
                {count > 99 ? "99+" : count}
              </span>
            )}
          </div>
          <div className="min-w-0">
            <h2 className="text-sm font-bold text-slate-900 truncate">Personel Talepleri</h2>
            <p className="text-[11px] text-slate-500 truncate">
              {loading ? "Yükleniyor…" : count ? `${count} onay bekleyen talep` : "Bekleyen talep yok"}
            </p>
          </div>
        </div>
        <button
          type="button"
          onClick={() => { setLoading(true); load(); }}
          className="p-1.5 rounded-lg border border-slate-200 text-slate-500 hover:bg-white hover:text-slate-800"
          title="Yenile"
          data-testid="personnel-requests-refresh"
        >
          <RefreshCw className={`w-3.5 h-3.5 ${loading ? "animate-spin" : ""}`} />
        </button>
      </div>

      {loading && items.length === 0 ? (
        <div className="px-4 py-8 text-center text-slate-400 text-xs flex items-center justify-center gap-2">
          <Loader2 className="w-4 h-4 animate-spin" /> Talepler yükleniyor…
        </div>
      ) : items.length === 0 ? (
        <div className="px-4 py-6 text-center text-slate-400 text-xs" data-testid="personnel-requests-empty">
          Şu an onay bekleyen izin, avans, yevmiye, konum dışı, erken çıkış, gün içi izin veya puantaj itirazı yok.
        </div>
      ) : (
        <ul className="divide-y divide-slate-100 max-h-72 overflow-y-auto" data-testid="personnel-requests-list">
          {items.map((it) => {
            const meta = KIND_META[it.kind] || KIND_META.leave;
            const Icon = meta.Icon;
            const busy = busyId === it.id;
            return (
              <li key={`${it.kind}-${it.id}`} className="px-4 py-3 flex flex-col sm:flex-row sm:items-center gap-2 sm:gap-3" data-testid={`personnel-request-${it.kind}-${it.id}`}>
                <div className="flex items-start gap-2.5 min-w-0 flex-1">
                  <span className={`inline-flex items-center gap-1 px-1.5 py-0.5 rounded-md border text-[10px] font-bold shrink-0 ${meta.chip}`}>
                    <Icon className="w-3 h-3" /> {meta.label}
                  </span>
                  <div className="min-w-0">
                    <div className="text-xs font-bold text-slate-900 truncate">{it.employee_name}</div>
                    <div className="text-[11px] text-slate-600 font-semibold">{it.title}</div>
                    <div className="text-[11px] text-slate-500 truncate" title={it.detail}>{it.detail}</div>
                  </div>
                </div>
                <div className="flex items-center gap-1.5 shrink-0 self-end sm:self-center">
                  {it.kind === "leave" && (
                    <>
                      <button type="button" disabled={busy} onClick={() => decideLeave(it.id, "approved")} className="inline-flex items-center gap-1 px-2 py-1 rounded-lg bg-emerald-600 text-white text-[10px] font-bold hover:bg-emerald-700 disabled:opacity-50" data-testid={`inbox-approve-leave-${it.id}`}>
                        <Check className="w-3 h-3" /> Onayla
                      </button>
                      <button type="button" disabled={busy} onClick={() => decideLeave(it.id, "rejected")} className="inline-flex items-center gap-1 px-2 py-1 rounded-lg bg-rose-600 text-white text-[10px] font-bold hover:bg-rose-700 disabled:opacity-50" data-testid={`inbox-reject-leave-${it.id}`}>
                        <X className="w-3 h-3" /> Reddet
                      </button>
                    </>
                  )}
                  {it.kind === "early_leave" && (
                    <>
                      <button type="button" disabled={busy} onClick={() => decideEarly(it.id, "approve")} className="inline-flex items-center gap-1 px-2 py-1 rounded-lg bg-emerald-600 text-white text-[10px] font-bold hover:bg-emerald-700 disabled:opacity-50" data-testid={`inbox-approve-early-${it.id}`}>
                        <Check className="w-3 h-3" /> Onayla
                      </button>
                      <button type="button" disabled={busy} onClick={() => decideEarly(it.id, "reject")} className="inline-flex items-center gap-1 px-2 py-1 rounded-lg bg-rose-600 text-white text-[10px] font-bold hover:bg-rose-700 disabled:opacity-50" data-testid={`inbox-reject-early-${it.id}`}>
                        <X className="w-3 h-3" /> Reddet
                      </button>
                    </>
                  )}
                  {it.kind === "intraday_leave" && (
                    <>
                      <button type="button" disabled={busy} onClick={() => decideIntraday(it.id, "approve")} className="inline-flex items-center gap-1 px-2 py-1 rounded-lg bg-emerald-600 text-white text-[10px] font-bold hover:bg-emerald-700 disabled:opacity-50" data-testid={`inbox-approve-intraday-${it.id}`}>
                        <Check className="w-3 h-3" /> Onayla
                      </button>
                      <button type="button" disabled={busy} onClick={() => decideIntraday(it.id, "reject")} className="inline-flex items-center gap-1 px-2 py-1 rounded-lg bg-rose-600 text-white text-[10px] font-bold hover:bg-rose-700 disabled:opacity-50" data-testid={`inbox-reject-intraday-${it.id}`}>
                        <X className="w-3 h-3" /> Reddet
                      </button>
                    </>
                  )}
                  {it.kind === "advance" && (
                    <>
                      <button type="button" disabled={busy} onClick={() => decideAdvance(it.id, "approved")} className="inline-flex items-center gap-1 px-2 py-1 rounded-lg bg-emerald-600 text-white text-[10px] font-bold hover:bg-emerald-700 disabled:opacity-50" data-testid={`inbox-approve-advance-${it.id}`}>
                        <Check className="w-3 h-3" /> Onayla
                      </button>
                      <button type="button" disabled={busy} onClick={() => decideAdvance(it.id, "rejected")} className="inline-flex items-center gap-1 px-2 py-1 rounded-lg bg-rose-600 text-white text-[10px] font-bold hover:bg-rose-700 disabled:opacity-50" data-testid={`inbox-reject-advance-${it.id}`}>
                        <X className="w-3 h-3" /> Reddet
                      </button>
                    </>
                  )}
                  {it.kind === "yevmiye_adjustment" && (
                    <>
                      <button type="button" disabled={busy} onClick={() => decideYevmiye(it.id, "approve")} className="inline-flex items-center gap-1 px-2 py-1 rounded-lg bg-emerald-600 text-white text-[10px] font-bold hover:bg-emerald-700 disabled:opacity-50" data-testid={`inbox-approve-yevmiye-${it.id}`}>
                        <Check className="w-3 h-3" /> Onayla
                      </button>
                      <button type="button" disabled={busy} onClick={() => decideYevmiye(it.id, "reject")} className="inline-flex items-center gap-1 px-2 py-1 rounded-lg bg-rose-600 text-white text-[10px] font-bold hover:bg-rose-700 disabled:opacity-50" data-testid={`inbox-reject-yevmiye-${it.id}`}>
                        <X className="w-3 h-3" /> Kart ücreti
                      </button>
                    </>
                  )}
                  {it.kind === "location_exit" && (
                    <>
                      <button type="button" disabled={busy} onClick={() => decideLocationExit(it.id, "ack", false)} className="inline-flex items-center gap-1 px-2 py-1 rounded-lg bg-slate-800 text-white text-[10px] font-bold hover:bg-slate-900 disabled:opacity-50" data-testid={`inbox-ack-locexit-${it.id}`}>
                        Haberim var
                      </button>
                      <button type="button" disabled={busy} onClick={() => decideLocationExit(it.id, "approve", false)} className="inline-flex items-center gap-1 px-2 py-1 rounded-lg bg-emerald-600 text-white text-[10px] font-bold hover:bg-emerald-700 disabled:opacity-50" data-testid={`inbox-approve-locexit-${it.id}`}>
                        Kesinti olmasın
                      </button>
                      <button type="button" disabled={busy} onClick={() => decideLocationExit(it.id, "approve", true)} className="inline-flex items-center gap-1 px-2 py-1 rounded-lg bg-amber-500 text-white text-[10px] font-bold hover:bg-amber-600 disabled:opacity-50" data-testid={`inbox-deduct-locexit-${it.id}`}>
                        Kesinti olsun
                      </button>
                      <button type="button" disabled={busy} onClick={() => decideLocationExit(it.id, "reject", false)} className="inline-flex items-center gap-1 px-2 py-1 rounded-lg bg-rose-600 text-white text-[10px] font-bold hover:bg-rose-700 disabled:opacity-50" data-testid={`inbox-reject-locexit-${it.id}`}>
                        <X className="w-3 h-3" /> Reddet
                      </button>
                    </>
                  )}
                  {it.kind === "dispute" && (
                    <>
                      <button type="button" disabled={busy} onClick={() => decideDispute(it.id, "approve")} className="inline-flex items-center gap-1 px-2 py-1 rounded-lg bg-emerald-600 text-white text-[10px] font-bold hover:bg-emerald-700 disabled:opacity-50" data-testid={`inbox-approve-dispute-${it.id}`}>
                        <Check className="w-3 h-3" /> Düzeltildi
                      </button>
                      <button type="button" disabled={busy} onClick={() => decideDispute(it.id, "reject")} className="inline-flex items-center gap-1 px-2 py-1 rounded-lg bg-rose-600 text-white text-[10px] font-bold hover:bg-rose-700 disabled:opacity-50" data-testid={`inbox-reject-dispute-${it.id}`}>
                        <X className="w-3 h-3" /> Reddet
                      </button>
                      <button type="button" onClick={() => navigate(it.link || "/personnel?tab=attendance")} className="px-2 py-1 rounded-lg border border-slate-200 text-[10px] font-bold text-slate-700 hover:bg-slate-50" data-testid={`inbox-view-dispute-${it.id}`}>
                        Puantajda aç
                      </button>
                    </>
                  )}
                </div>
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}

export default PersonnelRequestsInbox;
