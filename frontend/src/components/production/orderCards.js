/** Üretim emri kartları — filtre, gecikme, adım ve maliyet. Yalnız gelen alanlar. */

import { istanbulToday } from "../../utils/openingBalance";

const MONTHS = ["Oca", "Şub", "Mar", "Nis", "May", "Haz", "Tem", "Ağu", "Eyl", "Eki", "Kas", "Ara"];

export function productionToday() {
  return istanbulToday();
}

export function isOpenOrder(order) {
  return order?.status === "planned" || order?.status === "in_production";
}

export function lateDays(plannedDate, today) {
  const day = String(plannedDate || "").slice(0, 10);
  const now = String(today || "").slice(0, 10);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(day) || !/^\d{4}-\d{2}-\d{2}$/.test(now)) return 0;
  if (day >= now) return 0;
  const a = Date.UTC(+day.slice(0, 4), +day.slice(5, 7) - 1, +day.slice(8, 10));
  const b = Date.UTC(+now.slice(0, 4), +now.slice(5, 7) - 1, +now.slice(8, 10));
  return Math.round((b - a) / 86400000);
}

export function orderLateDays(order, today = productionToday()) {
  if (!isOpenOrder(order)) return 0;
  return lateDays(order?.planned_date, today);
}

export function formatPlanDay(value) {
  const raw = String(value || "").trim();
  const match = /^(\d{4})-(\d{2})-(\d{2})/.exec(raw);
  if (!match) return raw;
  const month = Number(match[2]);
  if (month < 1 || month > 12) return raw;
  return `${Number(match[3])} ${MONTHS[month - 1]} ${match[1]}`;
}

export function formatStepStamp(value) {
  if (!value) return "";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "";
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: "Europe/Istanbul",
    day: "numeric",
    month: "numeric",
    hour: "2-digit",
    minute: "2-digit",
    hourCycle: "h23",
  }).formatToParts(date);
  const get = (type) => parts.find((part) => part.type === type)?.value || "";
  const month = Number(get("month"));
  const day = Number(get("day"));
  if (!month || !day) return "";
  return `${day} ${MONTHS[month - 1]} ${get("hour")}:${get("minute")}`;
}

export function stepDurationLabel(start, end) {
  if (!start || !end) return "";
  const a = new Date(start).getTime();
  const b = new Date(end).getTime();
  if (!Number.isFinite(a) || !Number.isFinite(b) || b < a) return "";
  const mins = Math.round((b - a) / 60000);
  if (mins < 60) return `${mins} dk`;
  const hours = Math.floor(mins / 60);
  const rest = mins % 60;
  return rest ? `${hours} sa ${rest} dk` : `${hours} sa`;
}

export function sourceBadge(order) {
  const source = String(order?.source || "");
  if (source === "stock_card") return { tone: "stock", label: "Stok kartından" };
  if (source === "bom_shortage") return { tone: "bom", label: "Hammadde eksğinden" };
  const orderNo = String(order?.sales_order_no || "").trim();
  const customer = String(order?.customer_name || "").trim();
  const fromOrder = source === "sales_order" || source === "order" || (source === "order_pick" && (orderNo || customer));
  if (fromOrder) {
    const parts = ["Siparişten"];
    if (orderNo) parts.push(orderNo);
    if (customer) parts.push(customer);
    return { tone: "order", label: parts.join(" · ") };
  }
  if (source === "order_pick") return { tone: "pick", label: "Eksik ürün planından" };
  return null;
}

export function orderProgress(order) {
  const summary = order?.steps_summary || {};
  const steps = Array.isArray(summary.steps) ? summary.steps : [];
  const total = Number(summary.total != null ? summary.total : steps.length) || 0;
  const done = Number(summary.done || 0);
  const active = order?.status === "in_production"
    ? steps.find((step) => !step.done && (step.status === "in_progress" || step.status === "paused" || step.current))
    : null;
  let currentNo = done;
  if (order?.status === "planned") currentNo = 0;
  else if (active) currentNo = Number(active.no || done + 1);
  else if (total && done >= total) currentNo = total;
  const pct = total ? Math.round((done / total) * 100) : 0;
  return { steps, total, done, currentNo, pct, active };
}

export function stepTone(step, order) {
  if (step?.done || step?.status === "done") return "done";
  if (order?.status === "in_production" && !step?.done && (step?.status === "in_progress" || step?.status === "paused" || step?.current)) {
    return "active";
  }
  return "pending";
}

export function stepMeta(step) {
  if (!step) return "";
  const bits = [];
  if (step.station) bits.push(String(step.station));
  if (step.operator_name) bits.push(String(step.operator_name));
  const start = formatStepStamp(step.started_at);
  const end = formatStepStamp(step.finished_at);
  if (start && end) bits.push(`${start} → ${end}`);
  else if (start && (step.status === "in_progress" || step.status === "paused" || step.current)) bits.push(`${start} → devam ediyor`);
  const duration = stepDurationLabel(step.started_at, step.finished_at);
  if (duration) bits.push(`(${duration})`);
  return bits.join(" · ");
}

export function consumedLines(order) {
  const steps = Array.isArray(order?.steps_summary?.steps) ? order.steps_summary.steps : [];
  return steps
    .filter((step) => step?.material_stock_deducted && step?.material_name)
    .map((step) => ({
      name: String(step.material_name),
      qty: step.material_stock_qty,
      unit: step.finish_unit ? String(step.finish_unit) : "",
    }));
}

export function costBreakdown(order, recipe) {
  if (!recipe || typeof recipe !== "object") return [];
  const target = Number(recipe.target_quantity);
  const qty = Number(order?.planned_quantity);
  if (!Number.isFinite(target) || target <= 0 || !Number.isFinite(qty)) return [];
  const scale = qty / target;
  const lines = [];
  const push = (label, key) => {
    if (!Object.prototype.hasOwnProperty.call(recipe, key)) return;
    const raw = recipe[key];
    if (raw == null || raw === "") return;
    const amount = Number(raw);
    if (!Number.isFinite(amount) || amount === 0) return;
    lines.push({ label, amount: Math.round(amount * scale * 100) / 100 });
  };
  push("Hammadde", "material_cost");
  push("İşçilik", "labor_cost");
  push("Genel gider", "overhead_cost");
  return lines;
}

export function countProductionFilters(orders, today = productionToday()) {
  const list = orders || [];
  const open = list.filter(isOpenOrder);
  return {
    open: open.length,
    late: open.filter((order) => lateDays(order?.planned_date, today) > 0).length,
    completed: list.filter((order) => order?.status === "completed").length,
    cancelled: list.filter((order) => order?.status === "cancelled").length,
    all: list.length,
  };
}

function searchHaystack(order) {
  return [order?.order_code, order?.finished_product_name, order?.sales_order_no, order?.customer_name]
    .filter(Boolean)
    .join(" ")
    .toLocaleLowerCase("tr-TR");
}

export function filterProductionOrders(orders, { filter = "open", query = "", today = productionToday() } = {}) {
  const q = String(query || "").trim().toLocaleLowerCase("tr-TR");
  return (orders || []).filter((order) => {
    if (filter === "open" && !isOpenOrder(order)) return false;
    if (filter === "late" && !(isOpenOrder(order) && lateDays(order?.planned_date, today) > 0)) return false;
    if (filter === "completed" && order?.status !== "completed") return false;
    if (filter === "cancelled" && order?.status !== "cancelled") return false;
    if (!q) return true;
    return searchHaystack(order).includes(q);
  });
}

export function sortProductionOrders(orders, sort = "planned_date") {
  const list = [...(orders || [])];
  if (sort === "created_at") {
    list.sort((a, b) => String(b?.created_at || "").localeCompare(String(a?.created_at || "")));
    return list;
  }
  if (sort === "cost") {
    list.sort((a, b) => Number(b?.total_cost || 0) - Number(a?.total_cost || 0));
    return list;
  }
  list.sort((a, b) => {
    const da = String(a?.planned_date || a?.start_date || "");
    const db = String(b?.planned_date || b?.start_date || "");
    if (!da && !db) return 0;
    if (!da) return 1;
    if (!db) return -1;
    return da.localeCompare(db);
  });
  return list;
}

export function shortageRows(order) {
  if (order?.status === "completed" || order?.status === "cancelled") return [];
  return (Array.isArray(order?.shortages) ? order.shortages : []).filter((row) => row && (row.product_name || row.shortage != null));
}
