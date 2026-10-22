/** Atölye kartı: istasyon (soğuk, dolu etiket) ve proje (sıcak kenar) renkleri.
 *  Renk sırası mockup ile aynı: SHA1(ad) % palet. İstasyon adı Python casefold ile katlanır.
 */

const STATION_PALETTE = [
  { id: "cyan", bg: "#0e7490", fg: "#ffffff" },
  { id: "indigo", bg: "#4338ca", fg: "#ffffff" },
  { id: "sky", bg: "#0369a1", fg: "#ffffff" },
  { id: "teal", bg: "#0f766e", fg: "#ffffff" },
  { id: "violet", bg: "#6d28d9", fg: "#ffffff" },
  { id: "blue", bg: "#1d4ed8", fg: "#ffffff" },
];

const PROJECT_PALETTE = [
  { id: "h0", stripe: "hsl(0 70% 38%)", wash: "hsl(0 70% 94%)" },
  { id: "h30", stripe: "hsl(30 70% 38%)", wash: "hsl(30 70% 94%)" },
  { id: "h48", stripe: "hsl(48 70% 38%)", wash: "hsl(48 70% 94%)" },
  { id: "h330", stripe: "hsl(330 70% 38%)", wash: "hsl(330 70% 94%)" },
  { id: "h80", stripe: "hsl(80 70% 38%)", wash: "hsl(80 70% 94%)" },
];

const PROJECT_NEUTRAL = { id: "neutral", stripe: "#cbd5e1", wash: "#f1f5f9" };

const STATION_BANNER_NEUTRAL = { id: "neutral", bg: "#f1f5f9", fg: "#475569" };

export type StationTone = { id: string; bg: string; fg: string };
export type ProjectTone = { id: string; stripe: string; wash: string };

function linkText(value: unknown): string {
  return String(value ?? "").trim();
}

function utf8Bytes(value: string): Uint8Array {
  if (typeof TextEncoder !== "undefined") return new TextEncoder().encode(value);
  const encoded = encodeURIComponent(value).replace(/%([0-9A-F]{2})/g, (_, hex) => String.fromCharCode(parseInt(hex, 16)));
  const out = new Uint8Array(encoded.length);
  for (let i = 0; i < encoded.length; i += 1) out[i] = encoded.charCodeAt(i);
  return out;
}

function rotl(n: number, s: number): number {
  return ((n << s) | (n >>> (32 - s))) >>> 0;
}

function sha1Hex(bytes: Uint8Array): string {
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
      let f: number;
      let k: number;
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

function hexMod(hex: string, mod: number): number {
  let acc = 0;
  for (let i = 0; i < hex.length; i += 1) acc = (acc * 16 + parseInt(hex[i], 16)) % mod;
  return acc;
}

/** Python str.casefold() için atölye adlarında gereken katlama (İ → i + birleşik nokta). */
export function shopfloorCasefold(value: unknown): string {
  return String(value ?? "").replace(/\u0130/g, "i\u0307").replace(/I/g, "i").toLowerCase();
}

function paletteIndex(key: string, size: number): number {
  return hexMod(sha1Hex(utf8Bytes(key)), size);
}

export function stationColor(name: unknown): StationTone {
  return STATION_PALETTE[paletteIndex(shopfloorCasefold(linkText(name)), STATION_PALETTE.length)];
}

export function projectColor(id: unknown): ProjectTone {
  const key = linkText(id);
  if (!key || key.toLocaleLowerCase("tr") === "none") return PROJECT_NEUTRAL;
  return PROJECT_PALETTE[paletteIndex(key, PROJECT_PALETTE.length)];
}

export function stationBannerColor(label: unknown, key?: string): StationTone {
  if (key === "_none" || !linkText(label)) return STATION_BANNER_NEUTRAL;
  return stationColor(label);
}

export function cardTitle(w?: { recipe_name?: unknown; product_name?: unknown; step_name?: unknown } | null): {
  text: string;
  source: "recipe" | "step" | "product";
  product: string;
  step: string;
} {
  const recipe = linkText(w?.recipe_name);
  const product = linkText(w?.product_name);
  const step = linkText(w?.step_name);
  if (recipe) return { text: recipe, source: "recipe", product, step };
  if (step) return { text: step, source: "step", product, step };
  return { text: product, source: "product", product, step };
}

export type CardTag = { kind: "project" | "order" | "customer"; label: string };

export function cardTags(w?: {
  project_number?: unknown;
  project_name?: unknown;
  sales_order_no?: unknown;
  customer_name?: unknown;
} | null): CardTag[] {
  const tags: CardTag[] = [];
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

function jobCount(value: unknown): number {
  const n = Number(value);
  return Number.isFinite(n) ? n : 0;
}

export function projectFilterLabel(row?: { project_id?: unknown; project_number?: unknown; project_name?: unknown; job_count?: unknown } | null): string {
  const n = jobCount(row?.job_count);
  if (linkText(row?.project_id).toLocaleLowerCase("tr") === "none") return `Projesiz (${n})`;
  const number = linkText(row?.project_number);
  const name = linkText(row?.project_name);
  const head = number && name ? `${number} · ${name}` : (number || name || linkText(row?.project_id) || "Proje");
  return `${head} (${n})`;
}

export function recipeFilterLabel(row?: { recipe_name?: unknown; recipe_id?: unknown; job_count?: unknown } | null): string {
  const n = jobCount(row?.job_count);
  const name = linkText(row?.recipe_name) || linkText(row?.recipe_id) || "Reçete";
  return `${name} (${n})`;
}

export function normalizeShopfloorFilters(data: unknown): { projects: Record<string, unknown>[]; recipes: Record<string, unknown>[] } {
  const src = data && typeof data === "object" && !Array.isArray(data) ? data as { projects?: unknown; recipes?: unknown } : {};
  const projects = (Array.isArray(src.projects) ? src.projects : []).filter((row) => linkText((row as { project_id?: unknown })?.project_id));
  const recipes = (Array.isArray(src.recipes) ? src.recipes : []).filter((row) => linkText((row as { recipe_id?: unknown })?.recipe_id));
  return { projects: projects as Record<string, unknown>[], recipes: recipes as Record<string, unknown>[] };
}

/** Sunucu süzgecinin istemci yedeği. project_id=none → projesiz. Boş parametre süzmez. */
export function matchesLinkFilter(row: { project_id?: unknown; recipe_id?: unknown } | null | undefined, projectId?: unknown, recipeId?: unknown): boolean {
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

export { PROJECT_NEUTRAL, PROJECT_PALETTE, STATION_PALETTE };
