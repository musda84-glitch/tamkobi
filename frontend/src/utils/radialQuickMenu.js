const INTERACTIVE_SEL = [
  "a",
  "button",
  "input",
  "select",
  "textarea",
  "label",
  "summary",
  "option",
  "[role='button']",
  "[role='menuitem']",
  "[role='option']",
  "[role='link']",
  "[role='tab']",
  "[contenteditable='true']",
  "[data-no-radial]",
  "[data-radix-collection-item]",
  "[data-radix-menu-content]",
  "[data-radix-dropdown-menu-content]",
  "[data-testid^='ctx-']",
  "[data-testid*='context-menu']",
].join(",");

export const RADIAL_ENABLED_KEY = "radial_quick_menu";
export const RADIAL_SLOTS_KEY = "radial_slots";
export const RADIAL_SLOT_COUNT = 8;

/** Quick operations that are not plain sidebar navigation. */
export const SPECIAL_ACTIONS = [
  { id: "action:invoice-new", label: "Yeni Fatura", pathHint: "/invoices", tone: "emerald", href: "/invoices?new=true" },
  { id: "action:contact-new", label: "Yeni Cari", pathHint: "/contacts", tone: "sky", href: null },
  { id: "action:order-new", label: "Yeni Sipariş", pathHint: "/orders", tone: "amber", href: "/orders?new=1" },
  { id: "action:barcode", label: "Barkod Oku", pathHint: "/stock", tone: "indigo", href: "/stock?scan=true" },
  { id: "action:virman", label: "Virman", pathHint: "/banking", tone: "teal", href: "/banking?action=virman" },
];

export const DEFAULT_RADIAL_SLOTS = [
  "/panel",
  "action:invoice-new",
  "action:contact-new",
  "action:order-new",
  "action:barcode",
  "action:virman",
  "/hizli-satis",
  "/ai-advisor",
];

const TONES = ["slate", "emerald", "sky", "amber", "indigo", "teal", "orange", "violet"];

/** True when right-click target is empty panel surface (not a control). */
export function isRadialBlankTarget(target) {
  if (!(target instanceof Element)) return false;
  if (target.closest("[data-testid='radial-quick-menu']")) return false;
  if (target.closest("[data-testid='radial-quick-menu-controls']")) return false;
  if (target.closest(INTERACTIVE_SEL)) return false;
  return true;
}

export function normalizeRadialSlots(raw) {
  const src = Array.isArray(raw) ? raw : DEFAULT_RADIAL_SLOTS;
  const out = [];
  for (let i = 0; i < RADIAL_SLOT_COUNT; i += 1) {
    const v = src[i];
    out.push(typeof v === "string" ? v : "");
  }
  return out;
}

export function loadRadialSlots() {
  try {
    const raw = JSON.parse(localStorage.getItem(RADIAL_SLOTS_KEY) || "null");
    if (!raw) return [...DEFAULT_RADIAL_SLOTS];
    return normalizeRadialSlots(raw);
  } catch {
    return [...DEFAULT_RADIAL_SLOTS];
  }
}

export function saveRadialSlotsLocal(slots) {
  const normalized = normalizeRadialSlots(slots);
  try { localStorage.setItem(RADIAL_SLOTS_KEY, JSON.stringify(normalized)); } catch { /* ignore */ }
  return normalized;
}

export function toneForIndex(i) {
  return TONES[i % TONES.length];
}

export function specialById(id) {
  return SPECIAL_ACTIONS.find((a) => a.id === id) || null;
}

/**
 * Build selectable options: special quick ops + visible sidebar menu paths.
 * @param {Array<{path:string,label:string}>} menuItems
 */
export function radialTaskOptions(menuItems) {
  const special = SPECIAL_ACTIONS.map((a) => ({
    value: a.id,
    label: `⚡ ${a.label}`,
    group: "Hızlı işlem",
  }));
  const menu = (menuItems || []).map((m) => ({
    value: m.path,
    label: m.label,
    group: "Genel menü",
  }));
  return [...special, ...menu];
}
