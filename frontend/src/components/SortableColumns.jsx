
import React, { useMemo, useState } from "react";
import { ArrowUp, ArrowDown, ArrowUpDown, GripVertical, RotateCcw } from "lucide-react";

const STORAGE = "nexus_contact_inv_cols_v1";
export const DEFAULT_COLS = ["number", "date", "type", "amount", "gib", "payment"];
const LABELS = { number: "Fatura No", date: "Tarih", type: "Tür", amount: "Tutar", gib: "GİB", payment: "Ödeme" };
const PAY_RANK = { unpaid: 0, partially_paid: 1, paid: 2 };
const SORT_VAL = {
  number: (i) => i.invoice_number || "", date: (i) => i.issue_date || "", type: (i) => `${i.invoice_type}-${i.e_type}`, amount: (i) => Number(i.grand_total) || 0,
  gib: (i) => i.gib_status || "", payment: (i) => PAY_RANK[i.payment_status] ?? 0,
};

const load = () => { try { const v = JSON.parse(localStorage.getItem(STORAGE)); return Array.isArray(v) && v.length === DEFAULT_COLS.length && DEFAULT_COLS.every((c) => v.includes(c)) ? v : DEFAULT_COLS; } catch { return DEFAULT_COLS; } };

export const useSortableColumns = () => {
  const [cols, setCols] = useState(load);
  const [sort, setSort] = useState({ key: "date", dir: "desc" });
  const move = (from, to) => { if (from === to) return; setCols((c) => { const n = [...c]; const [x] = n.splice(n.indexOf(from), 1); n.splice(n.indexOf(to), 0, x); localStorage.setItem(STORAGE, JSON.stringify(n)); return n; }); };
  const reset = () => { localStorage.removeItem(STORAGE); setCols(DEFAULT_COLS); setSort({ key: "date", dir: "desc" }); };
  const toggleSort = (key) => setSort((s) => (s.key === key ? { key, dir: s.dir === "asc" ? "desc" : "asc" } : { key, dir: key === "number" || key === "type" ? "asc" : "desc" }));
  return { cols, sort, move, reset, toggleSort };
};

export const sortRows = (rows, sort) => {
  const val = SORT_VAL[sort.key] || (() => 0);
  return [...rows].sort((a, b) => { const x = val(a), y = val(b); const r = typeof x === "number" ? x - y : String(x).localeCompare(String(y), "tr"); return sort.dir === "asc" ? r : -r; });
};

export const SortableHeader = ({ cols, sort, move, reset, toggleSort, extra }) => {
  const [drag, setDrag] = useState(null);
  const [over, setOver] = useState(null);
  const isDefault = cols.join() === DEFAULT_COLS.join() && sort.key === "date" && sort.dir === "desc";
  return (
    <thead className="text-slate-500 uppercase text-[10px] font-semibold border-b select-none">
      <tr>
        {cols.map((k) => (
          <th key={k} draggable onDragStart={() => setDrag(k)} onDragOver={(e) => { e.preventDefault(); setOver(k); }} onDragLeave={() => setOver(null)} onDrop={() => { if (drag) move(drag, k); setDrag(null); setOver(null); }} onDragEnd={() => { setDrag(null); setOver(null); }}
            className={`py-2 pr-2 cursor-grab active:cursor-grabbing group ${k === "amount" ? "text-right" : ""} ${over === k && drag !== k ? "bg-emerald-50 border-l-2 border-emerald-500" : ""} ${drag === k ? "opacity-40" : ""}`} title="Sıralamak için tıkla, yerini değiştirmek için sürükle" data-testid={`detail-inv-col-${k}`}>
            <button onClick={() => toggleSort(k)} className={`inline-flex items-center gap-1 hover:text-slate-900 ${sort.key === k ? "text-emerald-700" : ""}`} data-testid={`detail-inv-sort-${k}`}>
              <GripVertical className="w-3 h-3 text-slate-300 opacity-0 group-hover:opacity-100" />{LABELS[k]}
              {sort.key === k ? (sort.dir === "asc" ? <ArrowUp className="w-3 h-3" /> : <ArrowDown className="w-3 h-3" />) : <ArrowUpDown className="w-3 h-3 text-slate-300 opacity-0 group-hover:opacity-100" />}
            </button>
          </th>
        ))}
        <th className="py-2 text-right">{!isDefault && <button onClick={reset} className="inline-flex items-center gap-1 normal-case text-[10px] text-slate-400 hover:text-slate-700" title="Sütun düzenini ve sıralamayı sıfırla" data-testid="detail-inv-cols-reset"><RotateCcw className="w-3 h-3" /> Sıfırla</button>}{extra}</th>
      </tr>
    </thead>
  );
};

export const useSortedRows = (rows, sort) => useMemo(() => sortRows(rows, sort), [rows, sort]);
