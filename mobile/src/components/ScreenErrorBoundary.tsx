import React from "react";
import { Text, View } from "react-native";
import { colors } from "../theme";

/** Üretim APK’da yakalanmamış JS hatası aktiviteyi öldürmesin. */
export class ScreenErrorBoundary extends React.Component<
  { title?: string; children: React.ReactNode },
  { message: string | null }
> {
  state: { message: string | null } = { message: null };

  static getDerivedStateFromError(err: Error): { message: string } {
    return { message: err?.message || "Bilinmeyen hata" };
  }

  render() {
    if (!this.state.message) return this.props.children;
    return (
      <View testID="screen-error" style={{ padding: 16, gap: 8 }}>
        <Text style={{ fontWeight: "800", color: colors.text }}>{this.props.title || "Ekran açılamadı"}</Text>
        <Text style={{ color: colors.muted }}>{this.state.message}</Text>
      </View>
    );
  }
}
