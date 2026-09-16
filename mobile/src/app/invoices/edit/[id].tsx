import { InvoiceFormScreen } from "@/screens/InvoiceFormScreen";
import { useLocalSearchParams } from "expo-router";

export default function InvoiceEditScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  return <InvoiceFormScreen invoiceId={id} />;
}
