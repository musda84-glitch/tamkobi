import { formatTrAmount, formatTrQty } from "../../../utils/money";

/** Reçete satırı bu kadar mamul için tanımlı; malzeme miktarı partiye aittir. */
export function batchTarget(recipe) {
  const target = Number(recipe?.target_quantity);
  return Number.isFinite(target) && target > 0 ? target : 1;
}

export function finiteOrNull(value) {
  if (value == null || value === "") return null;
  const n = Number(value);
  return Number.isFinite(n) ? n : null;
}

export function isArchived(recipe) {
  return recipe?.is_active === false;
}

export function isOneTime(recipe) {
  return recipe?.one_time === true || recipe?.one_time === 1 || recipe?.one_time === "true";
}

export function findProduct(products, id) {
  if (id == null || id === "") return null;
  const key = String(id);
  return (products || []).find((p) => String(p?.id) === key || String(p?._id) === key) || null;
}

/** Malzemenin stok adedi. Satırdaki alan ürün kartından önce gelir. */
export function resolveStock(material, product) {
  const onLine = finiteOrNull(material?.stock_quantity);
  if (onLine != null) return onLine;
  return finiteOrNull(product?.stock_quantity);
}

/** Parti için fire dahil ihtiyaç. */
export function requiredBatchQty(material) {
  const qty = finiteOrNull(material?.quantity);
  if (qty == null || qty <= 0) return 0;
  const waste = finiteOrNull(material?.wastage_percent) || 0;
  return qty * (1 + waste / 100);
}

/**
 * Stok durumu.
 * none: stok yok / eksi — kırmızı
 * low: kısmi eksik, ya da min stok altında kalan — amber
 * ok: ihtiyacı karşılıyor — yeşil
 */
export function materialStockState(material, product) {
  const stock = resolveStock(material, product);
  const need = requiredBatchQty(material);
  const explicit = finiteOrNull(material?.missing_qty);
  let missing = explicit;
  if (missing == null && stock != null) missing = Math.max(0, need - stock);
  if ((missing == null || missing <= 0) && stock != null && stock < 0) missing = Math.abs(stock);

  if (stock == null && !(missing > 0)) {
    return { status: "unknown", stock: null, missing: 0, lowRemaining: false };
  }
  if (stock != null && stock <= 0) {
    const n = missing > 0 ? missing : (stock < 0 ? Math.abs(stock) : Math.max(need, 0));
    return { status: "none", stock, missing: n, lowRemaining: false };
  }
  if (missing > 0) {
    if (stock == null) return { status: "none", stock: null, missing, lowRemaining: false };
    return { status: "low", stock, missing, lowRemaining: false };
  }
  const minAlert = finiteOrNull(product?.min_stock_alert);
  if (stock != null && minAlert != null && minAlert > 0 && stock <= minAlert) {
    return { status: "low", stock, missing: 0, lowRemaining: true };
  }
  if (stock == null) return { status: "unknown", stock: null, missing: 0, lowRemaining: false };
  return { status: "ok", stock, missing: 0, lowRemaining: false };
}

/** "stok -24" yerine "24 eksik". Yeterli stokta "yeterli · N", az kalanda "az · N kaldı". */
export function stockStatusLabel(state) {
  if (!state || state.status === "unknown") return "";
  if (state.status === "none" || (state.status === "low" && state.missing > 0)) {
    return `${formatTrQty(state.missing)} eksik`;
  }
  if (state.status === "low" && state.lowRemaining) {
    return `az · ${formatTrQty(state.stock)} kaldı`;
  }
  if (state.status === "ok") return `yeterli · ${formatTrQty(state.stock)}`;
  return "";
}

export function hasMaterialShortage(recipe, products) {
  return (recipe?.materials || []).some((m) => {
    const state = materialStockState(m, findProduct(products, m?.product_id));
    return state.status === "none" || (state.status === "low" && state.missing > 0);
  });
}

export function shortageCount(recipe, products) {
  return (recipe?.materials || []).filter((m) => {
    const state = materialStockState(m, findProduct(products, m?.product_id));
    return state.status === "none" || (state.status === "low" && state.missing > 0);
  }).length;
}

/**
 * Stoktan üretilebilecek mamul adedi.
 * Malzeme miktarı `target_quantity` mamul içindir (fire dahil).
 * Stok bilinmeyen ve eksik yazılmamış satır hesabı düşürmez.
 * Eksik yazılıp stok yoksa 0. Hiç stok bilgisi yoksa null.
 */
export function producibleQty(recipe, products) {
  const target = batchTarget(recipe);
  let min = Infinity;
  let known = false;
  for (const material of recipe?.materials || []) {
    const need = requiredBatchQty(material);
    if (need <= 0) continue;
    const product = findProduct(products, material?.product_id);
    const stock = resolveStock(material, product);
    if (stock == null) {
      const miss = finiteOrNull(material?.missing_qty);
      if (miss != null && miss > 0) return 0;
      continue;
    }
    known = true;
    if (stock <= 0) return 0;
    const units = Math.floor((stock * target) / need + 1e-9);
    if (units < min) min = units;
  }
  if (!known || min === Infinity) return null;
  return min;
}

export function unitCostOf(recipe) {
  const direct = finiteOrNull(recipe?.unit_cost);
  if (direct != null) return direct;
  const total = finiteOrNull(recipe?.total_estimated_cost);
  if (total == null) return null;
  return total / batchTarget(recipe);
}

export function salePriceOf(recipe, products) {
  const direct = finiteOrNull(recipe?.sale_price);
  if (direct != null && direct > 0) return direct;
  const product = findProduct(products, recipe?.finished_product_id);
  const sale = finiteOrNull(product?.sale_price);
  if (sale != null && sale > 0) return sale;
  return null;
}

/** Marj = (satış − birim maliyet) / satış. Satış yoksa null. */
export function marginPct(recipe, products) {
  const sale = salePriceOf(recipe, products);
  const cost = unitCostOf(recipe);
  if (sale == null || cost == null) return null;
  return ((sale - cost) / sale) * 100;
}

export function formatMarginPct(pct) {
  if (pct == null || !Number.isFinite(Number(pct))) return "";
  const rounded = Math.round(Number(pct));
  const sign = rounded < 0 ? "-" : "";
  return `${sign}%${Math.abs(rounded)}`;
}

export function marginLabel(recipe, products) {
  if (salePriceOf(recipe, products) == null) return "fiyat yok";
  const pct = marginPct(recipe, products);
  if (pct == null) return "—";
  return formatMarginPct(pct);
}

export function formatMoney(value) {
  const n = finiteOrNull(value);
  if (n == null) return "—";
  return `${formatTrAmount(n)} ₺`;
}

export function materialUnitNet(material) {
  const cost = finiteOrNull(material?.cost_per_unit);
  if (cost == null) return null;
  if (!material?.cost_includes_vat) return cost;
  const rateRaw = material?.vat_rate;
  const rate = rateRaw == null || rateRaw === "" ? 20 : Number(rateRaw);
  if (!(rate > 0)) return cost;
  return cost / (1 + rate / 100);
}

export function recipeSteps(recipe) {
  const out = [];
  const push = (step) => {
    if (!step || typeof step !== "object") return;
    const station = String(step.station || "").trim();
    const name = String(step.name || station || "").trim();
    if (!name) return;
    const duration = finiteOrNull(step.duration_min);
    out.push({
      name,
      station,
      duration_min: duration != null && duration > 0 ? duration : null,
    });
  };
  for (const material of recipe?.materials || []) {
    for (const step of material?.steps || []) push(step);
  }
  for (const step of recipe?.steps || []) push(step);
  return out;
}

export function formatDuration(min) {
  const n = finiteOrNull(min);
  if (n == null || n <= 0) return "";
  const total = Math.round(n);
  const h = Math.floor(total / 60);
  const m = total % 60;
  if (h && m) return `${h} sa ${m} dk`;
  if (h) return `${h} sa`;
  return `${m} dk`;
}

export function materialCostOf(recipe) {
  const direct = finiteOrNull(recipe?.material_cost);
  if (direct != null) return direct;
  let sum = 0;
  let any = false;
  for (const material of recipe?.materials || []) {
    const net = materialUnitNet(material);
    if (net == null) continue;
    any = true;
    sum += net * requiredBatchQty(material);
  }
  return any ? sum : null;
}

export function costBreakdown(recipe, products) {
  const steps = recipeSteps(recipe);
  const duration = steps.reduce((sum, step) => sum + (step.duration_min || 0), 0);
  return {
    material: materialCostOf(recipe),
    labor: finiteOrNull(recipe?.labor_cost),
    overhead: finiteOrNull(recipe?.overhead_cost),
    unit: unitCostOf(recipe),
    sale: salePriceOf(recipe, products),
    durationMin: duration > 0 ? duration : null,
  };
}

export function variantChipLabel(recipe) {
  const parts = [];
  if (recipe?.name) parts.push(String(recipe.name));
  const version = recipe?.version;
  if (version != null && version !== "") parts.push(`v${version}`);
  if (recipe?.code) parts.push(String(recipe.code));
  return parts.join(" · ");
}

export function groupByFinishedProduct(recipes) {
  const groups = [];
  const index = new Map();
  for (const recipe of recipes || []) {
    const key = String(recipe?.finished_product_id || recipe?.finished_product_name || recipe?.id || recipe?._id || recipe?.code || groups.length);
    let group = index.get(key);
    if (!group) {
      group = {
        key,
        productName: recipe?.finished_product_name || recipe?.name || "Ürün",
        items: [],
      };
      index.set(key, group);
      groups.push(group);
    }
    group.items.push(recipe);
  }
  return groups;
}

export function filterCounts(recipes, products) {
  const list = recipes || [];
  const active = list.filter((r) => !isArchived(r));
  return {
    all: active.length,
    standard: active.filter((r) => !isOneTime(r)).length,
    one_time: active.filter((r) => isOneTime(r)).length,
    missing: active.filter((r) => hasMaterialShortage(r, products)).length,
    archive: list.filter(isArchived).length,
  };
}

function searchHaystack(recipe) {
  return [recipe?.name, recipe?.finished_product_name, recipe?.code, recipe?.contact_name, recipe?.job_file_name]
    .filter(Boolean)
    .join(" ")
    .toLocaleLowerCase("tr");
}

export function compareRecipes(a, b, sort, products) {
  if (sort === "cost") return (unitCostOf(b) || 0) - (unitCostOf(a) || 0);
  if (sort === "margin") {
    const left = marginPct(a, products);
    const right = marginPct(b, products);
    if (left == null && right == null) return 0;
    if (left == null) return 1;
    if (right == null) return -1;
    return right - left;
  }
  return String(a?.name || "").localeCompare(String(b?.name || ""), "tr");
}

export function applyRecipeQuery(recipes, { filter = "all", query = "", sort = "name", products } = {}) {
  const q = String(query || "").trim().toLocaleLowerCase("tr");
  let rows = (recipes || []).filter((recipe) => {
    if (filter === "archive") return isArchived(recipe);
    if (isArchived(recipe)) return false;
    if (filter === "standard") return !isOneTime(recipe);
    if (filter === "one_time") return isOneTime(recipe);
    if (filter === "missing") return hasMaterialShortage(recipe, products);
    return true;
  });
  if (q) rows = rows.filter((recipe) => searchHaystack(recipe).includes(q));
  return [...rows].sort((a, b) => compareRecipes(a, b, sort, products));
}

export const RECIPE_FILTERS = [
  { id: "all", label: "Tümü" },
  { id: "standard", label: "Standart" },
  { id: "one_time", label: "Tek seferlik" },
  { id: "missing", label: "Eksik malzemeli" },
  { id: "archive", label: "Arşiv" },
];

export function recipeIdentity(recipe) {
  return String(recipe?.id || recipe?._id || recipe?.code || "");
}

export function recentProductions(recipe, orders) {
  const id = recipeIdentity(recipe);
  if (!id) return [];
  return (orders || [])
    .filter((order) => String(order?.recipe_id || "") === id)
    .slice()
    .sort((a, b) => String(b?.planned_date || b?.start_date || b?.created_at || "").localeCompare(
      String(a?.planned_date || a?.start_date || a?.created_at || ""),
    ));
}
