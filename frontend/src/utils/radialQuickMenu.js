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

/** True when right-click target is empty panel surface (not a control). */
export function isRadialBlankTarget(target) {
  if (!(target instanceof Element)) return false;
  if (target.closest("[data-testid='radial-quick-menu']")) return false;
  if (target.closest("[data-testid='radial-quick-menu-controls']")) return false;
  if (target.closest(INTERACTIVE_SEL)) return false;
  return true;
}
