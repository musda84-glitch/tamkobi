import { Ionicons } from "@expo/vector-icons";
import { Image } from "expo-image";
import React from "react";
import { View } from "react-native";
import { fileUrl } from "../api/client";
import { useAuth } from "../auth/AuthContext";
import { colors, radius } from "../theme";

export function ProductThumb({ uri, size = 46 }: { uri: string; size?: number }) {
  const { client } = useAuth();
  const box = {
    width: size,
    height: size,
    borderRadius: radius.md,
    borderWidth: 1,
    borderColor: colors.border,
    backgroundColor: colors.slate100,
    alignItems: "center" as const,
    justifyContent: "center" as const,
    overflow: "hidden" as const,
  };
  if (!uri) {
    return (
      <View style={box}>
        <Ionicons name="image-outline" size={Math.round(size * 0.42)} color={colors.muted} />
      </View>
    );
  }
  return (
    <View style={box}>
      <Image source={{ uri: fileUrl(client.baseUrl, uri) }} style={{ width: "100%", height: "100%" }} contentFit="cover" transition={120} />
    </View>
  );
}
