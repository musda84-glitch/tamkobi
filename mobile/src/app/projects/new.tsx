import { Stack } from "expo-router";
import { iconHeaderOptions } from "@/components/StackHeader";
import { WorkFormScreen } from "@/screens/WorkFormScreen";
import { colors } from "@/theme";

export default function ProjectNew() {
  return (
    <>
      <Stack.Screen
        options={iconHeaderOptions({
          title: "Yeni proje",
          icon: "briefcase",
          color: colors.indigo,
          testID: "project-new-header-title",
          fallback: "/projects",
        })}
      />
      <WorkFormScreen kind="project" />
    </>
  );
}
