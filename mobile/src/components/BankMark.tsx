import React, { useState } from "react";
import { Image, Text, View } from "react-native";
import type { BankBrand } from "../utils/bankBrand";

export function BankMark({ brand, size = 40 }: { brand: BankBrand; size?: number }) {
  const [failedUri, setFailedUri] = useState("");
  const logoUri = brand.logoUri && failedUri !== brand.logoUri ? brand.logoUri : "";
  if (logoUri) {
    return (
      <View
        testID={`bank-mark-${brand.key}`}
        style={{
          width: size,
          height: size,
          borderRadius: 10,
          backgroundColor: "#fff",
          alignItems: "center",
          justifyContent: "center",
          overflow: "hidden",
        }}
      >
        <Image
          testID={`bank-mark-image-${brand.key}`}
          source={{ uri: logoUri }}
          style={{ width: size, height: size }}
          resizeMode="contain"
          onError={() => setFailedUri(logoUri)}
        />
      </View>
    );
  }
  return (
    <View
      testID={`bank-mark-${brand.key}`}
      style={{
        width: size,
        height: size,
        borderRadius: 10,
        backgroundColor: brand.solid,
        alignItems: "center",
        justifyContent: "center",
      }}
    >
      <Text
        style={{
          color: "#fff",
          fontWeight: "900",
          fontSize: brand.initials.length > 2 ? size * 0.28 : size * 0.34,
          letterSpacing: -0.3,
        }}
      >
        {brand.initials}
      </Text>
    </View>
  );
}
