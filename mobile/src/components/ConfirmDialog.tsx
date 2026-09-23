import React, { useEffect, useState } from "react";
import { Modal, Pressable, Text, View } from "react-native";
import { colors, radius, spacing } from "../theme";
import { type ConfirmAsk, bindConfirmHost } from "../utils/confirmDialog";
import { PrimaryButton, Row } from "./kit";

/** Web önizlemede window.confirm görünmez; Sil gibi işlemler bu kartla onaylanır. */
export function ConfirmHost() {
  const [ask, setAsk] = useState<ConfirmAsk | null>(null);

  useEffect(() => {
    bindConfirmHost(setAsk);
    return () => bindConfirmHost(null);
  }, []);

  const finish = (ok: boolean) => {
    const current = ask;
    setAsk(null);
    current?.resolve(ok);
  };

  return (
    <Modal visible={!!ask} transparent animationType="fade" onRequestClose={() => finish(false)}>
      <Pressable
        testID="confirm-dialog-backdrop"
        onPress={() => finish(false)}
        style={{ flex: 1, backgroundColor: "rgba(15,23,42,0.5)", justifyContent: "center", padding: spacing.md }}
      >
        <Pressable
          testID="confirm-dialog"
          onPress={() => { /* kartı açık tut */ }}
          style={{ backgroundColor: "#fff", borderRadius: radius.lg, padding: spacing.md, gap: 10 }}
        >
          <Text style={{ fontWeight: "800", color: colors.text, fontSize: 16 }}>{ask?.title}</Text>
          <Text style={{ color: colors.muted, fontSize: 13, fontWeight: "600", lineHeight: 18 }}>{ask?.message}</Text>
          <Row>
            <View style={{ flex: 1 }}>
              <PrimaryButton title="Vazgeç" onPress={() => finish(false)} color={colors.muted} testID="confirm-dialog-cancel" />
            </View>
            <View style={{ flex: 1 }}>
              <PrimaryButton
                title={ask?.confirmLabel || "Tamam"}
                onPress={() => finish(true)}
                color={colors.danger}
                testID="confirm-dialog-ok"
              />
            </View>
          </Row>
        </Pressable>
      </Pressable>
    </Modal>
  );
}
