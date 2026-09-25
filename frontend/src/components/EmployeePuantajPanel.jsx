import React, { useCallback, useEffect, useMemo, useState } from "react";
import axios from "axios";
import { toast } from "sonner";
import { Archive, CalendarDays, List, Loader2 } from "lucide-react";
import { API_URL } from "../context/AuthContext";
import { fmtDmy } from "../utils/dateFormat";
import {
  buildPuantajCalendarCells,
  leaveYearArchiveLine,
  PUANTAJ_WEEKDAYS,
  puantajStatusTone,
} from "../utils/puantajMonth";
import { attendanceCalendarMonth } from "../utils/attendanceSelf";

const toneClass = {
  emerald: "bg-emerald-50 text-emerald-800 border-emerald-200",
  rose: "bg-rose-50 text-rose-800 border-rose-200",
  amber: "bg-amber-50 text-amber-800 border-amber-200",
  slate: "bg-slate-50 text-slate-600 border-slate-200",
};

function DayBadge({ status, label }) {
  const tone = puantajStatusTone(status);
  return (
    <span className={`inline-flex px-1.5 py-0.5 rounded text-[10px] font-bold border ${toneClass[tone] || toneClass.slate}`}>
      {label}
    </span>
  );
}

export function EmployeePuantajPanel({ employeeId, initialMonth, onLeaveYearChanged }) {
  const [month, setMonth] = useState(() => initialMonth || attendanceCalendarMonth());
  const [view, setView] = useState("table");
  const [data, setData] = useState(null);
  const [busy, setBusy] = useState(false);
  const [archiveBusy, setArchiveBusy] = useState(false);

  const load = useCallback(async (m = month) => {
    if (!employeeId) return;
    setBusy(true);
    try {
      const r = await axios.get(`${API_URL}/personnel/employees/${employeeId}/puantaj`, { params: { month: m } });
      setData(r.data);
    } catch (err) {
      toast.error(err.response?.data?.detail || "Puantaj yüklenemedi.");
      setData(null);
    } finally {
      setBusy(false);
    }
  }, [employeeId, month]);

  useEffect(() => { load(month); }, [employeeId, month]); // eslint-disable-line react-hooks/exhaustive-deps

  const days = data?.days || [];
  const cells = useMemo(() => buildPuantajCalendarCells(days), [days]);
  const summary = data?.summary || {};
  const leaveYear = data?.leave_year || {};
  const archives = data?.leave_archives || [];

  const rollover = async () => {
    const y = leaveYear.year || new Date().getFullYear();
    if (!window.confirm(`${y} izin yılı arşivlensin ve ${y + 1} dönemi açılsın mı?\nKalan izin günleri yeni yıla devredilir.`)) return;
    setArchiveBusy(true);
    try {
      const r = await axios.post(`${API_URL}/personnel/employees/${employeeId}/leave-years/rollover`, {
        year: y,
        carry_remaining: true,
      });
      toast.success(r.data?.message || "Yıllık dönem arşivlendi.");
      await load(month);
      onLeaveYearChanged?.();
    } catch (err) {
      toast.error(err.response?.data?.detail || "Arşivlenemedi.");
    } finally {
      setArchiveBusy(false);
    }
  };

  return (
    <div className="space-y-3" data-testid="emp-puantaj-panel">
      <div className="grid grid-cols-2 md:grid-cols-5 gap-2">
        <div className="rounded-xl border border-slate-200 bg-white p-2.5">
          <div className="text-[10px] uppercase font-semibold text-slate-400">Ay ({month})</div>
          <div className="text-sm font-extrabold text-slate-900">Özet</div>
        </div>
        <div className="rounded-xl border border-slate-200 bg-white p-2.5">
          <div className="text-[10px] uppercase font-semibold text-slate-400">Çalışılan Gün</div>
          <div className="text-sm font-extrabold text-emerald-700" data-testid="emp-puantaj-present">{summary.days_present ?? 0}</div>
        </div>
        <div className="rounded-xl border border-slate-200 bg-white p-2.5">
          <div className="text-[10px] uppercase font-semibold text-slate-400">Devamsız</div>
          <div className="text-sm font-extrabold text-rose-700" data-testid="emp-puantaj-absent">{summary.days_absent ?? 0}</div>
        </div>
        <div className="rounded-xl border border-slate-200 bg-white p-2.5">
          <div className="text-[10px] uppercase font-semibold text-slate-400">İzinli</div>
          <div className="text-sm font-extrabold text-amber-700" data-testid="emp-puantaj-leave">{summary.days_leave ?? 0}</div>
        </div>
        <div className="rounded-xl border border-slate-200 bg-white p-2.5">
          <div className="text-[10px] uppercase font-semibold text-slate-400">Toplam / Mesai Saat</div>
          <div className="text-sm font-extrabold text-indigo-800" data-testid="emp-puantaj-hours">{summary.total_hours ?? 0} / {summary.overtime_hours ?? 0}</div>
        </div>
      </div>

      <div className="flex flex-wrap items-center gap-2 justify-between">
        <label className="flex items-center gap-2 text-[10px] font-bold uppercase tracking-wide text-slate-500">
          Dönem
          <input
            type="month"
            value={month}
            onChange={(e) => setMonth(e.target.value)}
            className="bg-slate-50 border rounded-lg p-1.5 text-xs font-semibold text-slate-800 normal-case tracking-normal"
            data-testid="emp-puantaj-month"
          />
        </label>
        <div className="inline-flex rounded-lg bg-slate-100 p-0.5" data-testid="emp-puantaj-view">
          <button
            type="button"
            onClick={() => setView("table")}
            className={`inline-flex items-center gap-1 px-2.5 py-1 rounded-md text-[11px] font-extrabold ${view === "table" ? "bg-white text-slate-900 shadow-sm" : "text-slate-500"}`}
            data-testid="emp-puantaj-view-table"
          >
            <List className="w-3.5 h-3.5" /> Tablo
          </button>
          <button
            type="button"
            onClick={() => setView("calendar")}
            className={`inline-flex items-center gap-1 px-2.5 py-1 rounded-md text-[11px] font-extrabold ${view === "calendar" ? "bg-white text-slate-900 shadow-sm" : "text-slate-500"}`}
            data-testid="emp-puantaj-view-calendar"
          >
            <CalendarDays className="w-3.5 h-3.5" /> Takvim
          </button>
        </div>
      </div>

      {busy && !data ? (
        <div className="flex items-center gap-2 text-slate-400 py-6 justify-center"><Loader2 className="w-4 h-4 animate-spin" /> Yükleniyor…</div>
      ) : null}

      {view === "table" ? (
        <div className="border border-slate-200 rounded-xl overflow-hidden" data-testid="emp-puantaj-table">
          <div className="overflow-x-auto max-h-72 overflow-y-auto">
            <table className="w-full text-left">
              <thead className="bg-slate-50 border-b text-slate-500 uppercase text-[10px] font-semibold sticky top-0">
                <tr>
                  <th className="px-3 py-2">Tarih</th>
                  <th className="px-3 py-2">Durum</th>
                  <th className="px-3 py-2">Giriş</th>
                  <th className="px-3 py-2">Çıkış</th>
                  <th className="px-3 py-2 text-right">Saat</th>
                  <th className="px-3 py-2 text-right">Mesai</th>
                  <th className="px-3 py-2">Not</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {!days.length ? (
                  <tr><td colSpan={7} className="px-3 py-6 text-center text-slate-400">Bu ay için gün satırı yok.</td></tr>
                ) : null}
                {days.map((d) => (
                  <tr key={d.date} data-testid={`emp-puantaj-day-${d.date}`} className={d.status === "off" ? "bg-slate-50/60" : d.status === "absent" ? "bg-rose-50/40" : d.status === "leave" ? "bg-amber-50/40" : ""}>
                    <td className="px-3 py-1.5 font-mono whitespace-nowrap">
                      {fmtDmy(d.date)} <span className="text-slate-400">{d.weekday_label}</span>
                    </td>
                    <td className="px-3 py-1.5"><DayBadge status={d.status} label={d.status_label} /></td>
                    <td className="px-3 py-1.5 font-mono font-bold text-emerald-700">{d.status === "present" ? (d.check_in || "—") : "—"}</td>
                    <td className="px-3 py-1.5 font-mono font-bold text-rose-700">{d.status === "present" ? (d.check_out || "—") : "—"}</td>
                    <td className="px-3 py-1.5 text-right font-semibold">{d.hours || "—"}</td>
                    <td className="px-3 py-1.5 text-right font-bold text-indigo-700">{d.overtime_hours ? `+${d.overtime_hours}` : "—"}</td>
                    <td className="px-3 py-1.5 text-slate-500 truncate max-w-[140px]" title={d.note || d.leave_label || ""}>{d.leave_label || d.note || (d.late_minutes ? `${d.late_minutes} dk geç` : "—")}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      ) : (
        <div className="border border-slate-200 rounded-xl p-2" data-testid="emp-puantaj-calendar">
          <div className="grid grid-cols-7 gap-1 mb-1">
            {PUANTAJ_WEEKDAYS.map((w) => (
              <div key={w} className="text-center text-[10px] font-bold uppercase text-slate-400 py-1">{w}</div>
            ))}
          </div>
          <div className="grid grid-cols-7 gap-1">
            {cells.map((d, i) => (
              <div
                key={d ? d.date : `blank-${i}`}
                className={`min-h-[52px] rounded-lg border p-1 ${!d ? "border-transparent" : `${toneClass[puantajStatusTone(d.status)] || toneClass.slate}`}`}
                data-testid={d ? `emp-puantaj-cal-${d.date}` : undefined}
              >
                {d ? (
                  <>
                    <div className="text-[11px] font-extrabold">{Number(d.date.slice(8, 10))}</div>
                    <div className="text-[9px] font-semibold leading-tight">{d.status === "present" ? `${d.check_in || "—"}→${d.check_out || "—"}` : d.status_label}</div>
                    {d.overtime_hours ? <div className="text-[9px] font-bold text-indigo-700">+{d.overtime_hours}sa</div> : null}
                  </>
                ) : null}
              </div>
            ))}
          </div>
        </div>
      )}

      <div className="rounded-xl border border-indigo-100 bg-indigo-50/50 p-3 space-y-2" data-testid="emp-puantaj-leave-year">
        <div className="flex flex-wrap items-start justify-between gap-2">
          <div>
            <div className="text-[10px] uppercase font-bold text-indigo-500">Yıllık izin dönemi</div>
            <div className="text-sm font-extrabold text-indigo-950" data-testid="emp-puantaj-leave-year-label">
              {leaveYear.year || "—"} · hak {leaveYear.annual ?? 0}g · kullanılan {leaveYear.used ?? 0}g
              {leaveYear.carry ? ` · devir ${leaveYear.carry}g` : ""} · kalan {leaveYear.remaining ?? 0}g
            </div>
          </div>
          <button
            type="button"
            disabled={archiveBusy}
            onClick={rollover}
            className="inline-flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg text-[11px] font-extrabold bg-indigo-600 text-white hover:bg-indigo-700 disabled:opacity-50"
            data-testid="emp-puantaj-leave-rollover"
          >
            {archiveBusy ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Archive className="w-3.5 h-3.5" />}
            Yılı arşivle / devret
          </button>
        </div>
        {archives.length ? (
          <ul className="space-y-1" data-testid="emp-puantaj-leave-archives">
            {archives.map((a) => (
              <li key={a.id || a.year} className="text-[11px] text-indigo-900/80 font-semibold flex items-center gap-1.5">
                <Archive className="w-3 h-3 shrink-0" />
                {leaveYearArchiveLine(a)}
              </li>
            ))}
          </ul>
        ) : (
          <div className="text-[11px] text-indigo-700/70">Henüz arşivlenmiş yıllık dönem yok.</div>
        )}
      </div>
    </div>
  );
}
