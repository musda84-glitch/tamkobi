import { Stack } from "expo-router";
import { iconHeaderOptions } from "@/components/StackHeader";
import { WorkFormScreen } from "@/screens/WorkFormScreen";
import { colors } from "@/theme";

export default function QuoteNew() {
  return (
    <>
      <Stack.Screen
        options={iconHeaderOptions({
          title: "Yeni teklif",
          icon: "create",
          color: colors.warning,
          testID: "quote-new-header-title",
          fallback: "/quotes",
        })}
      />
      <WorkFormScreen kind="quote" />
    </>
  );
}
