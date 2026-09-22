import React, { useState } from "react";
import { Image, Platform, Text, View } from "react-native";
import { displayFileUrl } from "../api/client";
import { useAuth } from "../auth/AuthContext";
import { employeeInitials } from "../utils/personnel";

export function EmployeeAvatar({
  name,
  photoUrl,
  size = 48,
  testID,
}: {
  name?: string | null;
  photoUrl?: string | null;
  size?: number;
  testID?: string;
}) {
  const { client } = useAuth();
  const src = displayFileUrl(client.baseUrl, photoUrl, Platform.OS === "web");
  const [failed, setFailed] = useState(false);
  return (
    <View
      testID={testID}
      accessibilityLabel={name ? `${name} fotoğrafı` : "Personel fotoğrafı"}
      style={{
        width: size,
        height: size,
        borderRadius: 14,
        backgroundColor: "#0F172A",
        alignItems: "center",
        justifyContent: "center",
        overflow: "hidden",
        flexShrink: 0,
      }}
    >
      {src && !failed ? (
        <Image
          source={{ uri: src }}
          style={{ width: size, height: size }}
          resizeMode="cover"
          onError={() => setFailed(true)}
        />
      ) : (
        <Text style={{ color: "#fff", fontWeight: "900", fontSize: size * 0.34 }}>
          {employeeInitials(name)}
        </Text>
      )}
    </View>
  );
}
