import { useEffect } from "react";

export const useEscape = (onClose) => {
  useEffect(() => { const h = (e) => e.key === "Escape" && onClose?.(); document.addEventListener("keydown", h); return () => document.removeEventListener("keydown", h); }, [onClose]);
};
