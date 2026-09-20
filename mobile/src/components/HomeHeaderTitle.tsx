import React, { useEffect, useState } from "react";
import { Image, Text, View } from "react-native";
import { colors } from "../theme";
import { companyInitials, greetingLine } from "../utils/greeting";

/** Özet başlığı: firma logosu + selamlama. Logo yoksa firma baş harfleri durur. */
export function HomeHeaderTitle({
  name,
  company,
  logoUrl,
}: {
  name?: string | null;
  company?: string | null;
  logoUrl?: string | null;
}) {
  const greeting = greetingLine(name);
  const [broken, setBroken] = useState(false);
  useEffect(() => { setBroken(false); }, [logoUrl]);
  const showLogo = !!logoUrl && !broken;
  return (
    <View style={{ flexDirection: "row", alignItems: "center", flexShrink: 1, gap: 8, maxWidth: 280 }}>
      {showLogo ? (
        <Image
          testID="home-company-logo"
          accessibilityLabel={`${company || "Firma"} logosu`}
          source={{ uri: logoUrl || "" }}
          onError={() => setBroken(true)}
          resizeMode="contain"
          style={{
            width: 36,
            height: 36,
            borderRadius: 8,
            backgroundColor: "#fff",
            borderWidth: 1,
            borderColor: colors.border,
          }}
        />
      ) : (
        <View
          testID="home-company-logo-fallback"
          style={{
            width: 36,
            height: 36,
            borderRadius: 8,
            backgroundColor: colors.emerald50,
            borderWidth: 1,
            borderColor: colors.border,
            alignItems: "center",
            justifyContent: "center",
          }}
        >
          <Text style={{ fontWeight: "800", fontSize: 12, color: colors.primary }}>{companyInitials(company)}</Text>
        </View>
      )}
      <View style={{ flexShrink: 1, minWidth: 0 }}>
        <Text style={{ color: colors.text, fontSize: 13, fontWeight: "800" }} numberOfLines={1}>
          {greeting}
        </Text>
        <Text style={{ color: colors.muted, fontSize: 10 }} numberOfLines={1}>
          {company || "TamKobi"}
        </Text>
      </View>
    </View>
  );
}
