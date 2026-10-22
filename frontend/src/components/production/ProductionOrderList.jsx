import React, { useEffect, useMemo, useState } from "react";
import axios from "axios";
import {
  AlertTriangle, CheckCircle2, Clock, Factory, Loader2, MoreHorizontal, Pencil, Play, Search, Trash2, X, XCircle,
} from "lucide-react";
import { API_URL } from "../../context/AuthContext";
import { QuantityInput } from "../MoneyInput";
import { formatTrAmount, formatTrQty } from "../../utils/money";
import { backdropDismissProps } from "../../utils/modalBackdrop";
import {
  consumedLines, costBreakdown, countProductionFilters, filterProductionOrders, formatPlanDay,
  isOpenOrder, orderLateDays, orderProgress, shortageRows, sortProductionOrders,
  sourceBadge, stepMeta, stepTone,
} from "./orderCards";

const FILTERS = [
  ["open", "Açık"],
  ["late", "Gecikenler"],
  ["completed", "Tamamlanan"],
  ["cancelled", "İptal"],
  ["all", "Tümü"],
];

const STATUS = {
  planned: { label: "Planlandı", className: "bg-slate-100 text-slate-700 border border-slate-300", Icon: Clock },
  in_production: { label: "Üretimde", className: "bg-amber-50 text-amber-800 border border-amber-200", Icon: Play },
  completed: { label: "Tamamlandı", className: "bg-emerald-50 text-emerald-700 border border-emerald-200", Icon: CheckCircle2 },
  cancelled: { label: "İptal", className: "bg-rose-50 text-rose-700 border border-rose-200", Icon: XCircle },
};

const SOURCE_TONE = {
  order: "bg-blue-50 text-blue-700 border border-blue-200",
  stock: "bg-slate-100 text-slate-600 border border-slate-200",
  pick: "bg-amber-50 text-amber-800 border border-amber-200",
  bom: "bg-rose-50 text-rose-700 border border-rose-200",
};

const STEP_BAR = {
  done: "bg-emerald-500",
  active: "bg-amber-500 ring-4 ring-amber-100",
  pending: "bg-slate-200",
};

const STEP_NAME = {
  done: "text-emerald-700",
  active: "text-amber-700 font-bold",
  pending: "text-slate-400",
};

function remainingQty(order) {
  return Number(order?.planned_quantity || 0) - Number(order?.completed_quantity || 0);
}

function shortageText(row) {
  const bits = [];
  if (row?.needed != null && row.needed !== "") bits.push(`Gerekli ${formatTrQty(row.needed)}`);
  if (row?.in_stock != null && row.in_stock !== "") bits.push(`Stok ${formatTrQty(row.in_stock)}`);
  if (row?.shortage != null && row.shortage !== "") {
    const unit = row.unit ? ` ${row.unit}` : "";
    bits.push(`Eksik ${formatTrQty(row.shortage)}${unit}`);
  }
  return bits.join(" · ");
}

function StatusBadge({ status, testId, className = "" }) {
  const meta = STATUS[status] || STATUS.planned;
  const Icon = meta.Icon;
  return (
    <span className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[11px] font-semibold whitespace-nowrap ${meta.className} ${className}`} data-testid={testId}>
      <Icon className="w-3 h-3" /> {meta.label}
    </span>
  );
}

function ShortageTable({ rows, testId }) {
  return (
    <div className="border border-amber-200 bg-amber-50 rounded-xl overflow-hidden" data-testid={testId}>
      <div className="px-3 py-2 text-[11px] font-bold uppercase tracking-wide text-amber-800">Eksik hammaddeler</div>
      <div className="divide-y divide-amber-100">
        {rows.map((row, index) => (
          <div key={`${row.product_id || row.product_name || index}`} className="px-3 py-2 flex flex-wrap items-baseline justify-between gap-2 text-xs bg-white/70" data-testid={`${testId}-row-${index}`}>
            <span className="font-semibold text-slate-800 break-words min-w-0">{row.product_name || "Hammadde"}</span>
            <span className="text-amber-800 font-semibold tabular-nums text-right">{shortageText(row)}</span>
          </div>
        ))}
      </div>
    </div>
  );
}

export function ProductionOrderList({
  orders,
  loading,
  canEdit,
  canDelete,
  completeQty,
  onCompleteQtyChange,
  produceShortagesBusy,
  onStart,
  onComplete,
  onCancel,
  onDelete,
  onProduceShortages,
  planDraft,
  onPlanDraft,
  onSavePlan,
  recipesForOrder,
  onNeedRecipes,
}) {
  const [filter, setFilter] = useState("open");
  const [query, setQuery] = useState("");
  const [sort, setSort] = useState("planned_date");
  const [menuCode, setMenuCode] = useState("");
  const [shortageCode, setShortageCode] = useState("");
  const [drawerId, setDrawerId] = useState("");
  const [editing, setEditing] = useState(false);

  const counts = useMemo(() => countProductionFilters(orders), [orders]);
  const visible = useMemo(
    () => sortProductionOrders(filterProductionOrders(orders, { filter, query }), sort),
    [orders, filter, query, sort],
  );
  const drawerOrder = (orders || []).find((order) => order.id === drawerId) || null;

  useEffect(() => {
    if (!menuCode) return undefined;
    const close = (event) => {
      if (event.target?.closest?.("[data-menu-root]")) return;
      setMenuCode("");
    };
    document.addEventListener("mousedown", close);
    return () => document.removeEventListener("mousedown", close);
  }, [menuCode]);

  useEffect(() => {
    if (drawerId && !drawerOrder) {
      setDrawerId("");
      setEditing(false);
    }
  }, [drawerId, drawerOrder]);

  const openDrawer = (order, edit) => {
    setDrawerId(order.id);
    setEditing(!!edit);
    setMenuCode("");
    if (edit && onNeedRecipes) onNeedRecipes();
  };

  return (
    <div className="space-y-3 min-w-0 max-w-full" data-testid="po-order-panel">
      <div className="flex flex-col gap-2 min-w-0 max-w-full">
        <div className="flex flex-nowrap gap-2 overflow-x-auto max-w-full min-w-0 pb-0.5" data-testid="po-filter-bar">
          {FILTERS.map(([key, label]) => {
            const on = filter === key;
            const count = counts[key];
            return (
              <button
                key={key}
                type="button"
                onClick={() => setFilter(key)}
                className={`shrink-0 inline-flex items-center gap-1.5 px-3 py-1.5 rounded-full border text-xs font-semibold ${on ? "bg-slate-900 text-white border-slate-900" : "bg-white text-slate-700 border-slate-300 hover:bg-slate-50"}`}
                data-testid={`po-filter-${key}`}
              >
                {label}
                <span
                  className={`rounded-full px-1.5 text-[11px] tabular-nums ${on ? "bg-slate-700 text-white" : key === "late" && count > 0 ? "bg-rose-100 text-rose-600" : "bg-slate-200 text-slate-700"}`}
                  data-testid={`po-filter-count-${key}`}
                >
                  {count}
                </span>
              </button>
            );
          })}
        </div>
        <div className="flex gap-2 min-w-0 max-w-full">
          <label className="relative flex-1 min-w-0">
            <Search className="w-3.5 h-3.5 text-slate-400 absolute left-3 top-1/2 -translate-y-1/2" />
            <input
              value={query}
              onChange={(event) => setQuery(event.target.value)}
              placeholder="Emir no, ürün, sipariş veya müşteri ara…"
              className="w-full min-w-0 border border-slate-300 rounded-xl pl-8 pr-3 py-2 text-xs bg-white"
              data-testid="po-search"
            />
          </label>
          <select
            value={sort}
            onChange={(event) => setSort(event.target.value)}
            className="shrink-0 max-w-[46%] border border-slate-300 bg-white rounded-xl px-2 py-2 text-xs font-semibold"
            data-testid="po-sort"
            aria-label="Sırala"
          >
            <option value="planned_date">Sırala: Plan tarihi</option>
            <option value="created_at">Sırala: En yeni</option>
            <option value="cost">Sırala: Maliyet</option>
          </select>
        </div>
      </div>

      <div className="space-y-3 min-w-0 max-w-full" data-testid="po-order-list">
        {loading && <div className="bg-white border border-slate-200 rounded-2xl px-4 py-8 text-center text-xs text-slate-400" data-testid="po-loading">Yükleniyor…</div>}
        {!loading && visible.length === 0 && (
          <div className="bg-white border border-dashed border-slate-200 rounded-2xl px-4 py-8 text-center text-xs text-slate-400" data-testid="po-empty">
            {orders?.length ? "Bu filtrede emir yok." : "Üretim emri yok."}
          </div>
        )}
        {!loading && visible.map((order) => (
          <OrderCard
            key={order.id}
            order={order}
            selected={drawerOrder?.id === order.id}
            menuOpen={menuCode === order.order_code}
            shortageOpen={shortageCode === order.order_code}
            canEdit={canEdit}
            canDelete={canDelete}
            completeQty={completeQty}
            onCompleteQtyChange={onCompleteQtyChange}
            produceShortagesBusy={produceShortagesBusy === order.id}
            onToggleMenu={() => setMenuCode((code) => (code === order.order_code ? "" : order.order_code))}
            onToggleShortage={() => setShortageCode((code) => (code === order.order_code ? "" : order.order_code))}
            onOpen={(edit) => openDrawer(order, edit)}
            onStart={() => onStart(order)}
            onComplete={() => onComplete(order)}
            onCancel={() => { setMenuCode(""); onCancel(order); }}
            onDelete={() => { setMenuCode(""); onDelete(order); }}
            onProduceShortages={() => { setMenuCode(""); onProduceShortages(order); }}
          />
        ))}
      </div>

      {drawerOrder && (
        <OrderDrawer
          order={drawerOrder}
          editing={editing}
          canEdit={canEdit}
          canDelete={canDelete}
          completeQty={completeQty}
          onCompleteQtyChange={onCompleteQtyChange}
          produceShortagesBusy={produceShortagesBusy === drawerOrder.id}
          onClose={() => { setDrawerId(""); setEditing(false); }}
          onEdit={() => { setEditing(true); if (onNeedRecipes) onNeedRecipes(); }}
          onStart={() => onStart(drawerOrder)}
          onComplete={() => onComplete(drawerOrder)}
          onCancel={() => onCancel(drawerOrder)}
          onDelete={() => onDelete(drawerOrder)}
          onProduceShortages={() => onProduceShortages(drawerOrder)}
          planDraft={planDraft}
          onPlanDraft={onPlanDraft}
          onSavePlan={onSavePlan}
          recipesForOrder={recipesForOrder}
          onNeedRecipes={onNeedRecipes}
        />
      )}
    </div>
  );
}

function OrderCard({
  order, selected, menuOpen, shortageOpen, canEdit, canDelete, completeQty, onCompleteQtyChange,
  produceShortagesBusy, onToggleMenu, onToggleShortage, onOpen, onStart, onComplete, onCancel, onDelete, onProduceShortages,
}) {
  const code = order.order_code;
  const progress = orderProgress(order);
  const late = orderLateDays(order);
  const source = sourceBadge(order);
  const shortages = shortageRows(order);
  const open = isOpenOrder(order);
  const showStart = canEdit && order.status === "planned";
  const showComplete = canEdit && order.status === "in_production";
  const showShortages = canEdit && open;
  const showEdit = canEdit && open;
  const showCancel = canEdit && open;
  const showDelete = canDelete && order.status === "planned";
  const showMenu = showShortages || showEdit || showCancel || showDelete;
  const dateValue = order.planned_date || order.start_date;
  const dateLabel = order.planned_date ? "Plan tarihi" : "Tarih";

  return (
    <article
      className={`bg-white border rounded-2xl p-4 min-w-0 max-w-full ${selected ? "border-emerald-500 shadow-md ring-1 ring-emerald-200" : "border-slate-200"} ${menuOpen ? "relative z-20" : ""}`}
      data-testid={`po-card-${code}`}
    >
      <div className="grid grid-cols-1 lg:grid-cols-[minmax(0,240px)_minmax(0,1fr)_150px_120px_minmax(168px,220px)] gap-3 lg:gap-4 lg:items-center min-w-0">
        <div className="min-w-0">
          <div className="flex items-center justify-between gap-2 min-w-0">
            <button type="button" onClick={() => onOpen(false)} className="font-mono font-bold text-[13px] text-slate-900 text-left truncate" data-testid={`po-open-${code}`}>{code}</button>
            <StatusBadge status={order.status} testId={`po-status-${code}`} className="lg:hidden shrink-0" />
          </div>
          <div className="font-bold text-slate-900 text-base leading-snug mt-1 break-words">{order.finished_product_name}</div>
          {order.recipe_name ? <div className="text-[11px] text-slate-400 truncate">{order.recipe_name}</div> : null}
          <div className="flex flex-wrap gap-1.5 mt-1.5">
            {source ? (
              <span className={`inline-flex items-center max-w-full truncate rounded-full px-2 py-0.5 text-[11px] font-semibold ${SOURCE_TONE[source.tone] || SOURCE_TONE.stock}`} title={source.label} data-testid={`po-source-${code}`}>
                {source.label}
              </span>
            ) : null}
            {shortages.length > 0 && (
              <button
                type="button"
                onClick={onToggleShortage}
                className="inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[11px] font-semibold bg-amber-50 text-amber-800 border border-amber-300"
                data-testid={`po-shortage-${code}`}
              >
                <AlertTriangle className="w-3 h-3" /> {shortages.length} hammadde eksik
              </button>
            )}
          </div>
          {order.notes ? <div className="text-[11px] text-slate-400 truncate mt-1" title={order.notes}>{order.notes}</div> : null}
        </div>

        <div className="min-w-0" data-testid={`po-progress-${code}`}>
          {progress.total > 0 ? (
            <>
              <div className="flex items-baseline justify-between gap-2 text-xs min-w-0">
                <span className="min-w-0 truncate">
                  Adım <b>{progress.currentNo}/{progress.total}</b>
                  {order.status === "planned" ? <span className="text-slate-400"> · başlamadı</span> : null}
                  {progress.active?.name ? <b className="text-amber-700"> · {progress.active.name}</b> : null}
                </span>
                <span className="text-slate-400 shrink-0 tabular-nums">%{progress.pct}</span>
              </div>
              <div className="flex gap-1 mt-1.5" data-testid={`po-steps-${code}`}>
                {progress.steps.map((step) => {
                  const tone = stepTone(step, order);
                  return <span key={`${step.no}-${step.name}`} className={`flex-1 h-2 rounded-full ${STEP_BAR[tone]}`} data-testid={`po-step-bar-${code}-${step.no}`} />;
                })}
              </div>
              <div className="flex gap-1 mt-1 text-[11px] min-w-0">
                {progress.steps.map((step) => {
                  const tone = stepTone(step, order);
                  return (
                    <span key={`${step.no}-${step.name}`} className={`flex-1 min-w-0 truncate ${STEP_NAME[tone]}`} data-testid={`po-step-${code}-${step.no}`}>
                      {tone === "done" ? "✓ " : tone === "active" ? "● " : ""}{step.name}
                    </span>
                  );
                })}
              </div>
            </>
          ) : null}
          <div className="flex items-baseline justify-between gap-2 mt-2 text-xs">
            <span className="text-slate-400">Plan / Üretilen</span>
            <span className="tabular-nums font-semibold text-slate-800" data-testid={`po-plan-cell-${code}`}>
              {order.planned_quantity} / <span className="text-emerald-700">{order.completed_quantity || 0}</span>
            </span>
          </div>
          {order.over_produced ? <div className="text-[10px] font-semibold text-amber-700 text-right">Plan üstü üretim</div> : null}
        </div>

        <div className="min-w-0">
          <div className="text-[11px] text-slate-400">{dateLabel}</div>
          <div className={`tabular-nums font-semibold ${late ? "text-rose-600" : "text-slate-800"}`}>{dateValue ? formatPlanDay(dateValue) : "—"}</div>
          {late > 0 && (
            <span className="inline-flex items-center mt-1 rounded-full px-2 py-0.5 text-[11px] font-semibold bg-rose-50 text-rose-600 border border-rose-200" data-testid={`po-late-${code}`}>
              {late} gün gecikti
            </span>
          )}
          {order.end_date ? <div className="text-[10px] text-emerald-600 mt-1">Bitti: {formatPlanDay(order.end_date)}</div> : null}
        </div>

        <div className="min-w-0">
          <div className="text-[11px] text-slate-400">Maliyet</div>
          <div className="text-base font-bold tabular-nums text-slate-900">{formatTrAmount(order.total_cost)} ₺</div>
          <StatusBadge status={order.status} className="hidden lg:inline-flex mt-1" />
        </div>

        <div className="flex items-center gap-2 min-w-0 justify-stretch lg:justify-end" data-testid={`po-actions-${code}`}>
          {showComplete && (
            <QuantityInput
              value={completeQty[order.id] ?? remainingQty(order)}
              onChange={(value) => onCompleteQtyChange(order.id, value)}
              className="w-14 shrink-0 bg-slate-50 border border-slate-300 rounded-xl p-2 text-center font-semibold"
              title="Tamamlanan miktar (plan üstü girilebilir)"
              data-testid={`po-complete-qty-${code}`}
            />
          )}
          {showStart && (
            <button type="button" onClick={onStart} className="inline-flex flex-1 lg:flex-none items-center justify-center gap-1 w-full lg:w-auto px-3 py-2 bg-amber-500 text-white rounded-xl text-xs font-semibold hover:bg-amber-600" data-testid={`po-start-${code}`}>
              <Play className="w-3.5 h-3.5" /> Başlat
            </button>
          )}
          {showComplete && (
            <button type="button" onClick={onComplete} className="inline-flex flex-1 lg:flex-none items-center justify-center gap-1 w-full lg:w-auto px-3 py-2 bg-emerald-600 text-white rounded-xl text-xs font-semibold hover:bg-emerald-700" data-testid={`po-complete-${code}`}>
              <CheckCircle2 className="w-3.5 h-3.5" /> Tamamla
            </button>
          )}
          {showMenu && (
            <div className="relative shrink-0" data-menu-root>
              <button type="button" onClick={onToggleMenu} className="w-9 h-9 border border-slate-300 rounded-xl bg-white font-bold text-slate-600" aria-label="Diğer işlemler" aria-expanded={menuOpen} data-testid={`po-menu-${code}`}>
                <MoreHorizontal className="w-4 h-4 mx-auto" />
              </button>
              {menuOpen && (
                <div className="absolute right-0 top-10 z-30 w-[230px] max-w-[calc(100vw-2rem)] bg-white border border-slate-200 rounded-xl shadow-lg p-1.5 text-left" data-testid={`po-menu-panel-${code}`}>
                  <button type="button" onClick={() => onOpen(false)} className="block w-full text-left px-2.5 py-2 rounded-lg text-xs font-medium hover:bg-slate-100">Detayı aç</button>
                  {showShortages && (
                    <button type="button" disabled={produceShortagesBusy} onClick={onProduceShortages} className="flex w-full items-center gap-1.5 text-left px-2.5 py-2 rounded-lg text-xs font-medium hover:bg-slate-100 disabled:opacity-50" data-testid={`po-produce-shortages-${code}`}>
                      {produceShortagesBusy ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Factory className="w-3.5 h-3.5" />}
                      Eksik ürünleri üretime al
                    </button>
                  )}
                  {showEdit && (
                    <button type="button" onClick={() => onOpen(true)} className="flex w-full items-center gap-1.5 text-left px-2.5 py-2 rounded-lg text-xs font-medium hover:bg-slate-100" data-testid={`po-edit-${code}`}>
                      <Pencil className="w-3.5 h-3.5" /> Düzenle
                    </button>
                  )}
                  {(showCancel || showDelete) && <div className="my-1 border-t border-slate-100" />}
                  {showCancel && (
                    <button type="button" onClick={onCancel} className="flex w-full items-center gap-1.5 text-left px-2.5 py-2 rounded-lg text-xs font-medium text-rose-600 hover:bg-rose-50" data-testid={`po-cancel-${code}`}>
                      <XCircle className="w-3.5 h-3.5" /> İptal et
                    </button>
                  )}
                  {showDelete && (
                    <button type="button" onClick={onDelete} className="flex w-full items-center gap-1.5 text-left px-2.5 py-2 rounded-lg text-xs font-medium text-rose-600 hover:bg-rose-50" data-testid={`po-delete-${code}`}>
                      <Trash2 className="w-3.5 h-3.5" /> Sil
                    </button>
                  )}
                </div>
              )}
            </div>
          )}
        </div>
      </div>
      {shortageOpen && shortages.length > 0 && (
        <div className="mt-3">
          <ShortageTable rows={shortages} testId={`po-shortage-panel-${code}`} />
        </div>
      )}
    </article>
  );
}

function OrderDrawer({
  order, editing, canEdit, canDelete, completeQty, onCompleteQtyChange, produceShortagesBusy, onClose, onEdit,
  onStart, onComplete, onCancel, onDelete, onProduceShortages, planDraft, onPlanDraft, onSavePlan, recipesForOrder, onNeedRecipes,
}) {
  const code = order.order_code;
  const progress = orderProgress(order);
  const late = orderLateDays(order);
  const source = sourceBadge(order);
  const shortages = shortageRows(order);
  const consumed = consumedLines(order);
  const [recipe, setRecipe] = useState(null);
  const draft = planDraft(order);
  const canEditPlan = isOpenOrder(order);
  const recipeLocked = Number(order.completed_quantity) > 0;
  const dirty = canEditPlan && (Number(draft.qty) !== Number(order.planned_quantity) || String(draft.recipe_id || "") !== String(order.recipe_id || ""));
  const lines = costBreakdown(order, recipe);
  const open = isOpenOrder(order);

  useEffect(() => {
    const id = order.recipe_id;
    if (!id) {
      setRecipe(null);
      return undefined;
    }
    let alive = true;
    axios.get(`${API_URL}/production/recipes/${id}`).then((res) => {
      if (alive) setRecipe(res.data || null);
    }).catch(() => {
      if (alive) setRecipe(null);
    });
    return () => { alive = false; };
  }, [order.recipe_id, order.id]);

  useEffect(() => {
    const onKey = (event) => { if (event.key === "Escape") onClose(); };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [onClose]);

  return (
    <div className="fixed inset-0 z-[65]" data-testid="po-drawer-root">
      <div className="absolute inset-0 bg-slate-900/40" {...backdropDismissProps(onClose)} data-testid="po-drawer-backdrop" />
      <aside className="absolute top-0 right-0 h-full w-full max-w-[520px] bg-white shadow-2xl overflow-y-auto p-5 flex flex-col gap-4 min-w-0" data-testid="po-drawer" aria-label="Üretim emri detayı">
        <div className="flex items-start justify-between gap-3">
          <div className="min-w-0">
            <div className="font-mono font-bold text-sm">{code}</div>
            <div className="font-bold text-xl text-slate-900 break-words mt-0.5">{order.finished_product_name}</div>
            <div className="flex flex-wrap gap-1.5 mt-2">
              <StatusBadge status={order.status} />
              {late > 0 && <span className="inline-flex items-center rounded-full px-2 py-0.5 text-[11px] font-semibold bg-rose-50 text-rose-600 border border-rose-200">{late} gün gecikti</span>}
              {source ? <span className={`inline-flex max-w-full truncate rounded-full px-2 py-0.5 text-[11px] font-semibold ${SOURCE_TONE[source.tone] || SOURCE_TONE.stock}`}>{source.label}</span> : null}
            </div>
          </div>
          <button type="button" onClick={onClose} className="w-9 h-9 border border-slate-300 rounded-xl text-slate-500 shrink-0" aria-label="Kapat" data-testid="po-drawer-close"><X className="w-4 h-4 mx-auto" /></button>
        </div>

        <section className="border border-slate-200 rounded-2xl p-3" data-testid={`po-drawer-progress-${code}`}>
          <div className="flex justify-between gap-2 text-xs">
            <span>İlerleme <b>%{progress.pct}</b>{progress.total ? ` · Adım ${progress.currentNo}/${progress.total}` : ""}</span>
            <span className="tabular-nums">Plan {order.planned_quantity} · Üretilen <b>{order.completed_quantity || 0}</b></span>
          </div>
          {progress.total > 0 && (
            <div className="flex gap-1 mt-2">
              {progress.steps.map((step) => <span key={`${step.no}-${step.name}`} className={`flex-1 h-2 rounded-full ${STEP_BAR[stepTone(step, order)]}`} />)}
            </div>
          )}
        </section>

        {progress.steps.length > 0 && (
          <section className="border border-slate-200 rounded-2xl p-3" data-testid={`po-drawer-steps-${code}`}>
            <h3 className="text-[11px] font-bold uppercase tracking-wide text-slate-400 mb-2">Adımlar</h3>
            <ol className="space-y-3">
              {progress.steps.map((step) => {
                const tone = stepTone(step, order);
                const meta = stepMeta(step);
                const waiting = !meta && tone === "pending";
                return (
                  <li key={`${step.no}-${step.name}`} className="grid grid-cols-[20px_minmax(0,1fr)] gap-2" data-testid={`po-drawer-step-${code}-${step.no}`}>
                    <span className={`w-5 h-5 rounded-full text-[10px] font-bold text-white grid place-items-center ${tone === "done" ? "bg-emerald-500" : tone === "active" ? "bg-amber-500" : "bg-slate-300"}`}>
                      {tone === "done" ? "✓" : step.no}
                    </span>
                    <div className="min-w-0">
                      <div className={`text-sm font-semibold break-words ${tone === "active" ? "text-amber-800" : tone === "pending" ? "text-slate-500" : "text-slate-900"}`}>
                        {step.no}. {step.name}{tone === "active" ? " — çalışıyor" : ""}
                      </div>
                      {meta ? <div className="text-[11px] text-slate-500 break-words">{meta}</div> : null}
                      {waiting ? <div className="text-[11px] text-slate-400">Bekliyor</div> : null}
                      {tone === "active" && !meta ? <div className="text-[11px] text-slate-500">Çalışıyor</div> : null}
                    </div>
                  </li>
                );
              })}
            </ol>
          </section>
        )}

        {shortages.length > 0 && (
          <div className="space-y-2">
            <ShortageTable rows={shortages} testId={`po-drawer-shortages-${code}`} />
            {canEdit && open && (
              <button type="button" disabled={produceShortagesBusy} onClick={onProduceShortages} className="inline-flex items-center gap-1 px-3 py-1.5 bg-amber-500 text-white rounded-xl text-[11px] font-semibold disabled:opacity-50" data-testid={`po-drawer-produce-${code}`}>
                {produceShortagesBusy ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Factory className="w-3.5 h-3.5" />}
                Eksik ürünleri üretime al
              </button>
            )}
          </div>
        )}

        {consumed.length > 0 && (
          <section className="border border-slate-200 rounded-2xl p-3" data-testid={`po-drawer-consumed-${code}`}>
            <h3 className="text-[11px] font-bold uppercase tracking-wide text-slate-400 mb-2">Tüketilen malzemeler</h3>
            <div className="divide-y divide-slate-100 text-xs">
              {consumed.map((row, index) => (
                <div key={`${row.name}-${index}`} className="flex justify-between gap-3 py-1.5">
                  <span className="break-words min-w-0">{row.name}</span>
                  <span className="tabular-nums font-semibold shrink-0">{row.qty != null && row.qty !== "" ? formatTrQty(row.qty) : "—"}{row.unit ? ` ${row.unit}` : ""}</span>
                </div>
              ))}
            </div>
          </section>
        )}

        <section className="border border-slate-200 rounded-2xl p-3" data-testid={`po-drawer-cost-${code}`}>
          <h3 className="text-[11px] font-bold uppercase tracking-wide text-slate-400 mb-2">Maliyet</h3>
          <div className="divide-y divide-slate-100 text-xs">
            {lines.map((line) => (
              <div key={line.label} className="flex justify-between gap-3 py-1.5" data-testid={`po-cost-line-${line.label}`}>
                <span>{line.label}</span>
                <span className="tabular-nums font-semibold">{formatTrAmount(line.amount)} ₺</span>
              </div>
            ))}
            <div className="flex justify-between gap-3 py-1.5">
              <span className="font-bold">Toplam</span>
              <span className="tabular-nums font-bold">{formatTrAmount(order.total_cost)} ₺</span>
            </div>
          </div>
        </section>

        {order.notes ? <p className="text-xs text-slate-500 break-words">{order.notes}</p> : null}
        {order.project_number ? <p className="text-xs text-slate-500">Proje {order.project_number}</p> : null}

        {editing && canEdit && canEditPlan && (
          <section className="border border-indigo-200 bg-indigo-50/40 rounded-2xl p-3 space-y-2" data-testid={`po-drawer-edit-${code}`}>
            <h3 className="text-[11px] font-bold uppercase tracking-wide text-indigo-700">Planı düzenle</h3>
            <label className="block text-[11px] text-slate-500">
              Plan miktarı
              <QuantityInput
                value={draft.qty}
                onChange={(value) => onPlanDraft(order, { qty: value ?? "" })}
                className="mt-1 w-full bg-white border border-slate-300 rounded-xl p-2 text-sm font-semibold"
                data-testid={`po-plan-qty-${code}`}
              />
            </label>
            {!recipeLocked && (
              <label className="block text-[11px] text-slate-500">
                Reçete
                <select
                  value={draft.recipe_id || ""}
                  onChange={(event) => onPlanDraft(order, { recipe_id: event.target.value })}
                  onFocus={() => { if (onNeedRecipes) onNeedRecipes(); }}
                  className="mt-1 w-full bg-white border border-slate-300 rounded-xl px-2 py-2 text-xs"
                  data-testid={`po-recipe-${code}`}
                >
                  {!draft.recipe_id && <option value="">Reçete seç…</option>}
                  {(recipesForOrder(order) || []).map((item) => (
                    <option key={item.id} value={item.id}>
                      {item.name}{item.finished_product_id !== order.finished_product_id ? ` · ${item.finished_product_name}` : ""}
                    </option>
                  ))}
                </select>
              </label>
            )}
            {dirty && (
              <button
                type="button"
                onClick={() => onSavePlan(order, { planned_quantity: Number(draft.qty), recipe_id: draft.recipe_id || undefined })}
                className="px-3 py-1.5 bg-indigo-600 text-white rounded-xl text-xs font-semibold"
                data-testid={`po-plan-save-${code}`}
              >
                Kaydet
              </button>
            )}
          </section>
        )}

        <div className="mt-auto flex flex-wrap items-center justify-end gap-2 pt-2">
          {canEdit && open && !editing && (
            <button type="button" onClick={onEdit} className="mr-auto inline-flex items-center gap-1 px-3 py-2 border border-slate-300 rounded-xl text-xs font-semibold" data-testid={`po-drawer-edit-btn-${code}`}>
              <Pencil className="w-3.5 h-3.5" /> Düzenle
            </button>
          )}
          {canEdit && open && (
            <button type="button" onClick={onCancel} className="inline-flex items-center gap-1 px-3 py-2 text-rose-600 border border-rose-200 rounded-xl text-xs font-semibold">
              <XCircle className="w-3.5 h-3.5" /> İptal et
            </button>
          )}
          {canDelete && order.status === "planned" && (
            <button type="button" onClick={onDelete} className="inline-flex items-center gap-1 px-3 py-2 text-rose-600 border border-rose-200 rounded-xl text-xs font-semibold">
              <Trash2 className="w-3.5 h-3.5" /> Sil
            </button>
          )}
          {canEdit && order.status === "planned" && (
            <button type="button" onClick={onStart} className="inline-flex items-center justify-center gap-1 px-3 py-2 bg-amber-500 text-white rounded-xl text-xs font-semibold">
              <Play className="w-3.5 h-3.5" /> Başlat
            </button>
          )}
          {canEdit && order.status === "in_production" && (
            <>
              <QuantityInput
                value={completeQty[order.id] ?? remainingQty(order)}
                onChange={(value) => onCompleteQtyChange(order.id, value)}
                className="w-16 bg-slate-50 border border-slate-300 rounded-xl p-2 text-center font-semibold"
                data-testid={`po-drawer-complete-qty-${code}`}
              />
              <button type="button" onClick={onComplete} className="inline-flex items-center justify-center gap-1 px-3 py-2 bg-emerald-600 text-white rounded-xl text-xs font-semibold">
                <CheckCircle2 className="w-3.5 h-3.5" /> Tamamla
              </button>
            </>
          )}
        </div>
      </aside>
    </div>
  );
}
