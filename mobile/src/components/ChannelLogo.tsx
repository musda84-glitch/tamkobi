import { Ionicons } from "@expo/vector-icons";
import React, { createElement, useState } from "react";
import { Image, Platform, View } from "react-native";
import { colors, radius } from "../theme";
import { channelLogoUrl, channelTr, isMarketplaceChannel } from "../utils/labels";

const ICONS: Record<string, keyof typeof Ionicons.glyphMap> = {
  b2b: "globe-outline",
  saha: "walk-outline",
  shopphp: "storefront-outline",
  manual: "person-outline",
};

export function ChannelLogo({
  channel,
  size = 36,
  testID,
}: {
  channel?: string | null;
  size?: number;
  testID?: string;
}) {
  const key = String(channel || "").toLowerCase();
  const url = channelLogoUrl(key);
  const label = channelTr(key);
  const [failed, setFailed] = useState(false);
  const box = {
    width: size,
    height: size,
    minWidth: size,
    minHeight: size,
    borderRadius: radius.md,
    borderWidth: 1,
    borderColor: colors.border,
    backgroundColor: "#fff",
    alignItems: "center" as const,
    justifyContent: "center" as const,
    overflow: "hidden" as const,
    padding: 3,
  };

  if (url && !failed) {
    if (Platform.OS === "web") {
      return createElement("img", {
        src: url,
        alt: label,
        title: label,
        "data-testid": testID,
        style: { width: size, height: size, objectFit: "contain", borderRadius: 8, border: `1px solid ${colors.border}`, background: "#fff", padding: 3, boxSizing: "border-box" },
      });
    }
    return (
      <View testID={testID} style={box} accessibilityLabel={label}>
        <Image
          source={{ uri: url }}
          style={{ width: size - 6, height: size - 6 }}
          resizeMode="contain"
          onError={() => setFailed(true)}
        />
      </View>
    );
  }

  return (
    <View testID={testID} style={box} accessibilityLabel={label}>
      <Ionicons
        name={ICONS[key] || (isMarketplaceChannel(key) ? "bag-outline" : "cart-outline")}
        size={Math.round(size * 0.48)}
        color={isMarketplaceChannel(key) ? "#EA580C" : colors.muted}
      />
    </View>
  );
}
