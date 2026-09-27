import React from "react";
import { X } from "lucide-react";

const inputCls = "w-full bg-slate-50 border rounded-lg p-2";

/** Fazla mesai atama: mesai bitişinden sonra eklenecek süre (saat) */
export function AssignOvertimeModal({ value, onChange, onClose, onSave, testIdPrefix = "emp-ot" }) {
  const set = (patch) => onChange({ ...value, ...patch });
  const tid = (name) => `${testIdPrefix}-${name}`;
  const hrs = Number(String(value.hours ?? "").toString().replace(",", "."));
  const hasHrs = Number.isFinite(hrs) && hrs > 0;

  return (
    <div className="fixed inset-0 z-50 bg-black/40 flex items-center justify-center p-4" data-testid={tid("modal")} onClick={onClose}>
      <div className="bg-white rounded-2xl shadow-xl w-full max-w-md p-5 space-y-3" onClick={(e) => e.stopPropagation()}>
        <div className="flex items-center justify-between">
          <h4 className="text-sm font-bold text-slate-900">Fazla Mesai Ata — {value.employee_name}</h4>
          <button type="button" onClick={onClose} className="text-slate-400"><X className="w-5 h-5" /></button>
        </div>
        <p className="text-[11px] text-slate-500">
          Mesai bitiminden sonra kaç saat fazla mesai olacağını yazın (örn. 2). Bu süre mesai bitişine eklenir; beklenen çıkış uzar.
        </p>
        <div className="grid grid-cols-2 gap-2 text-xs">
          <div className="col-span-2">
            <label className="block text-[10px] font-semibold text-slate-500 mb-0.5">Tarih</label>
            <input type="date" value={value.date} onChange={(e) => set({ date: e.target.value })} className={inputCls} data-testid={tid("date")} />
          </div>
          <div className="col-span-2 rounded-lg border border-indigo-100 bg-indigo-50/70 px-2.5 py-1.5 text-[11px] text-indigo-800" data-testid={tid("range-hint")}>
            {hasHrs
              ? `Mesai bitişinden sonra +${hrs} sa`
              : "Örn. 2 yazınca mesai bitişine 2 saat eklenir"}
          </div>
          <div className="col-span-2">
            <label className="block text-[10px] font-semibold text-slate-500 mb-0.5">Süre (saat)</label>
            <input
              type="number"
              min="0"
              step="0.5"
              value={value.hours}
              onChange={(e) => set({ hours: e.target.value, start: "", end: "" })}
              className={inputCls}
              placeholder="örn. 2"
              data-testid={tid("hours")}
            />
          </div>
        </div>
        <div className="text-xs">
          <label className="block text-[10px] font-semibold text-slate-500 mb-0.5">Not (opsiyonel)</label>
          <input value={value.note || ""} onChange={(e) => set({ note: e.target.value })} className={inputCls} data-testid={tid("note")} />
        </div>
        <div className="flex justify-end gap-2 pt-1">
          <button type="button" onClick={onClose} className="px-3 py-1.5 rounded-lg border text-xs font-semibold" data-testid={tid("cancel")}>Vazgeç</button>
          <button type="button" onClick={onSave} className="px-3 py-1.5 rounded-lg bg-indigo-600 text-white text-xs font-semibold hover:bg-indigo-700" data-testid={tid("save")}>Kaydet</button>
        </div>
      </div>
    </div>
  );
}

export default AssignOvertimeModal;
