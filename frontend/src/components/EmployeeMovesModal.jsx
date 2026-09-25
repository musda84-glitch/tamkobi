import React, { useCallback, useEffect, useState } from "react";
import axios from "axios";
import { toast } from "sonner";
import { Clock, EyeOff, MapPin, Pencil, Receipt, Trash2, Wallet, X } from "lucide-react";
import { API_URL } from "../context/AuthContext";
import { useEscape } from "../utils/useEscape";
import { empIdOf } from "../utils/personnelIds";
import { AssignOvertimeModal } from "./AssignOvertimeModal";
import {
  employeePayMoves,
  filterPayMoves,
  fmtPayMoveAmount,
  locationMoveBg,
  locationMoveCanIgnore,
  locationMoveColor,
  locationMoveDidLabel,
  locationMoveIgnorePath,
  locationMoveLine,
  locationMovesPeriodHint,
  overtimeMoveCanDelete,
  overtimeMoveCanEdit,
  overtimeMoveDeleteConfirm,
  overtimeMoveDetail,
  overtimeMoveLine,
  overtimeMovesPeriodHint,
  payMovesPeriodHint,
  payMovesPeriodLabel,
} from "../utils/personnelCard";

const PERIODS = ["30d", "month", "all"];

const TAB_TITLE = {
  pay: "Ödeme hareketleri",
  location: "Konum hareketleri",
  overtime: "Mesai hareketleri",
};

export function EmployeeMovesModal({ employee, canEdit = true, onClose, onChanged }) {
  useEscape(onClose);
  const empId = empIdOf(employee);
  const [tab, setTab] = useState("pay");
  const [period, setPeriod] = useState("30d");
  const [month, setMonth] = useState(new Date().toISOString().slice(0, 7));
  const [moves, setMoves] = useState([]);
  const [locMoves, setLocMoves] = useState([]);
  const [otMoves, setOtMoves] = useState([]);
  const [busy, setBusy] = useState(false);
  const [locBusy, setLocBusy] = useState(false);
  const [otBusy, setOtBusy] = useState(false);
  const [ignoreBusy, setIgnoreBusy] = useState("");
  const [otBusyId, setOtBusyId] = useState("");
  const [otEdit, setOtEdit] = useState(null);

  const loadPay = useCallback(async () => {
    if (!empId) return;
    setBusy(true);
    try {
      const card = (await axios.get(`${API_URL}/personnel/employees/${empId}/card`)).data;
      setMoves(employeePayMoves(card));
    } catch (err) {
      toast.error(err.response?.data?.detail || "Ödeme hareketleri yüklenemedi.");
      setMoves([]);
    } finally {
      setBusy(false);
    }
  }, [empId]);

  const loadLoc = useCallback(async (nextPeriod = period, nextMonth = month) => {
    if (!empId) return;
    setLocBusy(true);
    try {
      const res = await axios.get(`${API_URL}/personnel/employees/${empId}/location-moves`, {
        params: { period: nextPeriod, month: nextMonth },
      });
      setLocMoves(res.data?.items || []);
    } catch (err) {
      toast.error(err.response?.data?.detail || "Konum hareketleri yüklenemedi.");
      setLocMoves([]);
    } finally {
      setLocBusy(false);
    }
  }, [empId, month, period]);

  const loadOt = useCallback(async (nextPeriod = period, nextMonth = month) => {
    if (!empId) return;
    setOtBusy(true);
    try {
      const res = await axios.get(`${API_URL}/personnel/employees/${empId}/overtime-moves`, {
        params: { period: nextPeriod, month: nextMonth },
      });
      setOtMoves(res.data?.items || []);
    } catch (err) {
      toast.error(err.response?.data?.detail || "Mesai hareketleri yüklenemedi.");
      setOtMoves([]);
    } finally {
      setOtBusy(false);
    }
  }, [empId, month, period]);

  useEffect(() => { loadPay(); }, [loadPay]);
  useEffect(() => { loadLoc("30d", month); }, [empId]); // eslint-disable-line react-hooks/exhaustive-deps

  const shownPay = filterPayMoves(moves, period, new Date(), month);

  const onPeriodChange = (key) => {
    setPeriod(key);
    if (tab === "location") loadLoc(key, month);
    if (tab === "overtime") loadOt(key, month);
  };

  const onMonthChange = (value) => {
    setMonth(value);
    if (tab === "location") loadLoc("month", value);
    if (tab === "overtime") loadOt("month", value);
  };

  const ignoreMove = async (row) => {
    const path = locationMoveIgnorePath(row);
    if (!path) return;
    setIgnoreBusy(row.id);
    try {
      const r = await axios.post(`${API_URL}${path}`, {});
      setLocMoves((prev) => prev.map((m) => (m.id === row.id ? { ...m, ignored: true, ignored_at: new Date().toISOString() } : m)));
      toast.success(r.data?.message || "Konum kaybı görmezden gelindi.");
      onChanged?.();
    } catch (err) {
      toast.error(err.response?.data?.detail || "Görmezden gelinemedi.");
    } finally {
      setIgnoreBusy("");
    }
  };

  const openOtEdit = (row) => {
    setOtEdit({
      employee_id: empId,
      employee_name: employee?.full_name || row.employee_name || "",
      date: row.date,
      hours: row.hours != null ? String(row.hours) : "",
      start: row.start || "",
      end: row.end || "",
      note: row.note || "",
      _id: row.id,
    });
  };

  const saveOtEdit = async () => {
    if (!otEdit) return;
    setOtBusyId(otEdit._id || otEdit.date);
    try {
      const r = await axios.put(`${API_URL}/personnel/attendance/assign-overtime`, {
        employee_id: otEdit.employee_id,
        date: otEdit.date,
        hours: Number(otEdit.hours) || 0,
        start_time: otEdit.start || undefined,
        end_time: otEdit.end || undefined,
        note: otEdit.note || "",
      });
      toast.success(r.data?.message || "Fazla mesai güncellendi.");
      setOtEdit(null);
      await loadOt(period, month);
      onChanged?.();
    } catch (err) {
      toast.error(err.response?.data?.detail || "Mesai kaydedilemedi.");
    } finally {
      setOtBusyId("");
    }
  };

  const deleteOt = async (row) => {
    if (!overtimeMoveCanDelete(row, canEdit)) return;
    const ask = overtimeMoveDeleteConfirm();
    if (!window.confirm(`${ask.title}\n${ask.message}`)) return;
    setOtBusyId(row.id);
    try {
      const r = await axios.put(`${API_URL}/personnel/attendance/assign-overtime`, {
        employee_id: empId,
        date: row.date,
        hours: 0,
        note: "",
      });
      toast.success(r.data?.message || "Fazla mesai silindi.");
      await loadOt(period, month);
      onChanged?.();
    } catch (err) {
      toast.error(err.response?.data?.detail || "Mesai silinemedi.");
    } finally {
      setOtBusyId("");
    }
  };

  const periodHint = () => {
    if (tab === "location") return locationMovesPeriodHint(locMoves.length, locMoves.length, "all");
    if (tab === "overtime") return overtimeMovesPeriodHint(otMoves.length, otMoves.length, "all");
    return payMovesPeriodHint(shownPay.length, moves.length, period);
  };

  return (
    <>
    <div className="fixed inset-0 z-[70] bg-slate-900/50 flex items-end sm:items-center justify-center p-0 sm:p-4" onClick={onClose}>
      <div
        className="bg-white rounded-t-2xl sm:rounded-2xl w-full max-w-lg max-h-[88vh] overflow-hidden flex flex-col shadow-2xl"
        onClick={(ev) => ev.stopPropagation()}
        data-testid="emp-pay-moves-sheet"
      >
        <div className="p-4 border-b space-y-3">
          <div className="flex items-start justify-between gap-3">
            <div>
              <h3 className="text-base font-extrabold text-slate-900">{TAB_TITLE[tab] || TAB_TITLE.pay}</h3>
              <div className="text-xs text-slate-500 font-semibold">{employee?.full_name}</div>
            </div>
            <button type="button" onClick={onClose} className="text-slate-400 hover:text-slate-700 p-1" data-testid="emp-pay-moves-close">
              <X className="w-5 h-5" />
            </button>
          </div>
          <div className="space-y-2" data-testid="emp-pay-moves-period">
            <div className="grid grid-cols-3 gap-1 rounded-xl bg-slate-100 p-1" data-testid="emp-moves-tab">
              <button
                type="button"
                onClick={() => setTab("pay")}
                className={`flex items-center justify-center gap-1.5 py-1.5 rounded-lg text-[11px] font-extrabold ${tab === "pay" ? "bg-white text-slate-900 shadow-sm" : "text-slate-500"}`}
                data-testid="emp-moves-tab-pay"
              >
                <Wallet className="w-3.5 h-3.5" /> Ödeme
              </button>
              <button
                type="button"
                onClick={() => { setTab("overtime"); loadOt(period, month); }}
                className={`flex items-center justify-center gap-1.5 py-1.5 rounded-lg text-[11px] font-extrabold ${tab === "overtime" ? "bg-white text-slate-900 shadow-sm" : "text-slate-500"}`}
                data-testid="emp-moves-tab-overtime"
              >
                <Clock className="w-3.5 h-3.5" /> Mesai
              </button>
              <button
                type="button"
                onClick={() => { setTab("location"); loadLoc(period, month); }}
                className={`flex items-center justify-center gap-1.5 py-1.5 rounded-lg text-[11px] font-extrabold ${tab === "location" ? "bg-white text-slate-900 shadow-sm" : "text-slate-500"}`}
                data-testid="emp-moves-tab-location"
              >
                <MapPin className="w-3.5 h-3.5" /> Konum
              </button>
            </div>
            <div className="flex flex-wrap gap-2">
              {PERIODS.map((key) => (
                <button
                  key={key}
                  type="button"
                  data-testid={`emp-pay-moves-period-${key}`}
                  onClick={() => onPeriodChange(key)}
                  className={`px-2.5 py-1 rounded-full text-[11px] font-extrabold border ${period === key ? "bg-indigo-50 text-indigo-700 border-indigo-300" : "bg-slate-50 text-slate-700 border-slate-200"}`}
                >
                  {payMovesPeriodLabel(key)}
                </button>
              ))}
            </div>
            {period === "month" ? (
              <label className="block text-[10px] font-bold text-slate-500">
                Dönem
                <input
                  type="month"
                  data-testid="emp-pay-moves-month"
                  value={month}
                  onChange={(e) => onMonthChange(e.target.value)}
                  className="mt-0.5 block w-full border rounded-lg p-1.5 bg-white text-xs font-semibold text-slate-800"
                />
              </label>
            ) : null}
            <div className="text-[11px] text-slate-500" data-testid="emp-pay-moves-count">
              {periodHint()}
            </div>
          </div>
        </div>
        <div className="p-4 overflow-y-auto space-y-0 text-xs">
          {tab === "location" ? (
            <>
              {locBusy ? <div className="text-slate-400">Yükleniyor…</div> : null}
              {!locBusy && !locMoves.length ? <div className="text-slate-400">Bu dönemde konum hareketi yok.</div> : null}
              {locMoves.map((row) => (
                <div
                  key={row.id || `${row.attendance_id}-${row.at}`}
                  data-testid={`emp-loc-move-${row.id || row.at}`}
                  className="flex items-center gap-2 py-2.5 px-2 mb-1 rounded-lg border-l-4"
                  style={{
                    borderLeftColor: locationMoveColor(row.kind, !!row.ignored, locationMoveDidLabel(row.kind)),
                    backgroundColor: locationMoveBg(row.kind, !!row.ignored, locationMoveDidLabel(row.kind)),
                  }}
                >
                  <div className="min-w-0 flex-1">
                    <div className="font-extrabold" style={{ color: locationMoveColor(row.kind, !!row.ignored, locationMoveDidLabel(row.kind)) }}>{locationMoveLine(row)}</div>
                    {row.place ? <div className="text-slate-500">{row.place}</div> : null}
                    {row.ignored ? <div className="text-slate-400" data-testid={`emp-loc-move-ignored-${row.id}`}>Görmezden gelindi</div> : null}
                  </div>
                  {canEdit && locationMoveCanIgnore(row) ? (
                    <button
                      type="button"
                      data-testid={`emp-loc-move-ignore-${row.id}`}
                      aria-label="Görmezden gel"
                      title="Görmezden gel"
                      disabled={!!ignoreBusy}
                      onClick={() => ignoreMove(row)}
                      className="w-8 h-8 rounded-full border border-slate-200 bg-slate-50 text-slate-500 flex items-center justify-center shrink-0 disabled:opacity-50"
                    >
                      <EyeOff className="w-4 h-4" />
                    </button>
                  ) : null}
                </div>
              ))}
            </>
          ) : tab === "overtime" ? (
            <>
              {otBusy ? <div className="text-slate-400">Yükleniyor…</div> : null}
              {!otBusy && !otMoves.length ? <div className="text-slate-400" data-testid="emp-ot-moves-empty">Bu dönemde mesai kaydı yok.</div> : null}
              {otMoves.map((row) => (
                <div
                  key={row.id || row.date}
                  data-testid={`emp-ot-move-${row.id || row.date}`}
                  className="flex items-start gap-2 py-2.5 border-b border-slate-100"
                >
                  <div className="min-w-0 flex-1">
                    <div className="font-extrabold text-indigo-800" data-testid={`emp-ot-move-line-${row.id || row.date}`}>{overtimeMoveLine(row)}</div>
                    {overtimeMoveDetail(row) ? (
                      <div className="text-slate-500" data-testid={`emp-ot-move-punch-${row.id || row.date}`}>{overtimeMoveDetail(row)}</div>
                    ) : null}
                    {row.note ? <div className="text-slate-400 italic">{row.note}</div> : null}
                  </div>
                  {overtimeMoveCanEdit(row, canEdit) || overtimeMoveCanDelete(row, canEdit) ? (
                    <div className="flex items-center gap-1 shrink-0">
                      {overtimeMoveCanEdit(row, canEdit) ? (
                        <button
                          type="button"
                          data-testid={`emp-ot-move-edit-${row.id || row.date}`}
                          aria-label="Düzenle"
                          title="Düzenle"
                          disabled={!!otBusyId}
                          onClick={() => openOtEdit(row)}
                          className="w-8 h-8 rounded-full border border-indigo-200 bg-indigo-50 text-indigo-700 flex items-center justify-center disabled:opacity-50"
                        >
                          <Pencil className="w-3.5 h-3.5" />
                        </button>
                      ) : null}
                      {overtimeMoveCanDelete(row, canEdit) ? (
                        <button
                          type="button"
                          data-testid={`emp-ot-move-delete-${row.id || row.date}`}
                          aria-label="Sil"
                          title="Sil"
                          disabled={!!otBusyId}
                          onClick={() => deleteOt(row)}
                          className="w-8 h-8 rounded-full border border-rose-200 bg-rose-50 text-rose-700 flex items-center justify-center disabled:opacity-50"
                        >
                          <Trash2 className="w-3.5 h-3.5" />
                        </button>
                      ) : null}
                    </div>
                  ) : null}
                </div>
              ))}
            </>
          ) : (
            <>
              {busy ? <div className="text-slate-400">Yükleniyor…</div> : null}
              {!busy && !shownPay.length ? <div className="text-slate-400">Bu dönemde ödeme hareketi yok.</div> : null}
              {shownPay.map((row) => (
                <div key={row.id} data-testid={`emp-pay-move-${row.id}`} className="py-2.5 border-b border-slate-100">
                  <div className="font-extrabold text-slate-900">{row.title}</div>
                  <div className="text-slate-500">{row.subtitle}</div>
                  <div className={`font-extrabold ${row.title === "Avans" ? "text-amber-700" : "text-slate-900"}`}>{fmtPayMoveAmount(row.amount)}</div>
                </div>
              ))}
            </>
          )}
        </div>
      </div>
    </div>
    {otEdit ? (
      <div className="fixed inset-0 z-[80]">
        <AssignOvertimeModal
          value={otEdit}
          onChange={setOtEdit}
          onClose={() => setOtEdit(null)}
          onSave={saveOtEdit}
          testIdPrefix="emp-moves-ot"
        />
      </div>
    ) : null}
    </>
  );
}

export function EmployeeMovesButton({ onClick, testId, className }) {
  return (
    <button type="button" onClick={onClick} className={className} data-testid={testId}>
      <Receipt className="w-3.5 h-3.5" /> Hareketler
    </button>
  );
}
