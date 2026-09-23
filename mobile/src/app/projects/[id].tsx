import { Stack, useLocalSearchParams } from "expo-router";
import { iconHeaderOptions } from "@/components/StackHeader";
import { WorkFormScreen } from "@/screens/WorkFormScreen";
import { colors } from "@/theme";

export default function ProjectDetail() {
  const { id } = useLocalSearchParams<{ id: string }>();
  return (
    <>
      <Stack.Screen
        options={iconHeaderOptions({
          title: "Proje",
          icon: "briefcase",
          color: colors.indigo,
          testID: "project-header-title",
          fallback: "/projects",
        })}
      />
      <WorkFormScreen kind="project" docId={id} />
    </>
  );
}
