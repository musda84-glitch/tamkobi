import React, { useCallback, useEffect, useState } from "react";
import axios from "axios";
import { toast } from "sonner";
import { EyeOff, MapPin, Receipt, Wallet, X } from "lucide-react";
import { API_URL } from "../context/AuthContext";
import { useEscape } from "../utils/useEscape";
import { empIdOf } from "../utils/personnelIds";
import {
  employeePayMoves,
  filterPayMoves,
  fmtPayMoveAmount,
  locationMoveCanIgnore,
  locationMoveIgnorePath,
  locationMoveLine,
  locationMovesPeriodHint,
  payMovesPeriodHint,
  payMovesPeriodLabel,
} from "../utils/personnelCard";

const PERIODS = ["30d", "month", "all"];

export function EmployeeMovesModal({ employee, canEdit = true, onClose, onChanged }) {
  useEscape(onClose);
  const empId = empIdOf(employee);
  const [tab, setTab] = useState("pay");
  const [period, setPeriod] = useState("30d");
  const [month, setMonth] = useState(new Date().toISOString().slice(0, 7));
  const [moves, setMoves] = useState([]);
  const [locMoves, setLocMoves] = useState([]);
  const [busy, setBusy] = useState(false);
  const [locBusy, setLocBusy] = useState(false);
  const [ignoreBusy, setIgnoreBusy] = useState("");

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

  useEffect(() => { loadPay(); }, [loadPay]);
  useEffect(() => { loadLoc("30d", month); }, [empId]); // eslint-disable-line react-hooks/exhaustive-deps

  const shownPay = filterPayMoves(moves, period, new Date(), month);

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

  return (
    <div className="fixed inset-0 z-[70] bg-slate-900/50 flex items-end sm:items-center justify-center p-0 sm:p-4" onClick={onClose}>
      <div
        className="bg-white rounded-t-2xl sm:rounded-2xl w-full max-w-lg max-h-[88vh] overflow-hidden flex flex-col shadow-2xl"
        onClick={(ev) => ev.stopPropagation()}
        data-testid="emp-pay-moves-sheet"
      >
        <div className="p-4 border-b space-y-3">
          <div className="flex items-start justify-between gap-3">
            <div>
              <h3 className="text-base font-extrabold text-slate-900">{tab === "location" ? "Konum hareketleri" : "Ödeme hareketleri"}</h3>
              <div className="text-xs text-slate-500 font-semibold">{employee?.full_name}</div>
            </div>
            <button type="button" onClick={onClose} className="text-slate-400 hover:text-slate-700 p-1" data-testid="emp-pay-moves-close">
              <X className="w-5 h-5" />
            </button>
          </div>
          <div className="space-y-2" data-testid="emp-pay-moves-period">
            <div className="grid grid-cols-2 gap-1 rounded-xl bg-slate-100 p-1" data-testid="emp-moves-tab">
              <button
                type="button"
                onClick={() => setTab("pay")}
                className={`flex items-center justify-center gap-1.5 py-1.5 rounded-lg text-[11px] font-extrabold ${tab === "pay" ? "bg-white text-slate-900 shadow-sm" : "text-slate-500"}`}
              >
                <Wallet className="w-3.5 h-3.5" /> Ödeme
              </button>
              <button
                type="button"
                onClick={() => { setTab("location"); loadLoc(period, month); }}
                className={`flex items-center justify-center gap-1.5 py-1.5 rounded-lg text-[11px] font-extrabold ${tab === "location" ? "bg-white text-slate-900 shadow-sm" : "text-slate-500"}`}
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
                  onClick={() => {
                    setPeriod(key);
                    if (tab === "location") loadLoc(key, month);
                  }}
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
                  onChange={(e) => {
                    const value = e.target.value;
                    setMonth(value);
                    if (tab === "location") loadLoc("month", value);
                  }}
                  className="mt-0.5 block w-full border rounded-lg p-1.5 bg-white text-xs font-semibold text-slate-800"
                />
              </label>
            ) : null}
            <div className="text-[11px] text-slate-500" data-testid="emp-pay-moves-count">
              {tab === "location"
                ? locationMovesPeriodHint(locMoves.length, locMoves.length, "all")
                : payMovesPeriodHint(shownPay.length, moves.length, period)}
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
                  className="flex items-center gap-2 py-2.5 border-b border-slate-100"
                >
                  <div className="min-w-0 flex-1">
                    <div className="font-extrabold text-slate-900">{locationMoveLine(row)}</div>
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
  );
}

export function EmployeeMovesButton({ onClick, testId, className }) {
  return (
    <button type="button" onClick={onClick} className={className} data-testid={testId}>
      <Receipt className="w-3.5 h-3.5" /> Hareketler
    </button>
  );
}
