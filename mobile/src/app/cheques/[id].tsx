import { ChequeFormScreen } from "@/screens/ChequeFormScreen";
import { useLocalSearchParams } from "expo-router";

export default function ChequeDetail() {
  const { id } = useLocalSearchParams<{ id: string }>();
  return <ChequeFormScreen chequeId={id} />;
}
