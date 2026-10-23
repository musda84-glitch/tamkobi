/** Atölye kartı: istasyon (soğuk, dolu etiket) ve proje (sıcak kenar) renkleri, etiketler, liste süzgeci.
 *  Renk sırası mockup ile aynı: SHA1(ad) % palet. İstasyon adı Python casefold ile katlanır.
 */

const STATION_PALETTE = [
  { id: "cyan", bg: "#0e7490", fg: "#ffffff", className: "bg-cyan-700 text-white" },
  { id: "indigo", bg: "#4338ca", fg: "#ffffff", className: "bg-indigo-700 text-white" },
  { id: "sky", bg: "#0369a1", fg: "#ffffff", className: "bg-sky-700 text-white" },
  { id: "teal", bg: "#0f766e", fg: "#ffffff", className: "bg-teal-700 text-white" },
  { id: "violet", bg: "#6d28d9", fg: "#ffffff", className: "bg-violet-700 text-white" },
  { id: "blue", bg: "#1d4ed8", fg: "#ffffff", className: "bg-blue-700 text-white" },
];

const PROJECT_PALETTE = [
  { id: "h0", stripe: "hsl(0 70% 38%)", wash: "hsl(0 70% 94%)", className: "border-l-rose-700" },
  { id: "h30", stripe: "hsl(30 70% 38%)", wash: "hsl(30 70% 94%)", className: "border-l-orange-700" },
  { id: "h48", stripe: "hsl(48 70% 38%)", wash: "hsl(48 70% 94%)", className: "border-l-amber-600" },
  { id: "h330", stripe: "hsl(330 70% 38%)", wash: "hsl(330 70% 94%)", className: "border-l-pink-800" },
  { id: "h80", stripe: "hsl(80 70% 38%)", wash: "hsl(80 70% 94%)", className: "border-l-lime-700" },
];

const PROJECT_NEUTRAL = { id: "neutral", stripe: "#cbd5e1", wash: "#f1f5f9", className: "border-l-slate-300" };

const STATION_BANNER_NEUTRAL = { id: "neutral", bg: "#f1f5f9", fg: "#475569", className: "bg-slate-100 text-slate-600" };

function linkText(value) {
  return String(value ?? "").trim();
}

function utf8Bytes(value) {
  return new TextEncoder().encode(String(value));
}

function rotl(n, s) {
  return ((n << s) | (n >>> (32 - s))) >>> 0;
}

function sha1Hex(bytes) {
  const ml = bytes.length;
  const bitLen = ml * 8;
  const pad = (56 - ((ml + 1) % 64) + 64) % 64;
  const data = new Uint8Array(ml + 1 + pad + 8);
  data.set(bytes);
  data[ml] = 0x80;
  const view = new DataView(data.buffer);
  view.setUint32(data.length - 4, bitLen >>> 0);
  let h0 = 0x67452301;
  let h1 = 0xefcdab89;
  let h2 = 0x98badcfe;
  let h3 = 0x10325476;
  let h4 = 0xc3d2e1f0;
  const w = new Uint32Array(80);
  for (let i = 0; i < data.length; i += 64) {
    for (let t = 0; t < 16; t += 1) w[t] = view.getUint32(i + t * 4);
    for (let t = 16; t < 80; t += 1) w[t] = rotl(w[t - 3] ^ w[t - 8] ^ w[t - 14] ^ w[t - 16], 1);
    let a = h0;
    let b = h1;
    let c = h2;
    let d = h3;
    let e = h4;
    for (let t = 0; t < 80; t += 1) {
      let f;
      let k;
      if (t < 20) {
        f = (b & c) | (~b & d);
        k = 0x5a827999;
      } else if (t < 40) {
        f = b ^ c ^ d;
        k = 0x6ed9eba1;
      } else if (t < 60) {
        f = (b & c) | (b & d) | (c & d);
        k = 0x8f1bbcdc;
      } else {
        f = b ^ c ^ d;
        k = 0xca62c1d6;
      }
      const temp = (rotl(a, 5) + f + e + k + w[t]) >>> 0;
      e = d;
      d = c;
      c = rotl(b, 30);
      b = a;
      a = temp;
    }
    h0 = (h0 + a) >>> 0;
    h1 = (h1 + b) >>> 0;
    h2 = (h2 + c) >>> 0;
    h3 = (h3 + d) >>> 0;
    h4 = (h4 + e) >>> 0;
  }
  return [h0, h1, h2, h3, h4].map((n) => n.toString(16).padStart(8, "0")).join("");
}

function hexMod(hex, mod) {
  let acc = 0;
  for (let i = 0; i < hex.length; i += 1) acc = (acc * 16 + parseInt(hex[i], 16)) % mod;
  return acc;
}

/** Python str.casefold() için atölye adlarında gereken katlama (İ → i + birleşik nokta). */
export function shopfloorCasefold(value) {
  return String(value ?? "").replace(/\u0130/g, "i\u0307").replace(/I/g, "i").toLowerCase();
}

function paletteIndex(key, size) {
  return hexMod(sha1Hex(utf8Bytes(key)), size);
}

export function stationColor(name) {
  return STATION_PALETTE[paletteIndex(shopfloorCasefold(linkText(name)), STATION_PALETTE.length)];
}

export function projectColor(id) {
  const key = linkText(id);
  if (!key || key.toLocaleLowerCase("tr") === "none") return PROJECT_NEUTRAL;
  return PROJECT_PALETTE[paletteIndex(key, PROJECT_PALETTE.length)];
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
