import React from "react";

/** Kamera JS’i stok ilk boyada yüklenmesin; React.lazy üretim APK’da ekranı düşürüyordu. */
export function LazyBarcodeScanner({
  visible,
  onClose,
  onScan,
}: {
  visible: boolean;
  onClose: () => void;
  onScan: (code: string) => void;
}) {
  if (!visible) return null;
  const { BarcodeScannerModal } = require("./BarcodeScannerModal") as typeof import("./BarcodeScannerModal");
  return <BarcodeScannerModal visible onClose={onClose} onScan={onScan} />;
}
