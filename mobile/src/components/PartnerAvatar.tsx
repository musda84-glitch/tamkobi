import React, { useState } from "react";
import { Image, Platform, Pressable, Text, View } from "react-native";
import { displayFileUrl } from "../api/client";
import { useAuth } from "../auth/AuthContext";
import type { AccountGroupTone } from "../utils/finance";
import { partnerInitials } from "../utils/finance";

export function PartnerAvatar({
  name,
  photoUrl,
  tone,
  size = 48,
  testID,
  onPress,
}: {
  name?: string | null;
  photoUrl?: string | null;
  tone: AccountGroupTone;
  size?: number;
  testID?: string;
  onPress?: () => void;
}) {
  const { client } = useAuth();
  const src = displayFileUrl(client.baseUrl, photoUrl, Platform.OS === "web");
  const [failed, setFailed] = useState(false);
  const box = {
    width: size,
    height: size,
    borderRadius: size / 2,
    backgroundColor: tone.accent,
    alignItems: "center" as const,
    justifyContent: "center" as const,
    overflow: "hidden" as const,
    flexShrink: 0,
  };
  const inner = src && !failed ? (
    <Image
      source={{ uri: src }}
      style={{ width: size, height: size }}
      resizeMode="cover"
      onError={() => setFailed(true)}
    />
  ) : (
    <Text style={{ color: "#fff", fontWeight: "900", fontSize: size * 0.34 }}>{partnerInitials(name)}</Text>
  );
  if (onPress) {
    return (
      <Pressable testID={testID} onPress={onPress} style={box}>
        {inner}
      </Pressable>
    );
  }
  return <View testID={testID} style={box}>{inner}</View>;
}
