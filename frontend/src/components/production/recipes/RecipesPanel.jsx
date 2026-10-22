import React, { useMemo, useState } from "react";
import {
  Archive,
  Copy,
  Factory,
  LayoutGrid,
  List,
  Pencil,
  Search,
  Trash2,
  User,
  X,
} from "lucide-react";
import { formatTrQty } from "../../../utils/money";
import { fmtDmy } from "../../../utils/dateFormat";
import { backdropDismissProps } from "../../../utils/modalBackdrop";
import { useEscape } from "../../../utils/useEscape";
import {
  RECIPE_FILTERS,
  applyRecipeQuery,
  costBreakdown,
  filterCounts,
  findProduct,
  formatDuration,
  formatMoney,
  groupByFinishedProduct,
  isOneTime,
  marginLabel,
  marginPct,
  materialStockState,
  materialUnitNet,
  producibleQty,
  recipeIdentity,
  recipeSteps,
  recentProductions,
  salePriceOf,
  shortageCount,
  stockStatusLabel,
  unitCostOf,
  variantChipLabel,
} from "./recipeViewModel";

const ORDER_STATUS = {
  planned: ["Planlandı", "bg-slate-100 text-slate-700 border border-slate-300"],
  in_production: ["Üretimde", "bg-amber-50 text-amber-800 border border-amber-200"],
  completed: ["Tamamlandı", "bg-emerald-50 text-emerald-700 border border-emerald-200"],
  cancelled: ["İptal", "bg-rose-50 text-rose-700 border border-rose-200"],
};

function moneyClass(pct) {
  if (pct == null || !Number.isFinite(pct)) return "text-slate-400";
  if (pct < 0) return "text-rose-600";
  return "text-emerald-600";
}

function StockMark({ state }) {
  if (!state || state.status === "unknown") return <span className="w-3.5" />;
  const tone = state.status === "ok" ? "bg-emerald-500" : state.status === "low" ? "bg-amber-500" : "bg-rose-500";
  const glyph = state.status === "ok" ? "✓" : state.status === "low" ? "!" : "✕";
  return (
    <span className={`inline-grid place-items-center w-3.5 h-3.5 rounded-full text-white text-[9px] font-black leading-none ${tone}`} aria-hidden>
      {glyph}
    </span>
  );
}

function stockLabelClass(state) {
  if (!state) return "text-slate-400";
  if (state.status === "none") return "text-rose-600 font-bold";
  if (state.status === "low") return "text-amber-700";
  if (state.status === "ok") return "text-emerald-700";
  return "text-slate-400";
}

function RecipeCard({
  recipe,
  products,
  layout,
  selected,
  canEdit,
  canDelete,
  menuOpen,
  onOpen,
  onToggleMenu,
  onProduce,
  onCopy,
  onEdit,
  onDelete,
  onArchive,
}) {
  const code = recipe.code || recipeIdentity(recipe);
  const steps = recipeSteps(recipe);
  const sale = salePriceOf(recipe, products);
  const cost = unitCostOf(recipe);
  const pct = marginPct(recipe, products);
  const margin = marginLabel(recipe, products);
  const made = producibleQty(recipe, products);
  const missingN = shortageCount(recipe, products);
  const materials = recipe.materials || [];
  const shown = materials.slice(0, 3);
  const title = recipe.name || recipe.finished_product_name || "Reçete";
  const qty = `${formatTrQty(recipe.target_quantity ?? 1)}${recipe.unit ? ` ${recipe.unit}` : ""}`;
  const producibleText = made == null ? "—" : `${formatTrQty(made)} adet`;
  const producibleClass = made === 0 ? "text-rose-600" : made == null ? "text-slate-400" : "text-emerald-700";
  const showMenu = canEdit || canDelete;

  return (
    <article
      data-testid={`recipe-card-${code}`}
      data-selected={selected ? "true" : "false"}
      onClick={() => onOpen(recipe)}
      className={`bg-white border rounded-2xl p-4 flex flex-col gap-2.5 min-w-0 max-w-full cursor-pointer ${selected ? "border-emerald-500 border-2" : "border-slate-200"} ${layout === "list" ? "sm:flex-row sm:items-stretch sm:gap-4" : ""}`}
    >
      <div className="min-w-0 flex-1 space-y-2">
        <div className="flex items-start justify-between gap-2 min-w-0">
          <div className="min-w-0">
            <h3 className="text-base font-bold text-slate-900 leading-snug break-words">{title}</h3>
            <p className="font-mono text-[11px] text-slate-400 break-all">
              {recipe.code ? `${recipe.code} · ` : ""}
              {recipe.finished_product_name || "—"} × {qty}
            </p>
          </div>
          <div className="flex shrink-0 gap-1">
            <span
              data-testid={`recipe-type-${code}`}
              className={`inline-flex items-center rounded-full px-2 py-0.5 text-[11px] font-semibold border ${isOneTime(recipe) ? "bg-amber-50 text-amber-800 border-amber-200" : "bg-emerald-50 text-emerald-800 border-emerald-200"}`}
            >
              {isOneTime(recipe) ? "Tek seferlik" : "Standart"}
            </span>
            {recipe.version != null && recipe.version !== "" ? (
              <span className="inline-flex items-center rounded-full px-2 py-0.5 text-[11px] font-semibold border bg-violet-50 text-violet-800 border-violet-200">v{recipe.version}</span>
            ) : null}
          </div>
        </div>
        <div className="flex flex-wrap gap-1.5 min-w-0">
          <span className="inline-flex max-w-full items-center rounded-full bg-slate-100 text-slate-600 px-2 py-0.5 text-[11px] font-semibold" data-testid={`recipe-steps-${code}`}>
            {steps.length} adım
          </span>
          {missingN > 0 ? (
            <span className="inline-flex max-w-full items-center rounded-full bg-amber-50 text-amber-800 border border-amber-200 px-2 py-0.5 text-[11px] font-semibold" data-testid={`recipe-missing-badge-${code}`}>
              {missingN} malzeme eksik
            </span>
          ) : null}
          {recipe.contact_name ? (
            <span className="inline-flex max-w-full items-center gap-1 rounded-full bg-blue-50 text-blue-800 border border-blue-200 px-2 py-0.5 text-[11px] font-semibold min-w-0" data-testid={`recipe-customer-${code}`}>
              <User className="w-3 h-3 shrink-0" />
              <span className="truncate">{recipe.contact_name}</span>
            </span>
          ) : null}
          {recipe.job_file_name ? (
            <span className="inline-flex max-w-full items-center rounded-full bg-slate-100 text-slate-600 px-2 py-0.5 text-[11px] font-semibold min-w-0" data-testid={`recipe-job-${code}`}>
              <span className="truncate">{recipe.job_file_name}</span>
            </span>
          ) : null}
        </div>
        {shown.length > 0 ? (
          <div className="bg-slate-50 rounded-xl px-2.5 py-2 space-y-1.5 min-w-0">
            {shown.map((material, index) => {
              const state = materialStockState(material, findProduct(products, material.product_id));
              const label = stockStatusLabel(state);
              return (
                <div key={`${material.product_id || material.product_name || index}`} className="grid grid-cols-[14px_minmax(0,1fr)_auto] gap-2 items-center text-xs min-w-0">
                  <span data-testid={`recipe-stock-icon-${code}-${index}`} data-status={state.status}><StockMark state={state} /></span>
                  <span className="truncate text-slate-700">{material.product_name || "Malzeme"}</span>
                  <span className="text-right tabular-nums text-slate-700">
                    {formatTrQty(material.quantity || 0)} {material.unit || ""}
                    {label ? <small data-testid={`recipe-stock-label-${code}-${index}`} className={`block text-[11px] ${stockLabelClass(state)}`}>{label}</small> : null}
                  </span>
                </div>
              );
            })}
            {materials.length > shown.length ? (
              <div className="text-[11px] text-slate-400">+{materials.length - shown.length} malzeme</div>
            ) : null}
          </div>
        ) : null}
      </div>
      <div className={`min-w-0 ${layout === "list" ? "sm:w-72 sm:shrink-0 sm:flex sm:flex-col sm:justify-between" : ""}`}>
        <div className="grid grid-cols-3 gap-2 border-t border-dashed border-slate-200 pt-2.5 mt-1">
          <div className="min-w-0">
            <div className="text-[10px] uppercase font-semibold text-slate-400">Birim maliyet</div>
            <div className="font-extrabold text-slate-900 tabular-nums text-sm truncate" data-testid={`recipe-cost-${code}`}>{formatMoney(cost)}</div>
          </div>
          <div className="min-w-0">
            <div className="text-[10px] uppercase font-semibold text-slate-400">Satış</div>
            <div className="font-extrabold text-slate-900 tabular-nums text-sm truncate" data-testid={`recipe-sale-${code}`}>{sale == null ? "—" : formatMoney(sale)}</div>
          </div>
          <div className="min-w-0">
            <div className="text-[10px] uppercase font-semibold text-slate-400">Marj</div>
            <div className={`font-extrabold tabular-nums text-sm truncate ${moneyClass(pct)}`} data-testid={`recipe-margin-${code}`}>{margin}</div>
          </div>
        </div>
        <div className="flex items-center justify-between gap-2 mt-2 min-w-0">
          <div className="text-xs text-slate-600 min-w-0">
            Üretilebilir: <b data-testid={`recipe-producible-${code}`} className={`text-sm ${producibleClass}`}>{producibleText}</b>
          </div>
          {showMenu ? (
            <div className="flex items-center gap-1.5 shrink-0" onClick={(e) => e.stopPropagation()}>
              {canEdit ? (
                <button
                  type="button"
                  onClick={() => onProduce(recipe)}
                  className="inline-flex items-center gap-1 px-2.5 py-1.5 bg-emerald-600 text-white rounded-lg text-xs font-semibold hover:bg-emerald-700"
                  data-testid={`recipe-produce-${code}`}
                >
                  <Factory className="w-3.5 h-3.5" /> Üret
                </button>
              ) : null}
              <div className="relative">
                <button
                  type="button"
                  aria-haspopup="menu"
                  aria-expanded={menuOpen}
                  onClick={() => onToggleMenu(recipe)}
                  className="w-8 h-8 grid place-items-center border border-slate-300 rounded-lg bg-white font-black text-slate-700"
                  data-testid={`recipe-menu-${code}`}
                >
                  ⋯
                </button>
                {menuOpen ? (
                  <div role="menu" className="absolute right-0 top-9 z-20 w-44 rounded-xl border border-slate-200 bg-white shadow-lg p-1 text-left" data-testid={`recipe-menu-panel-${code}`}>
                    {canEdit ? (
                      <>
                        <button type="button" role="menuitem" className="flex w-full items-center gap-2 rounded-lg px-2 py-1.5 text-xs hover:bg-slate-50" onClick={() => onCopy(recipe)} data-testid={`recipe-copy-${code}`}><Copy className="w-3.5 h-3.5" /> Kopyala</button>
                        <button type="button" role="menuitem" className="flex w-full items-center gap-2 rounded-lg px-2 py-1.5 text-xs hover:bg-slate-50" onClick={() => onEdit(recipe)} data-testid={`recipe-edit-${code}`}><Pencil className="w-3.5 h-3.5" /> Düzenle</button>
                        {typeof onArchive === "function" ? (
                          <button type="button" role="menuitem" className="flex w-full items-center gap-2 rounded-lg px-2 py-1.5 text-xs hover:bg-slate-50" onClick={() => onArchive(recipe)} data-testid={`recipe-archive-${code}`}><Archive className="w-3.5 h-3.5" /> {recipe.is_active === false ? "Geri al" : "Arşivle"}</button>
                        ) : null}
                      </>
                    ) : null}
                    {canEdit && canDelete ? <hr className="my-1 border-slate-100" /> : null}
                    {canDelete ? (
                      <button type="button" role="menuitem" className="flex w-full items-center gap-2 rounded-lg px-2 py-1.5 text-xs text-rose-600 hover:bg-rose-50" onClick={() => onDelete(recipe)} data-testid={`recipe-delete-${code}`}><Trash2 className="w-3.5 h-3.5" /> Sil</button>
                    ) : null}
                  </div>
                ) : null}
              </div>
            </div>
          ) : null}
        </div>
      </div>
    </article>
  );
}

function gridClass(layout) {
  return layout === "list"
    ? "grid grid-cols-1 gap-3 min-w-0 max-w-full"
    : "grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-3 min-w-0 max-w-full";
}

function RecipeGroups({ recipes, layout, menuId, drawerId, focusedId, onFocusVariant, ...cardProps }) {
  const groups = groupByFinishedProduct(recipes);
  const grid = gridClass(layout);
  const cardFor = (recipe) => {
    const id = recipeIdentity(recipe);
    return (
      <RecipeCard
        key={id}
        recipe={recipe}
        layout={layout}
        menuOpen={menuId === id}
        selected={focusedId === id || drawerId === id}
        {...cardProps}
      />
    );
  };
  return (
    <div className={grid} data-testid="recipe-grid">
      {groups.map((group) => {
        if (group.items.length < 2) return cardFor(group.items[0]);
        return (
          <section key={group.key} data-testid={`recipe-group-${group.key}`} className="col-span-full bg-white border border-slate-200 rounded-2xl p-3 min-w-0 max-w-full space-y-2">
            <div className="min-w-0">
              <div className="font-bold text-slate-900 truncate">{group.productName}</div>
              <div className="text-[11px] text-slate-500">{group.items.length} varyant</div>
            </div>
            <div data-allow-x-scroll="true" className="max-w-full min-w-0 overflow-x-auto">
              <div className="flex w-max gap-1.5">
                {group.items.map((recipe) => {
                  const code = recipe.code || recipeIdentity(recipe);
                  const on = focusedId === recipeIdentity(recipe);
                  return (
                    <button
                      key={recipeIdentity(recipe)}
                      type="button"
                      data-testid={`recipe-variant-${code}`}
                      aria-pressed={on}
                      onClick={() => onFocusVariant(recipe)}
                      className={`shrink-0 rounded-lg border px-2.5 py-1 text-xs font-semibold ${on ? "bg-violet-700 text-white border-violet-700" : "bg-violet-50 text-violet-800 border-violet-200"}`}
                    >
                      {variantChipLabel(recipe)}
                    </button>
                  );
                })}
              </div>
            </div>
            <div className={grid}>
              {group.items.map((recipe) => cardFor(recipe))}
            </div>
          </section>
        );
      })}
    </div>
  );
}

function RecipeDrawer({ recipe, products, orders, canEdit, onClose, onProduce, onCopy, onEdit }) {
  useEscape(onClose);
  const code = recipe.code || recipeIdentity(recipe);
  const steps = recipeSteps(recipe);
  const costs = costBreakdown(recipe, products);
  const productions = recentProductions(recipe, orders);
  const negative = (recipe.materials || []).some((m) => {
    const stock = materialStockState(m, findProduct(products, m.product_id)).stock;
    return stock != null && stock < 0;
  });
  return (
    <div className="fixed inset-0 z-[80]" data-testid="recipe-drawer-root">
      <div className="absolute inset-0 bg-slate-900/40" {...backdropDismissProps(onClose)} data-testid="recipe-drawer-backdrop" />
      <aside
        role="dialog"
        aria-label={recipe.name || "Reçete"}
        data-testid="recipe-drawer"
        className="absolute inset-y-0 right-0 w-full max-w-full sm:w-[600px] bg-white shadow-2xl overflow-y-auto overflow-x-hidden p-5 flex flex-col gap-4"
      >
        <div className="flex items-start justify-between gap-3 min-w-0">
          <div className="min-w-0">
            <div className="font-mono text-[11px] text-slate-400 break-all">{recipe.code} · {recipe.finished_product_name} × {formatTrQty(recipe.target_quantity ?? 1)} {recipe.unit || ""}</div>
            <h2 className="text-xl font-bold text-slate-900 break-words">{recipe.name || recipe.finished_product_name}</h2>
            <div className="flex flex-wrap gap-1.5 mt-1">
              <span className={`inline-flex rounded-full px-2 py-0.5 text-[11px] font-semibold border ${isOneTime(recipe) ? "bg-amber-50 text-amber-800 border-amber-200" : "bg-emerald-50 text-emerald-800 border-emerald-200"}`}>
                {isOneTime(recipe) ? "Tek seferlik" : "Standart"}
              </span>
              {recipe.contact_name ? <span className="inline-flex max-w-full truncate rounded-full bg-blue-50 text-blue-800 border border-blue-200 px-2 py-0.5 text-[11px] font-semibold">{recipe.contact_name}</span> : null}
              {recipe.job_file_name ? <span className="inline-flex max-w-full truncate rounded-full bg-slate-100 text-slate-600 px-2 py-0.5 text-[11px] font-semibold">{recipe.job_file_name}</span> : null}
            </div>
          </div>
          <button type="button" onClick={onClose} className="w-9 h-9 grid place-items-center border border-slate-300 rounded-lg shrink-0" data-testid="recipe-drawer-close" aria-label="Kapat"><X className="w-4 h-4" /></button>
        </div>

        <section className="border border-slate-200 rounded-2xl p-3 min-w-0">
          <h3 className="text-[11px] uppercase tracking-wide font-semibold text-slate-500 mb-2">Malzemeler</h3>
          <div className="max-w-full overflow-x-auto" data-allow-x-scroll="true">
            <table className="w-full text-xs min-w-[520px]">
              <thead>
                <tr className="text-[10px] uppercase text-slate-400">
                  <th className="text-left font-semibold py-1">Malzeme</th>
                  <th className="text-right font-semibold py-1">Miktar</th>
                  <th className="text-right font-semibold py-1">Fire</th>
                  <th className="text-right font-semibold py-1">Birim maliyet</th>
                  <th className="text-right font-semibold py-1">Stok</th>
                </tr>
              </thead>
              <tbody>
                {(recipe.materials || []).map((material, index) => {
                  const state = materialStockState(material, findProduct(products, material.product_id));
                  const label = stockStatusLabel(state);
                  const waste = material.wastage_percent == null || material.wastage_percent === "" ? null : Number(material.wastage_percent);
                  return (
                    <tr key={`${material.product_id || index}`} className="border-t border-slate-100" data-testid={`recipe-drawer-mat-${code}-${index}`}>
                      <td className="py-1.5 pr-2 text-slate-800">{material.product_name || "—"}</td>
                      <td className="py-1.5 text-right tabular-nums whitespace-nowrap">{formatTrQty(material.quantity || 0)} {material.unit || ""}</td>
                      <td className="py-1.5 text-right tabular-nums">{waste == null || Number.isNaN(waste) ? "—" : `%${formatTrQty(waste)}`}</td>
                      <td className="py-1.5 text-right tabular-nums whitespace-nowrap">{formatMoney(materialUnitNet(material))}</td>
                      <td className={`py-1.5 text-right whitespace-nowrap ${stockLabelClass(state)}`} data-testid={`recipe-drawer-stock-${code}-${index}`}>
                        {label || "—"}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
          {negative ? (
            <p className="mt-2 text-[11px] text-slate-500">Eksik = gerekli − mevcut. Eksi stok, bekleyen emirlerden gelebilir.</p>
          ) : null}
        </section>

        {steps.length > 0 ? (
          <section className="border border-slate-200 rounded-2xl p-3 min-w-0" data-testid="recipe-drawer-steps">
            <h3 className="text-[11px] uppercase tracking-wide font-semibold text-slate-500 mb-2">Adımlar / operasyonlar · {steps.length} adım</h3>
            <div className="max-w-full overflow-x-auto" data-allow-x-scroll="true">
              <table className="w-full text-xs">
                <thead>
                  <tr className="text-[10px] uppercase text-slate-400">
                    <th className="text-left font-semibold py-1">Adım</th>
                    <th className="text-right font-semibold py-1">İstasyon</th>
                    <th className="text-right font-semibold py-1">Süre</th>
                  </tr>
                </thead>
                <tbody>
                  {steps.map((step, index) => (
                    <tr key={`${step.name}-${index}`} className="border-t border-slate-100" data-testid={`recipe-drawer-step-${code}-${index}`}>
                      <td className="py-1.5 pr-2">{index + 1}. {step.name}</td>
                      <td className="py-1.5 text-right text-slate-600">{step.station || "—"}</td>
                      <td className="py-1.5 text-right text-slate-600">{step.duration_min ? formatDuration(step.duration_min) : "—"}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </section>
        ) : null}

        <section className="border border-slate-200 rounded-2xl p-3 min-w-0" data-testid="recipe-drawer-costs">
          <h3 className="text-[11px] uppercase tracking-wide font-semibold text-slate-500 mb-2">Maliyet kırılımı</h3>
          <table className="w-full text-xs">
            <tbody>
              {costs.material != null ? (
                <tr className="border-t border-slate-100"><td className="py-1.5">Hammadde (fire dahil)</td><td className="py-1.5 text-right tabular-nums">{formatMoney(costs.material)}</td></tr>
              ) : null}
              {costs.labor != null && costs.labor > 0 ? (
                <tr className="border-t border-slate-100">
                  <td className="py-1.5">İşçilik{costs.durationMin ? ` (${formatDuration(costs.durationMin)})` : ""}</td>
                  <td className="py-1.5 text-right tabular-nums">{formatMoney(costs.labor)}</td>
                </tr>
              ) : null}
              {costs.overhead != null && costs.overhead > 0 ? (
                <tr className="border-t border-slate-100"><td className="py-1.5">Genel gider</td><td className="py-1.5 text-right tabular-nums">{formatMoney(costs.overhead)}</td></tr>
              ) : null}
              <tr className="border-t border-slate-100"><td className="py-1.5 font-bold">Birim maliyet</td><td className="py-1.5 text-right font-bold tabular-nums">{formatMoney(costs.unit)}</td></tr>
              <tr className="border-t border-slate-100">
                <td className="py-1.5">Satış fiyatı</td>
                <td className="py-1.5 text-right">{costs.sale == null ? <span className="text-slate-400">tanımsız — marj hesaplanamıyor</span> : <span className="tabular-nums">{formatMoney(costs.sale)}</span>}</td>
              </tr>
            </tbody>
          </table>
        </section>

        <section className="border border-slate-200 rounded-2xl p-3 min-w-0" data-testid="recipe-drawer-productions">
          <h3 className="text-[11px] uppercase tracking-wide font-semibold text-slate-500 mb-2">Son üretimler</h3>
          {productions.length === 0 ? (
            <p className="text-xs text-slate-400">Kayıt yok</p>
          ) : (
            <ul className="space-y-1.5">
              {productions.slice(0, 6).map((order) => {
                const [label, tone] = ORDER_STATUS[order.status] || ORDER_STATUS.planned;
                const when = order.planned_date || order.start_date || order.created_at;
                return (
                  <li key={order.id || order.order_code} className="flex items-center justify-between gap-2 text-xs min-w-0" data-testid={`recipe-drawer-po-${order.order_code}`}>
                    <span className="min-w-0 truncate">{order.order_code}{when ? ` · ${fmtDmy(when)}` : ""}</span>
                    <span className="shrink-0 inline-flex items-center gap-1">
                      <span className={`rounded-full px-2 py-0.5 text-[10px] font-semibold ${tone}`}>{label}</span>
                      <span className="tabular-nums text-slate-500">{formatTrQty(order.completed_quantity || 0)}/{formatTrQty(order.planned_quantity || 0)}</span>
                    </span>
                  </li>
                );
              })}
            </ul>
          )}
        </section>

        {canEdit ? (
          <div className="flex flex-wrap justify-end gap-2">
            <button type="button" onClick={() => onCopy(recipe)} className="inline-flex items-center gap-1 px-3 py-1.5 border border-slate-300 rounded-xl text-xs font-semibold" data-testid={`recipe-drawer-copy-${code}`}><Copy className="w-3.5 h-3.5" /> Kopyala</button>
            <button type="button" onClick={() => onEdit(recipe)} className="inline-flex items-center gap-1 px-3 py-1.5 border border-slate-300 rounded-xl text-xs font-semibold" data-testid={`recipe-drawer-edit-${code}`}><Pencil className="w-3.5 h-3.5" /> Düzenle</button>
            <button type="button" onClick={() => onProduce(recipe)} className="inline-flex items-center gap-1 px-3 py-1.5 bg-emerald-600 text-white rounded-xl text-xs font-semibold" data-testid={`recipe-drawer-produce-${code}`}><Factory className="w-3.5 h-3.5" /> Üret</button>
          </div>
        ) : null}
      </aside>
    </div>
  );
}

export default function RecipesPanel({
  recipes = [],
  products = [],
  orders = [],
  can,
  onProduce,
  onCopy,
  onEdit,
  onDelete,
  onArchive,
}) {
  const allow = typeof can === "function" ? can : () => true;
  const canEdit = allow("/production", "edit");
  const canDelete = allow("/production", "delete");
  const [filter, setFilter] = useState("all");
  const [query, setQuery] = useState("");
  const [sort, setSort] = useState("margin");
  const [layout, setLayout] = useState("grid");
  const [menuId, setMenuId] = useState(null);
  const [drawerId, setDrawerId] = useState(null);
  const [oneTimeOpen, setOneTimeOpen] = useState(true);
  const [focusedId, setFocusedId] = useState(null);

  const counts = useMemo(() => filterCounts(recipes, products), [recipes, products]);
  const visible = useMemo(
    () => applyRecipeQuery(recipes, { filter, query, sort, products }),
    [recipes, filter, query, sort, products],
  );
  const standard = visible.filter((recipe) => !isOneTime(recipe));
  const oneTime = visible.filter((recipe) => isOneTime(recipe));
  const showStandard = filter !== "one_time";
  const showOneTime = filter !== "standard";
  const drawer = (recipes || []).find((recipe) => recipeIdentity(recipe) === drawerId) || null;

  const run = (fn, recipe) => {
    setMenuId(null);
    if (typeof fn === "function") fn(recipe);
  };

  const shared = {
    products,
    canEdit,
    canDelete,
    menuId,
    drawerId,
    focusedId,
    onFocusVariant: (recipe) => setFocusedId(recipeIdentity(recipe)),
    onOpen: (recipe) => setDrawerId(recipeIdentity(recipe)),
    onToggleMenu: (recipe) => {
      const id = recipeIdentity(recipe);
      setMenuId((cur) => (cur === id ? null : id));
    },
    onProduce: (recipe) => run(onProduce, recipe),
    onCopy: (recipe) => run(onCopy, recipe),
    onEdit: (recipe) => run(onEdit, recipe),
    onDelete: (recipe) => run(onDelete, recipe),
    onArchive: typeof onArchive === "function"
      ? (recipe) => run(() => onArchive(recipe, recipe.is_active === false), recipe)
      : undefined,
  };

  return (
    <div data-testid="recipes-panel" data-layout={layout} className="w-full min-w-0 max-w-full overflow-x-hidden space-y-3">
      <div className="flex flex-col gap-2 min-w-0 max-w-full">
        <label className="relative block min-w-0 max-w-full">
          <Search className="w-3.5 h-3.5 text-slate-400 absolute left-3 top-1/2 -translate-y-1/2" />
          <input
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Reçete, ürün, BOM kodu, müşteri ara…"
            className="w-full min-w-0 max-w-full border border-slate-300 bg-white rounded-xl pl-8 pr-3 py-2 text-xs"
            data-testid="recipe-search"
          />
        </label>
        <div className="flex flex-col sm:flex-row sm:items-center gap-2 min-w-0 max-w-full">
          <div data-testid="recipe-filter-bar" data-allow-x-scroll="true" className="min-w-0 max-w-full overflow-x-auto">
            <div className="flex w-max gap-1.5">
              {RECIPE_FILTERS.map((item) => {
                const on = filter === item.id;
                const count = counts[item.id];
                const missingHot = item.id === "missing" && count > 0 && !on;
                return (
                  <button
                    key={item.id}
                    type="button"
                    aria-pressed={on}
                    onClick={() => setFilter(item.id)}
                    data-testid={`recipe-filter-${item.id}`}
                    className={`shrink-0 inline-flex items-center gap-1.5 rounded-full border px-3 py-1.5 text-xs font-semibold ${on ? "bg-slate-900 text-white border-slate-900" : "bg-white text-slate-700 border-slate-300"}`}
                  >
                    {item.label}
                    <span
                      data-testid={`recipe-filter-count-${item.id}`}
                      className={`rounded-full px-1.5 text-[11px] ${on ? "bg-slate-700 text-white" : missingHot ? "bg-rose-100 text-rose-600" : "bg-slate-100 text-slate-600"}`}
                    >
                      {count}
                    </span>
                  </button>
                );
              })}
            </div>
          </div>
          <div className="flex items-center gap-2 shrink-0">
            <select
              value={sort}
              onChange={(e) => setSort(e.target.value)}
              data-testid="recipe-sort"
              className="border border-slate-300 bg-white rounded-xl px-2 py-1.5 text-xs font-semibold"
            >
              <option value="name">Sırala: Ad</option>
              <option value="cost">Sırala: Maliyet</option>
              <option value="margin">Sırala: Marj</option>
            </select>
            <div className="inline-flex border border-slate-300 rounded-xl overflow-hidden bg-white">
              <button type="button" aria-pressed={layout === "grid"} onClick={() => setLayout("grid")} className={`px-2 py-1.5 ${layout === "grid" ? "bg-slate-900 text-white" : "text-slate-600"}`} data-testid="recipe-view-grid" title="Izgara"><LayoutGrid className="w-3.5 h-3.5" /></button>
              <button type="button" aria-pressed={layout === "list"} onClick={() => setLayout("list")} className={`px-2 py-1.5 ${layout === "list" ? "bg-slate-900 text-white" : "text-slate-600"}`} data-testid="recipe-view-list" title="Liste"><List className="w-3.5 h-3.5" /></button>
            </div>
          </div>
        </div>
      </div>

      {visible.length === 0 ? (
        <div className="bg-white border border-dashed border-slate-200 rounded-2xl p-10 text-center text-xs text-slate-400" data-testid="recipes-empty">
          {recipes.length === 0 ? "Henüz reçete yok. \"Yeni Reçete\" ile ürün ağacını tanımlayın." : "Bu süzgeçte reçete yok."}
        </div>
      ) : null}

      {showStandard && standard.length > 0 ? (
        <section className="space-y-2 min-w-0 max-w-full" data-testid="recipe-standard-section">
          <h2 className="text-sm font-bold text-slate-900">
            {filter === "archive" ? "Arşiv" : "Standart reçeteler"}{" "}
            <span className="text-xs font-semibold text-slate-500 bg-slate-100 rounded-full px-2 py-0.5" data-testid="recipe-standard-count">{standard.length}</span>
          </h2>
          <RecipeGroups recipes={standard} layout={layout} {...shared} />
        </section>
      ) : null}

      {showOneTime && oneTime.length > 0 ? (
        <section className="space-y-2 min-w-0 max-w-full" data-testid="recipe-one-time-section">
          <div className="flex items-center justify-between gap-2 min-w-0">
            <button type="button" onClick={() => setOneTimeOpen((v) => !v)} className="text-sm font-bold text-slate-900 inline-flex items-center gap-1.5 min-w-0" data-testid="recipe-one-time-toggle" aria-expanded={oneTimeOpen}>
              <span aria-hidden>{oneTimeOpen ? "▾" : "▸"}</span>
              <span className="truncate">Siparişe özel reçeteler</span>
              <span className="text-xs font-semibold text-slate-500 bg-slate-100 rounded-full px-2 py-0.5" data-testid="recipe-one-time-count">{oneTime.length}</span>
            </button>
            <span className="hidden sm:inline text-xs text-slate-400">Sipariş / müşteriye bağlı</span>
          </div>
          {oneTimeOpen ? <RecipeGroups recipes={oneTime} layout={layout} {...shared} /> : null}
        </section>
      ) : null}

      {drawer ? (
        <RecipeDrawer
          recipe={drawer}
          products={products}
          orders={orders}
          canEdit={canEdit}
          onClose={() => setDrawerId(null)}
          onProduce={(recipe) => run(onProduce, recipe)}
          onCopy={(recipe) => run(onCopy, recipe)}
          onEdit={(recipe) => run(onEdit, recipe)}
        />
      ) : null}
    </div>
  );
}
