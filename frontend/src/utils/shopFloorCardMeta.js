/** Atölye kartı: istasyon (soğuk) ve proje (sıcak) renkleri, etiketler, liste süzgeci. */

const STATION_PALETTE = [
  { id: "blue", bg: "#dbeafe", fg: "#1e40af", className: "bg-blue-100 text-blue-800" },
  { id: "sky", bg: "#e0f2fe", fg: "#075985", className: "bg-sky-100 text-sky-800" },
  { id: "cyan", bg: "#cffafe", fg: "#155e75", className: "bg-cyan-100 text-cyan-800" },
  { id: "teal", bg: "#ccfbf1", fg: "#115e59", className: "bg-teal-100 text-teal-800" },
  { id: "indigo", bg: "#e0e7ff", fg: "#3730a3", className: "bg-indigo-100 text-indigo-800" },
  { id: "violet", bg: "#ede9fe", fg: "#5b21b6", className: "bg-violet-100 text-violet-800" },
  { id: "purple", bg: "#f3e8ff", fg: "#6b21a8", className: "bg-purple-100 text-purple-800" },
];

const PROJECT_PALETTE = [
  { id: "orange", stripe: "#f97316", className: "border-l-orange-500" },
  { id: "amber", stripe: "#f59e0b", className: "border-l-amber-500" },
  { id: "red", stripe: "#ef4444", className: "border-l-red-500" },
  { id: "rose", stripe: "#f43f5e", className: "border-l-rose-500" },
  { id: "pink", stripe: "#ec4899", className: "border-l-pink-500" },
];

const PROJECT_NEUTRAL = { id: "neutral", stripe: "#cbd5e1", className: "border-l-slate-300" };

const STATION_BANNER_NEUTRAL = { id: "neutral", bg: "#f1f5f9", fg: "#475569", className: "bg-slate-100 text-slate-600" };

function linkText(value) {
  return String(value ?? "").trim();
}

function hashString(value) {
  const s = String(value);
  let h = 2166136261;
  for (let i = 0; i < s.length; i += 1) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return h >>> 0;
}

function pick(palette, key) {
  return palette[hashString(key) % palette.length];
}

export function stationColor(name) {
  return pick(STATION_PALETTE, linkText(name).toLocaleLowerCase("tr"));
}

export function projectColor(id) {
  const key = linkText(id);
  if (!key || key.toLocaleLowerCase("tr") === "none") return PROJECT_NEUTRAL;
  return pick(PROJECT_PALETTE, key);
}

export function stationBannerColor(label, key) {
  if (key === "_none" || !linkText(label)) return STATION_BANNER_NEUTRAL;
  return stationColor(label);
}

/** Reçete adı büyük başlık; yoksa mevcut adım, o da yoksa ürün adı. */
export function cardTitle(w) {
  const recipe = linkText(w?.recipe_name);
  const product = linkText(w?.product_name);
  const step = linkText(w?.step_name);
  if (recipe) return { text: recipe, source: "recipe", product, step };
  if (step) return { text: step, source: "step", product, step };
  return { text: product, source: "product", product, step };
}

export function cardTags(w) {
  const tags = [];
  const number = linkText(w?.project_number);
  const name = linkText(w?.project_name);
  const project = number && name ? `${number} · ${name}` : (number || name);
  if (project) tags.push({ kind: "project", label: project });
  const order = linkText(w?.sales_order_no);
  if (order) tags.push({ kind: "order", label: order });
  const customer = linkText(w?.customer_name);
  if (customer) tags.push({ kind: "customer", label: customer });
  return tags;
}

function jobCount(value) {
  const n = Number(value);
  return Number.isFinite(n) ? n : 0;
}

export function projectFilterLabel(row) {
  const n = jobCount(row?.job_count);
  if (linkText(row?.project_id).toLocaleLowerCase("tr") === "none") return `Projesiz (${n})`;
  const number = linkText(row?.project_number);
  const name = linkText(row?.project_name);
  const head = number && name ? `${number} · ${name}` : (number || name || linkText(row?.project_id) || "Proje");
  return `${head} (${n})`;
}

export function recipeFilterLabel(row) {
  const n = jobCount(row?.job_count);
  const name = linkText(row?.recipe_name) || linkText(row?.recipe_id) || "Reçete";
  return `${name} (${n})`;
}

export function normalizeShopfloorFilters(data) {
  const src = data && typeof data === "object" && !Array.isArray(data) ? data : {};
  const projects = (Array.isArray(src.projects) ? src.projects : []).filter((row) => linkText(row?.project_id));
  const recipes = (Array.isArray(src.recipes) ? src.recipes : []).filter((row) => linkText(row?.recipe_id));
  return { projects, recipes };
}

/** Sunucu süzgecinin istemci yedeği. project_id=none → projesiz. Boş parametre süzmez. */
export function matchesLinkFilter(row, projectId, recipeId) {
  const wantProject = linkText(projectId);
  if (wantProject) {
    const have = linkText(row?.project_id);
    if (wantProject.toLocaleLowerCase("tr") === "none") {
      if (have) return false;
    } else if (have !== wantProject) return false;
  }
  const wantRecipe = linkText(recipeId);
  if (wantRecipe && linkText(row?.recipe_id) !== wantRecipe) return false;
  return true;
}

export function workOrderListQuery({ companyId, station, projectId, recipeId, status, bust } = {}) {
  const parts = [`company_id=${encodeURIComponent(companyId || "")}`];
  const stationName = linkText(station);
  const statusName = linkText(status);
  const project = linkText(projectId);
  const recipe = linkText(recipeId);
  if (stationName) parts.push(`station=${encodeURIComponent(stationName)}`);
  if (statusName) parts.push(`status=${encodeURIComponent(statusName)}`);
  if (project) parts.push(`project_id=${encodeURIComponent(project)}`);
  if (recipe) parts.push(`recipe_id=${encodeURIComponent(recipe)}`);
  if (bust) parts.push(String(bust).startsWith("_=") ? String(bust) : `_=${bust}`);
  return parts.join("&");
}

export function shopfloorFiltersQuery({ companyId, station } = {}) {
  const parts = [];
  if (linkText(companyId)) parts.push(`company_id=${encodeURIComponent(linkText(companyId))}`);
  if (linkText(station)) parts.push(`station=${encodeURIComponent(linkText(station))}`);
  return parts.join("&");
}

export { PROJECT_NEUTRAL, PROJECT_PALETTE, STATION_PALETTE };
