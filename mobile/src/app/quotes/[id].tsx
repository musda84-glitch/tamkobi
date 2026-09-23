import { Stack, useLocalSearchParams } from "expo-router";
import { iconHeaderOptions } from "@/components/StackHeader";
import { WorkFormScreen } from "@/screens/WorkFormScreen";
import { colors } from "@/theme";

export default function QuoteDetail() {
  const { id } = useLocalSearchParams<{ id: string }>();
  return (
    <>
      <Stack.Screen
        options={iconHeaderOptions({
          title: "Teklif",
          icon: "create",
          color: colors.warning,
          testID: "quote-header-title",
          fallback: "/quotes",
        })}
      />
      <WorkFormScreen kind="quote" docId={id} />
    </>
  );
}
