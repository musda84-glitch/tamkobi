import React, { useCallback, useEffect, useMemo, useState } from "react";
import axios from "axios";
import { toast } from "sonner";
import { Archive, CalendarDays, List, Loader2, Pencil } from "lucide-react";
import { API_URL } from "../context/AuthContext";
import { fmtDmy } from "../utils/dateFormat";
import {
  buildPuantajCalendarCells,
  leaveYearArchiveLine,
  puantajEditDraft,
  puantajEditPayload,
  puantajEditValidate,
  PUANTAJ_EDIT_STATUSES,
  PUANTAJ_WEEKDAYS,
  puantajStatusTone,
  puantajWageAskCopy,
  puantajWageAskReason,
  puantajWageCanAsk,
  puantajWageDecisionPath,
} from "../utils/puantajMonth";
import { attendanceCalendarMonth } from "../utils/attendanceSelf";
import { formatTrAmount } from "../utils/money";
import { backdropDismissProps } from "../utils/modalBackdrop";
import { punchLabelClass } from "../utils/punchLabels";

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
  const [wageAsk, setWageAsk] = useState(null);
  const [wageBusy, setWageBusy] = useState(false);
  const [editDay, setEditDay] = useState(null);
  const [editForm, setEditForm] = useState(null);
  const [editBusy, setEditBusy] = useState(false);

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

  const decideWageCut = async (day, decision) => {
    const path = puantajWageDecisionPath(day);
    if (!path) {
      toast.error("Puantaj kaydı bulunamadı.");
      return;
    }
    setWageBusy(true);
    try {
      const r = await axios.post(`${API_URL}${path}`, { decision }, { withCredentials: true });
      toast.success(r.data?.message || (decision === "approve" ? "Ücret kesildi." : "Ücret kesilmedi."));
      setWageAsk(null);
      await load(month);
    } catch (err) {
      toast.error(err.response?.data?.detail || "Karar kaydedilemedi.");
    } finally {
      setWageBusy(false);
    }
  };

  const wageAskCopy = wageAsk ? puantajWageAskCopy(wageAsk, formatTrAmount) : null;

  const openEdit = (day) => {
    setEditDay(day);
    setEditForm(puantajEditDraft(day));
  };

  const saveEdit = async () => {
    const invalid = puantajEditValidate(editForm);
    if (invalid) {
      toast.error(invalid);
      return;
    }
    setEditBusy(true);
    try {
      const r = await axios.post(`${API_URL}/personnel/attendance`, puantajEditPayload(employeeId, editForm));
      toast.success(r.data?.message || "Puantaj kaydı güncellendi.");
      setEditDay(null);
      setEditForm(null);
      await load(month);
    } catch (err) {
      toast.error(err.response?.data?.detail || "Puantaj kaydedilemedi.");
    } finally {
      setEditBusy(false);
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
          <div className="text-[10px] font-bold text-violet-700 mt-0.5" data-testid="emp-puantaj-ot-pay">
            F.mesai: {formatTrAmount(summary.overtime_pay ?? 0)} ₺
          </div>
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
                  <th className="px-3 py-2 text-right">Ücret</th>
                  <th className="px-3 py-2">Not</th>
                  <th className="px-3 py-2 text-right"> </th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {!days.length ? (
                  <tr><td colSpan={9} className="px-3 py-6 text-center text-slate-400">Bu ay için gün satırı yok.</td></tr>
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
                    <td className="px-3 py-1.5 text-right font-bold text-emerald-800 whitespace-nowrap" data-testid={`emp-puantaj-wage-${d.date}`}>
                      {d.status === "present" && d.wage != null ? (
                        puantajWageCanAsk(d) ? (
                          <button
                            type="button"
                            onClick={() => setWageAsk(d)}
                            className="inline-flex items-center justify-end rounded-md px-1.5 py-0.5 font-bold text-amber-800 bg-amber-50 border border-amber-200 hover:bg-amber-100"
                            title="Ücret kes / kesme"
                            data-testid={`emp-puantaj-wage-open-${d.date}`}
                          >
                            {formatTrAmount(d.wage)} ₺
                          </button>
                        ) : (
                          `${formatTrAmount(d.wage)} ₺`
                        )
                      ) : "—"}
                    </td>
                    <td className="px-3 py-1.5 text-slate-500 truncate max-w-[140px]" title={d.note || d.leave_label || puantajWageAskReason(d) || ""}>{d.leave_label || d.note || puantajWageAskReason(d) || "—"}</td>
                    <td className="px-2 py-1.5 text-right">
                      <button
                        type="button"
                        onClick={() => openEdit(d)}
                        className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded-md border border-slate-200 text-slate-600 hover:bg-slate-50 hover:text-slate-900"
                        title="Günü düzenle"
                        data-testid={`emp-puantaj-edit-${d.date}`}
                      >
                        <Pencil className="w-3.5 h-3.5" />
                        Düzenle
                      </button>
                    </td>
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
              d ? (
              <button
                type="button"
                key={d.date}
                onClick={() => openEdit(d)}
                className={`min-h-[52px] rounded-lg border p-1 text-left ${toneClass[puantajStatusTone(d.status)] || toneClass.slate}`}
                data-testid={`emp-puantaj-cal-${d.date}`}
              >
                <div className="text-[11px] font-extrabold">{Number(d.date.slice(8, 10))}</div>
                <div className="text-[9px] font-semibold leading-tight">{d.status === "present" ? `${d.check_in || "—"}→${d.check_out || "—"}` : d.status_label}</div>
                {d.overtime_hours ? <div className="text-[9px] font-bold text-indigo-700">+{d.overtime_hours}sa</div> : null}
              </button>
              ) : (
              <div key={`blank-${i}`} className="min-h-[52px] rounded-lg border p-1 border-transparent" />
              )
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

      {editDay && editForm ? (
        <div
          className="fixed inset-0 z-[70] bg-slate-900/50 flex items-center justify-center p-4"
          {...backdropDismissProps((ev) => { ev.stopPropagation(); if (!editBusy) { setEditDay(null); setEditForm(null); } })}
          data-testid={`emp-puantaj-edit-modal-${editDay.date}`}
        >
          <form
            className="bg-white rounded-2xl w-full max-w-sm p-4 shadow-2xl space-y-3"
            onClick={(e) => e.stopPropagation()}
            onSubmit={(e) => { e.preventDefault(); saveEdit(); }}
          >
            <div>
              <div className="text-sm font-extrabold text-slate-900">Puantaj düzenle</div>
              <div className="text-[11px] font-semibold text-slate-500">
                {fmtDmy(editDay.date)} {editDay.weekday_label}
              </div>
            </div>
            <div className="grid grid-cols-3 gap-1" data-testid="emp-puantaj-edit-status">
              {PUANTAJ_EDIT_STATUSES.map((s) => (
                <button
                  type="button"
                  key={s.value}
                  onClick={() => setEditForm((cur) => (cur ? { ...cur, status: s.value } : cur))}
                  className={`py-1.5 rounded-lg border text-[11px] font-extrabold ${editForm.status === s.value ? "bg-indigo-50 text-indigo-800 border-indigo-200" : "bg-white text-slate-500 border-slate-200"}`}
                  data-testid={`emp-puantaj-edit-status-${s.value}`}
                >
                  {s.label}
                </button>
              ))}
            </div>
            {editForm.status === "present" ? (
              <div className="grid grid-cols-2 gap-2">
                <label className={`text-[10px] font-bold block ${punchLabelClass("Giriş saati")}`}>
                  Giriş
                  <input
                    type="time"
                    value={editForm.check_in || ""}
                    onChange={(e) => setEditForm((cur) => (cur ? { ...cur, check_in: e.target.value } : cur))}
                    className="mt-0.5 block w-full border rounded-lg p-1.5 bg-slate-50"
                    data-testid="emp-puantaj-edit-in"
                  />
                </label>
                <label className={`text-[10px] font-bold block ${punchLabelClass("Çıkış saati")}`}>
                  Çıkış
                  <input
                    type="time"
                    value={editForm.check_out || ""}
                    onChange={(e) => setEditForm((cur) => (cur ? { ...cur, check_out: e.target.value } : cur))}
                    className="mt-0.5 block w-full border rounded-lg p-1.5 bg-slate-50"
                    data-testid="emp-puantaj-edit-out"
                  />
                </label>
              </div>
            ) : (
              <p className="text-[11px] text-slate-500">Devamsız / izinli günde giriş-çıkış saati tutulmaz.</p>
            )}
            <label className="text-[10px] font-bold block text-slate-500">
              Not
              <input
                type="text"
                value={editForm.note || ""}
                onChange={(e) => setEditForm((cur) => (cur ? { ...cur, note: e.target.value } : cur))}
                className="mt-0.5 block w-full border rounded-lg p-1.5 bg-slate-50 font-normal text-slate-800"
                data-testid="emp-puantaj-edit-note"
              />
            </label>
            <div className="flex items-center justify-end gap-2">
              <button
                type="button"
                disabled={editBusy}
                onClick={() => { setEditDay(null); setEditForm(null); }}
                className="px-3 py-1.5 rounded-lg text-[11px] font-extrabold bg-white border text-slate-700"
                data-testid="emp-puantaj-edit-cancel"
              >
                Vazgeç
              </button>
              <button
                type="submit"
                disabled={editBusy}
                className="px-3 py-1.5 rounded-lg text-[11px] font-extrabold bg-indigo-600 text-white hover:bg-indigo-700 disabled:opacity-50"
                data-testid="emp-puantaj-edit-save"
              >
                {editBusy ? "Kaydediliyor…" : "Kaydet"}
              </button>
            </div>
          </form>
        </div>
      ) : null}

      {wageAsk && wageAskCopy ? (
        <div
          className="fixed inset-0 z-[70] bg-slate-900/50 flex items-center justify-center p-4"
          {...backdropDismissProps((ev) => { ev.stopPropagation(); if (!wageBusy) setWageAsk(null); })}
          data-testid={`emp-puantaj-wage-ask-${wageAsk.date}`}
        >
          <div className="bg-white rounded-2xl w-full max-w-sm p-4 shadow-2xl space-y-3" onClick={(e) => e.stopPropagation()}>
            <div className="text-sm font-extrabold text-slate-900">{wageAskCopy.title}</div>
            <div className="text-xs font-semibold text-slate-600">{wageAskCopy.body} Ücreti kessin mi?</div>
            <div className="flex flex-wrap items-center gap-2 justify-end">
              <button
                type="button"
                disabled={wageBusy}
                onClick={() => decideWageCut(wageAsk, "reject")}
                className="px-3 py-1.5 rounded-lg text-[11px] font-extrabold bg-emerald-600 text-white hover:bg-emerald-700 disabled:opacity-50"
                data-testid={`emp-puantaj-wage-kesme-${wageAsk.date}`}
              >
                {wageAskCopy.kesme}
              </button>
              <button
                type="button"
                disabled={wageBusy}
                onClick={() => decideWageCut(wageAsk, "approve")}
                className="px-3 py-1.5 rounded-lg text-[11px] font-extrabold bg-amber-500 text-white hover:bg-amber-600 disabled:opacity-50"
                data-testid={`emp-puantaj-wage-kes-${wageAsk.date}`}
              >
                {wageAskCopy.kes}
              </button>
              <button
                type="button"
                disabled={wageBusy}
                onClick={() => setWageAsk(null)}
                className="px-3 py-1.5 rounded-lg text-[11px] font-extrabold bg-white border text-slate-700"
                data-testid="emp-puantaj-wage-ask-close"
              >
                Vazgeç
              </button>
            </div>
          </div>
        </div>
      ) : null}
    </div>
  );
}
