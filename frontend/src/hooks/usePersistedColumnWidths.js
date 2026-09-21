import { useRef, useState } from "react";
import { clampColumnWidth, readColumnWidths, writeColumnWidths } from "../utils/columnWidths";

export function usePersistedColumnWidths(tableId, defaults, limits) {
  const [widths, setWidths] = useState(() => readColumnWidths(tableId, defaults, limits));
  const widthsRef = useRef(widths);
  widthsRef.current = widths;

  const onResizeStart = (key, event) => {
    event.preventDefault();
    event.stopPropagation();
    const startX = event.clientX;
    const startW = widthsRef.current[key] ?? defaults[key];
    const min = limits.min?.[key] ?? 48;
    const max = limits.max?.[key] ?? 900;
    const move = (e) => {
      const next = clampColumnWidth(startW + e.clientX - startX, min, max);
      if (next == null) return;
      setWidths((prev) => {
        if (prev[key] === next) return prev;
        const updated = { ...prev, [key]: next };
        widthsRef.current = updated;
        return updated;
      });
    };
    const up = () => {
      window.removeEventListener("pointermove", move);
      window.removeEventListener("pointerup", up);
      writeColumnWidths(tableId, widthsRef.current);
      document.body.style.cursor = "";
      document.body.style.userSelect = "";
    };
    document.body.style.cursor = "col-resize";
    document.body.style.userSelect = "none";
    window.addEventListener("pointermove", move);
    window.addEventListener("pointerup", up);
  };

  return { widths, onResizeStart };
}
