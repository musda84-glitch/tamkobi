import { ScreenErrorBoundary } from "@/components/ScreenErrorBoundary";
import { StockScreen } from "@/screens/StockScreen";

export default function StokTab() {
  return (
    <ScreenErrorBoundary title="Stok açılamadı">
      <StockScreen />
    </ScreenErrorBoundary>
  );
}
