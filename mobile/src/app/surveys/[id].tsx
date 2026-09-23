import { Stack, useLocalSearchParams } from "expo-router";
import { iconHeaderOptions } from "@/components/StackHeader";
import { WorkFormScreen } from "@/screens/WorkFormScreen";

export default function SurveyDetail() {
  const { id } = useLocalSearchParams<{ id: string }>();
  return (
    <>
      <Stack.Screen
        options={iconHeaderOptions({
          title: "Keşif",
          icon: "construct",
          color: "#0EA5E9",
          testID: "survey-header-title",
          fallback: "/surveys",
        })}
      />
      <WorkFormScreen kind="survey" docId={id} />
    </>
  );
}
