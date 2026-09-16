import { ProductFormScreen } from "@/screens/ProductFormScreen";
import { useLocalSearchParams } from "expo-router";

export default function StockEditScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  return <ProductFormScreen productId={id} />;
}
