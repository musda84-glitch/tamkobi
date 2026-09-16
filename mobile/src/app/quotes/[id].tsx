import { WorkFormScreen } from "@/screens/WorkFormScreen";
import { useLocalSearchParams } from "expo-router";

export default function QuoteDetail() {
  const { id } = useLocalSearchParams<{ id: string }>();
  return <WorkFormScreen kind="quote" docId={id} />;
}
