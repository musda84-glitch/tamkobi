import React, { useCallback, useContext, useEffect, useMemo, useRef, useState } from "react";
import { ArrowDown, ArrowUp } from "lucide-react";
import { fmtDate, fmtMoney } from "../utils/money";
import {
  statementDocTypeOptions,
  statementFiltersActive,
  statementGibState,
  statementTotals,
  statementView,
} from "../utils/statementView";
import { TxMobileCard, TxResponsiveList, TxTypeBadge, TX_WRAP_CLASS } from "./TxMobileCard";

const StatementViewContext = React.createContext(null);
const EMPTY_FILTERS = { from: "", to: "", docType: "", q: "", side: "all", gib: "all" };

const SORT_COLS = [
  { key: "date", label: "Tarih" },
  { key: "doc", label: "Belge / Açıklama" },
  { key: "debit", label: "Borç", align: "right" },
  { key: "credit", label: "Alacak", align: "right" },
  { key: "balance", label: "Bakiye", align: "right" },
];

const MOBILE_SORTS = [
  ["date:asc", "Tarih · Eski→Yeni"],
  ["date:desc", "Tarih · Yeni→Eski"],
  ["doc:asc", "Belge · A→Z"],
  ["doc:desc", "Belge · Z→A"],
  ["debit:asc", "Borç · Artan"],
  ["debit:desc", "Borç · Azalan"],
  ["credit:asc", "Alacak · Artan"],
  ["credit:desc", "Alacak · Azalan"],
  ["balance:asc", "Bakiye · Artan"],
  ["balance:desc", "Bakiye · Azalan"],
];

export function StatementViewProvider({ children }) {
  const [view, setViewState] = useState(null);
  const setView = useCallback((next) => {
    setViewState((prev) => {
      if (prev && next && prev.rows === next.rows && prev.totals === next.totals) return prev;
      return next;
    });
  }, []);
  const value = useMemo(() => ({ view, setView }), [view, setView]);
  return <StatementViewContext.Provider value={value}>{children}</StatementViewContext.Provider>;
}

export function useStatementView() {
  return useContext(StatementViewContext)?.view || null;
}

function useStatementViewPublish() {
  return useContext(StatementViewContext)?.setView || null;
}

export function StatementGibBadge({ row, testId, className = "" }) {
  const state = statementGibState(row);
  if (!state) return null;
  const described = state.eLabel ? `${state.label} ${state.eLabel}` : state.label;
  return (
    <span
      data-testid={testId}
      data-gib={state.key}
      data-e-type={state.eType || ""}
      title={state.eLabel || state.label}
      aria-label={described}
      className={`inline-flex items-center px-1.5 py-0.5 rounded text-[9px] font-bold align-middle whitespace-nowrap ${state.className} ${className}`}
    >
      {state.label}
    </span>
  );
}

function statementBadge(row) {
  if (row.kind === "payment") return { label: "Alacak", kind: "alacak" };
  if (row.kind === "cheque") return { label: row.credit ? "Alacak" : "Borç", kind: row.credit ? "alacak" : "borc" };
  if (row.credit && !row.debit) return { label: "Alacak", kind: "alacak" };
  if (row.debit) return { label: "Borç", kind: "borc" };
  return { label: "Hareket", kind: "other" };
}

function statementAmount(row, money) {
  if (row.debit) return { text: `-${money(row.debit)}`, cls: "text-rose-700" };
  if (row.credit) return { text: `+${money(row.credit)}`, cls: "text-emerald-700" };
  return { text: money(0), cls: "text-slate-700" };
}

function controlCls(active) {
  return `px-2 py-1 rounded-lg border text-[11px] font-semibold ${active ? "bg-slate-900 text-white border-slate-900" : "bg-white text-slate-600 border-slate-200"}`;
}

export function StatementTxList({
  rows = [],
  currency = "TRY",
  tableTestId = "detail-statement-table",
  cardsTestId,
  rowTestId,
  showKindDot = false,
  emptyLabel = "Hareket yok.",
  emptyAmount = "—",
  cellPad = "py-1.5 px-2",
  controls = true,
  onViewChange,
}) {
  const money = (n) => fmtMoney(n, currency);
  const cardsId = cardsTestId || `${tableTestId}-cards`;
  const [filters, setFilters] = useState(EMPTY_FILTERS);
  const [sort, setSort] = useState({ key: "date", dir: "asc" });
  const publish = useStatementViewPublish();
  const onViewChangeRef = useRef(onViewChange);
  onViewChangeRef.current = onViewChange;

  const showControls = controls && rows.length > 0;
  const typeOptions = useMemo(() => statementDocTypeOptions(rows), [rows]);
  const activeFilters = useMemo(() => (
    filters.docType && !typeOptions.includes(filters.docType) ? { ...filters, docType: "" } : filters
  ), [filters, typeOptions]);
  const viewRows = useMemo(
    () => (showControls ? statementView(rows, activeFilters, sort) : rows),
    [showControls, rows, activeFilters, sort],
  );
  const totals = useMemo(() => statementTotals(viewRows), [viewRows]);
  const filtering = showControls && statementFiltersActive(activeFilters);

  useEffect(() => {
    onViewChangeRef.current?.(viewRows, totals);
    publish?.({ rows: viewRows, totals });
  }, [viewRows, totals, publish]);

  const toggleSort = (key) => {
    setSort((prev) => (prev.key === key ? { key, dir: prev.dir === "asc" ? "desc" : "asc" } : { key, dir: "asc" }));
  };
  const toggleDateOrder = () => {
    setSort((prev) => ({ key: "date", dir: prev.key === "date" && prev.dir === "asc" ? "desc" : "asc" }));
  };

  const emptyText = filtering ? "Eşleşen hareket yok." : emptyLabel;
  const dateDesc = sort.key === "date" && sort.dir === "desc";

  const cards = viewRows.length === 0 ? (
    <div className="text-center text-slate-400 py-6 text-xs">{emptyText}</div>
  ) : (
    viewRows.map((r, idx) => {
      const b = statementBadge(r);
      const amt = statementAmount(r, money);
      const id = rowTestId ? rowTestId(r, idx) : undefined;
      return (
        <TxMobileCard
          key={id || `${r.kind}-${idx}`}
          testId={id ? `${id}-card` : `${tableTestId}-card-${idx}`}
          date={fmtDate(r.date)}
          badge={<TxTypeBadge label={b.label} kind={b.kind} />}
          amount={amt.text}
          amountClassName={amt.cls}
          description={r.doc}
          extra={
            <div className="flex items-center justify-between gap-2">
              <StatementGibBadge row={r} testId={id ? `${id}-gib` : `${tableTestId}-card-gib-${idx}`} />
              <div className={`text-[11px] font-bold ${Number(r.balance) > 0 ? "text-rose-700" : "text-emerald-700"}`}>
                Bakiye: {money(r.balance)}
              </div>
            </div>
          }
        />
      );
    })
  );

  const table = (
    <table className={`w-full text-left ${TX_WRAP_CLASS}`} data-testid={tableTestId}>
      <thead className="bg-slate-50 border-b text-slate-500 uppercase font-semibold text-[10px]">
        <tr>
          {showControls ? SORT_COLS.map((col) => {
            const active = sort.key === col.key;
            const aria = active ? (sort.dir === "asc" ? "ascending" : "descending") : "none";
            return (
              <th key={col.key} className="py-2 px-2" aria-sort={aria}>
                <button
                  type="button"
                  onClick={() => toggleSort(col.key)}
                  className={`inline-flex items-center gap-1 w-full uppercase hover:text-slate-900 ${col.align === "right" ? "justify-end" : "justify-start"} ${active ? "text-indigo-700" : ""}`}
                  data-testid={`${tableTestId}-sort-${col.key}`}
                  data-sort-dir={active ? sort.dir : undefined}
                >
                  {col.label}
                  {active ? (sort.dir === "asc" ? <ArrowUp className="w-3 h-3" aria-hidden="true" /> : <ArrowDown className="w-3 h-3" aria-hidden="true" />) : null}
                </button>
              </th>
            );
          }) : (
            <>
              <th className="py-2 px-2">Tarih</th>
              <th className="py-2 px-2">Belge / Açıklama</th>
              <th className="py-2 px-2 text-right">Borç</th>
              <th className="py-2 px-2 text-right">Alacak</th>
              <th className="py-2 px-2 text-right">Bakiye</th>
            </>
          )}
        </tr>
      </thead>
      <tbody className="divide-y divide-slate-100">
        {viewRows.length === 0 && <tr><td colSpan={5} className="py-6 text-center text-slate-400">{emptyText}</td></tr>}
        {viewRows.map((r, idx) => (
          <tr
            key={`${r.kind}-${idx}`}
            className={r.kind === "payment" ? "bg-emerald-50/40" : r.kind === "cheque" ? "bg-indigo-50/40" : ""}
            data-testid={rowTestId ? rowTestId(r, idx) : undefined}
          >
            <td className={`${cellPad} font-mono text-slate-500`}>{fmtDate(r.date)}</td>
            <td className={`${cellPad} font-semibold text-slate-800 ${TX_WRAP_CLASS}`}>
              {showKindDot ? (
                <span className={`inline-block w-1.5 h-1.5 rounded-full mr-1.5 ${r.kind === "payment" ? "bg-emerald-500" : "bg-rose-500"}`} />
              ) : null}
              {r.doc}
              <StatementGibBadge row={r} testId={`${tableTestId}-gib-${idx}`} className="ml-1.5" />
            </td>
            <td className={`${cellPad} text-right text-rose-700`}>{r.debit ? money(r.debit) : emptyAmount}</td>
            <td className={`${cellPad} text-right text-emerald-700`}>{r.credit ? money(r.credit) : emptyAmount}</td>
            <td className={`${cellPad} text-right font-bold ${r.balance > 0 ? "text-rose-700" : "text-emerald-700"}`}>{money(r.balance)}</td>
          </tr>
        ))}
      </tbody>
    </table>
  );

  return (
    <div>
      {showControls && (
        <div className="flex flex-wrap items-end gap-2 px-2 py-2 border-b bg-white" data-testid={`${tableTestId}-filters`}>
          <button
            type="button"
            onClick={toggleDateOrder}
            className={controlCls(sort.key === "date")}
            data-testid={`${tableTestId}-order-toggle`}
            aria-pressed={sort.key === "date"}
          >
            {dateDesc ? "Yeni→Eski" : "Eski→Yeni"}
          </button>
          <label className="md:hidden flex flex-col gap-0.5 text-[10px] font-semibold text-slate-500">
            Sıra
            <select
              className="border border-slate-200 rounded-lg px-2 py-1 text-[11px] font-medium text-slate-800 bg-white"
              data-testid={`${tableTestId}-sort-mobile`}
              aria-label="Sıralama"
              value={`${sort.key}:${sort.dir}`}
              onChange={(e) => {
                const [key, dir] = e.target.value.split(":");
                setSort({ key, dir: dir === "desc" ? "desc" : "asc" });
              }}
            >
              {MOBILE_SORTS.map(([value, label]) => <option key={value} value={value}>{label}</option>)}
            </select>
          </label>
          <label className="flex flex-col gap-0.5 text-[10px] font-semibold text-slate-500">
            Başlangıç
            <input
              type="date"
              value={activeFilters.from}
              onChange={(e) => setFilters((prev) => ({ ...prev, from: e.target.value }))}
              className="border border-slate-200 rounded-lg px-2 py-1 text-[11px] font-medium text-slate-800 bg-white"
              data-testid={`${tableTestId}-filter-from`}
              aria-label="Başlangıç tarihi"
            />
          </label>
          <label className="flex flex-col gap-0.5 text-[10px] font-semibold text-slate-500">
            Bitiş
            <input
              type="date"
              value={activeFilters.to}
              onChange={(e) => setFilters((prev) => ({ ...prev, to: e.target.value }))}
              className="border border-slate-200 rounded-lg px-2 py-1 text-[11px] font-medium text-slate-800 bg-white"
              data-testid={`${tableTestId}-filter-to`}
              aria-label="Bitiş tarihi"
            />
          </label>
          {typeOptions.length > 1 && (
            <label className="flex flex-col gap-0.5 text-[10px] font-semibold text-slate-500">
              Belge türü
              <select
                value={activeFilters.docType}
                onChange={(e) => setFilters((prev) => ({ ...prev, docType: e.target.value }))}
                className="border border-slate-200 rounded-lg px-2 py-1 text-[11px] font-medium text-slate-800 bg-white max-w-[11rem]"
                data-testid={`${tableTestId}-filter-type`}
                aria-label="Belge türü"
              >
                <option value="">Tümü</option>
                {typeOptions.map((label) => <option key={label} value={label}>{label}</option>)}
              </select>
            </label>
          )}
          <label className="flex flex-col gap-0.5 text-[10px] font-semibold text-slate-500 min-w-[8rem] flex-1">
            Belge / açıklama
            <input
              type="text"
              value={activeFilters.q}
              onChange={(e) => setFilters((prev) => ({ ...prev, q: e.target.value }))}
              placeholder="Belge / açıklama"
              className="border border-slate-200 rounded-lg px-2 py-1 text-[11px] font-medium text-slate-800 bg-white w-full"
              data-testid={`${tableTestId}-filter-q`}
              aria-label="Belge veya açıklama ara"
            />
          </label>
          <div className="flex flex-wrap gap-1" role="group" aria-label="Borç / alacak" data-testid={`${tableTestId}-filter-side`}>
            {[["all", "Tümü"], ["debit", "Yalnız Borç"], ["credit", "Yalnız Alacak"]].map(([value, label]) => (
              <button
                key={value}
                type="button"
                className={controlCls(activeFilters.side === value)}
                aria-pressed={activeFilters.side === value}
                onClick={() => setFilters((prev) => ({ ...prev, side: value }))}
                data-testid={`${tableTestId}-filter-side-${value}`}
              >
                {label}
              </button>
            ))}
          </div>
          <div className="flex flex-wrap items-center gap-1" role="group" aria-label="GİB" data-testid={`${tableTestId}-filter-gib`}>
            <span className="text-[10px] font-semibold text-slate-500">GİB:</span>
            {[["all", "Tümü"], ["sent", "Gönderildi"], ["unsent", "Gönderilmedi"]].map(([value, label]) => (
              <button
                key={value}
                type="button"
                className={controlCls(activeFilters.gib === value)}
                aria-pressed={activeFilters.gib === value}
                onClick={() => setFilters((prev) => ({ ...prev, gib: value }))}
                data-testid={`${tableTestId}-filter-gib-${value}`}
              >
                {label}
              </button>
            ))}
          </div>
          <button
            type="button"
            onClick={() => setFilters(EMPTY_FILTERS)}
            className="px-2 py-1 rounded-lg border border-slate-200 text-[11px] font-semibold text-slate-600 bg-white"
            data-testid={`${tableTestId}-filter-clear`}
          >
            Temizle
          </button>
        </div>
      )}
      <TxResponsiveList
        cards={cards}
        table={table}
        cardsTestId={cardsId}
        tableWrapTestId={`${tableTestId}-wrap`}
      />
      {showControls && (
        <div className="flex flex-wrap items-center justify-between gap-2 px-2 py-2 text-[11px] border-t bg-slate-50" data-testid={`${tableTestId}-footer`}>
          <div className="text-slate-500 font-semibold">
            {filtering ? <span data-testid={`${tableTestId}-filter-count`}>{viewRows.length} / {rows.length} satır</span> : null}
          </div>
          <div className="flex flex-wrap gap-3 font-semibold text-slate-700">
            <span>Borç <b className="text-rose-700">{money(totals.debit)}</b></span>
            <span>Alacak <b className="text-emerald-700">{money(totals.credit)}</b></span>
            <span>Filtrelenen net <b data-testid={`${tableTestId}-footer-net`}>{money(totals.net)}</b></span>
          </div>
        </div>
      )}
    </div>
  );
}
