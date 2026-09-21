import React, { Suspense, lazy } from "react";

const BarcodeScannerModal = lazy(() =>
  import("./BarcodeScannerModal").then((m) => ({ default: m.BarcodeScannerModal }))
);

/** Kamera native modülü stok listesi açılınca yüklenmesin; yalnız barkod okutunca gelsin. */
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
  return (
    <Suspense fallback={null}>
      <BarcodeScannerModal visible onClose={onClose} onScan={onScan} />
    </Suspense>
  );
}
