import { Stack } from "expo-router";
import { iconHeaderOptions } from "@/components/StackHeader";
import { WorkFormScreen } from "@/screens/WorkFormScreen";

export default function SurveyNew() {
  return (
    <>
      <Stack.Screen
        options={iconHeaderOptions({
          title: "Yeni keşif",
          icon: "construct",
          color: "#0EA5E9",
          testID: "survey-new-header-title",
          fallback: "/surveys",
        })}
      />
      <WorkFormScreen kind="survey" />
    </>
  );
}
