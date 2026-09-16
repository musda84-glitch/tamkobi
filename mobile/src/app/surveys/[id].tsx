import { WorkFormScreen } from "@/screens/WorkFormScreen";
import { useLocalSearchParams } from "expo-router";

export default function SurveyDetail() {
  const { id } = useLocalSearchParams<{ id: string }>();
  return <WorkFormScreen kind="survey" docId={id} />;
}
