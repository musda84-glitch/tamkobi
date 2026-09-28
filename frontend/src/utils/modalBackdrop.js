/**
 * Modal backdrop dismiss helpers.
 *
 * Browsers fire a click on the element under mouseup. Selecting text (esp.
 * right-to-left) often starts inside an input and ends on the dimmed overlay,
 * which would otherwise close the modal. Only dismiss when the press also
 * started on the backdrop itself.
 */

/** @returns {{ onMouseDown: Function, onClick: Function }} */
export function backdropDismissProps(onClose) {
  let pressedOnBackdrop = false;
  return {
    onMouseDown(e) {
      pressedOnBackdrop = e.target === e.currentTarget;
    },
    onClick(e) {
      if (!pressedOnBackdrop || e.target !== e.currentTarget) {
        pressedOnBackdrop = false;
        return;
      }
      pressedOnBackdrop = false;
      if (typeof onClose === "function") onClose(e);
    },
  };
}

/** True when the user has a non-empty text selection (drag-select in progress/done). */
export function hasTextSelection() {
  if (typeof window === "undefined" || !window.getSelection) return false;
  const sel = window.getSelection();
  return !!(sel && !sel.isCollapsed && String(sel).length > 0);
}
