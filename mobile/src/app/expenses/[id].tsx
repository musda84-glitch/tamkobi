import { ExpenseFormScreen } from "@/screens/ExpenseFormScreen";
import { useLocalSearchParams } from "expo-router";

export default function ExpenseDetail() {
  const { id } = useLocalSearchParams<{ id: string }>();
  return <ExpenseFormScreen expenseId={id} />;
}
