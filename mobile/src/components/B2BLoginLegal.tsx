import React, { useState } from "react";
import { Pressable, Text, View } from "react-native";
import { apiErrorMessage } from "../api/errors";
import { get } from "../api/client";
import { colors, typeface } from "../theme";
import {
  LOGIN_LEGAL_DOCS,
  isLoginLegalAccepted,
  toggleLoginLegalAccept,
  type LegalAcceptMap,
} from "../utils/b2bLegal";
import { B2BSheet } from "./b2b/B2BSheet";

export function B2BLoginLegal({
  accepted,
  onChange,
  baseUrl,
}: {
  accepted: LegalAcceptMap;
  onChange: (next: LegalAcceptMap) => void;
  baseUrl: string;
}) {
  const [doc, setDoc] = useState<{ title: string; text: string } | null>(null);
  const [err, setErr] = useState<string | null>(null);

  const open = async (slug: string, title: string) => {
    try {
      const data = await get<{ title?: string; text?: string }>({ baseUrl, token: null }, `/public/legal/${slug}`);
      setDoc({ title: data.title || title, text: data.text || "" });
      setErr(null);
    } catch (e) {
      setErr(apiErrorMessage(e, "Sözleşme açılamadı."));
    }
  };

  return (
    <View
      testID="b2b-login-legal"
      style={{
        gap: 8,
        padding: 10,
        borderRadius: 12,
        borderWidth: 1,
        borderColor: colors.border,
        backgroundColor: colors.slate50,
        marginBottom: 12,
      }}
    >
      {LOGIN_LEGAL_DOCS.map((d) => {
        const checked = isLoginLegalAccepted(accepted, d.slug);
        return (
          <View key={d.slug} style={{ flexDirection: "row", alignItems: "flex-start", gap: 8 }}>
            <Pressable
              onPress={() => onChange(toggleLoginLegalAccept(accepted, d.slug))}
              testID={`b2b-login-legal-${d.slug}`}
              accessibilityRole="checkbox"
              accessibilityState={{ checked }}
              hitSlop={8}
              style={{
                width: 18,
                height: 18,
                borderRadius: 4,
                borderWidth: 1.5,
                borderColor: checked ? colors.primary : colors.border,
                backgroundColor: checked ? colors.primary : "#fff",
                alignItems: "center",
                justifyContent: "center",
                marginTop: 1,
              }}
            >
              {checked ? <Text style={{ color: "#fff", fontSize: 12, lineHeight: 14, ...typeface("800") }}>✓</Text> : null}
            </Pressable>
            <Pressable onPress={() => open(d.slug, d.label)} testID={`b2b-login-legal-link-${d.slug}`} style={{ flex: 1, minWidth: 0 }}>
              <Text style={{ color: colors.indigo, fontSize: 12, ...typeface("700") }}>{d.label}</Text>
              <Text style={{ color: colors.muted, fontSize: 11, marginTop: 2, ...typeface("400") }}>
                okudum ve kabul ediyorum
              </Text>
            </Pressable>
          </View>
        );
      })}
      {err ? (
        <Text testID="b2b-login-legal-error" style={{ color: colors.danger, fontSize: 11, ...typeface("700") }}>
          {err}
        </Text>
      ) : null}
      <B2BSheet visible={!!doc} title={doc?.title || "Sözleşme"} onClose={() => setDoc(null)} testID="b2b-login-legal-sheet">
        <Text style={{ color: colors.text, fontSize: 13, lineHeight: 20 }}>{doc?.text}</Text>
      </B2BSheet>
    </View>
  );
}
