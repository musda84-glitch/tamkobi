import { Ionicons } from "@expo/vector-icons";
import { router, type Href } from "expo-router";
import { Pressable, Text, View } from "react-native";
import { colors } from "../theme";
import { headerBackAction } from "../utils/stackHeader";

export function HeaderBack({ fallback = "/" as Href }: { fallback?: Href }) {
  return (
    <Pressable
      testID="header-back"
      onPress={() => {
        const next = headerBackAction(router.canGoBack(), String(fallback));
        if (next === "back") router.back();
        else router.replace(next as Href);
      }}
      hitSlop={12}
      accessibilityRole="button"
      accessibilityLabel="Geri"
      style={{ paddingVertical: 6, paddingRight: 4, paddingLeft: 2 }}
    >
      <Ionicons name="chevron-back" size={26} color={colors.primary} />
    </Pressable>
  );
}

export function HeaderTitle({
  title,
  icon,
  color,
  testID,
}: {
  title: string;
  icon: keyof typeof Ionicons.glyphMap;
  color: string;
  testID: string;
}) {
  return (
    <View testID={testID} style={{ flexDirection: "row", alignItems: "center", gap: 8 }}>
      <Ionicons name={icon} size={22} color={color} />
      <Text style={{ fontWeight: "800", fontSize: 17, color: colors.text }} numberOfLines={1}>{title}</Text>
    </View>
  );
}

export function headerBackOptions(fallback?: Href) {
  return {
    headerBackVisible: false as const,
    headerLeft: () => <HeaderBack fallback={fallback} />,
  };
}

export function iconHeaderOptions(opts: {
  title: string;
  icon: keyof typeof Ionicons.glyphMap;
  color: string;
  testID: string;
  fallback?: Href;
  back?: boolean;
}) {
  return {
    title: opts.title,
    headerTitleAlign: "left" as const,
    ...(opts.back === false
      ? { headerBackVisible: false as const, headerLeft: undefined }
      : headerBackOptions(opts.fallback)),
    headerTitle: () => (
      <HeaderTitle title={opts.title} icon={opts.icon} color={opts.color} testID={opts.testID} />
    ),
  };
}
