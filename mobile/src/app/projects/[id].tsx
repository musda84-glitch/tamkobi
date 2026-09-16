import { WorkFormScreen } from "@/screens/WorkFormScreen";
import { useLocalSearchParams } from "expo-router";

export default function ProjectDetail() {
  const { id } = useLocalSearchParams<{ id: string }>();
  return <WorkFormScreen kind="project" docId={id} />;
}
