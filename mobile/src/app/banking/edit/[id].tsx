import { BankingAccountFormScreen } from "@/screens/BankingAccountFormScreen";
import { useLocalSearchParams } from "expo-router";

export default function BankingEdit() {
  const { id } = useLocalSearchParams<{ id: string }>();
  return <BankingAccountFormScreen accountId={id} />;
}
