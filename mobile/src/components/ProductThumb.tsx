import { Ionicons } from "@expo/vector-icons";
import React, { useState } from "react";
import { Image, Platform, View } from "react-native";
import { displayFileUrl } from "../api/client";
import { useAuth } from "../auth/AuthContext";
import { colors, radius } from "../theme";
import { listSafeThumb } from "../utils/productDisplay";

export function ProductThumb({
  uri,
  size = 56,
  testID,
}: {
  uri: string;
  size?: number;
  testID?: string;
}) {
  const { client } = useAuth();
  const src = displayFileUrl(client.baseUrl, listSafeThumb(uri), Platform.OS === "web");
  const [failed, setFailed] = useState(false);
  const box = {
    width: size,
    height: size,
    minWidth: size,
    minHeight: size,
    flexShrink: 0,
    borderRadius: radius.md,
    borderWidth: 1,
    borderColor: colors.border,
    backgroundColor: colors.slate100,
    alignItems: "center" as const,
    justifyContent: "center" as const,
    overflow: "hidden" as const,
  };
  if (!src || failed) {
    return (
      <View testID={testID} style={box} accessibilityLabel="Ürün görseli yok">
        <Ionicons name="image-outline" size={Math.round(size * 0.42)} color={colors.muted} />
      </View>
    );
  }
  return (
    <View testID={testID} style={box} accessibilityLabel="Ürün görseli">
      <Image
        source={{ uri: src }}
        style={{ width: size, height: size }}
        resizeMode="cover"
        onError={() => setFailed(true)}
      />
    </View>
  );
}
