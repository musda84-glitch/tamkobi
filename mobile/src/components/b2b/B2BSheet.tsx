import { Ionicons } from "@expo/vector-icons";
import React from "react";
import { Modal, Pressable, ScrollView, Text, View } from "react-native";
import { colors } from "../../theme";
import { useKeyboardAwareScroll } from "../../utils/useKeyboardAwareScroll";

export function B2BSheet({
  visible,
  title,
  subtitle,
  onClose,
  children,
  header,
  testID,
}: {
  visible: boolean;
  title: string;
  subtitle?: string;
  onClose: () => void;
  children: React.ReactNode;
  header?: React.ReactNode;
  testID?: string;
}) {
  const { keyboardHeight, scrollRef, scrollProps } = useKeyboardAwareScroll(visible);
  return (
    <Modal visible={visible} animationType="slide" transparent onRequestClose={onClose}>
      <Pressable style={{ flex: 1, backgroundColor: "rgba(15,23,42,0.45)", justifyContent: "flex-end" }} onPress={onClose}>
        <Pressable
          testID={testID}
          onPress={() => { /* keep */ }}
          style={{ backgroundColor: "#fff", borderTopLeftRadius: 20, borderTopRightRadius: 20, maxHeight: "92%", padding: 16 }}
        >
          <View style={{ flexDirection: "row", alignItems: "flex-start", marginBottom: 10 }}>
            <View style={{ flex: 1 }}>
              <Text style={{ fontWeight: "800", color: colors.text, fontSize: 16 }}>{title}</Text>
              {subtitle ? <Text style={{ color: colors.muted, fontSize: 12 }}>{subtitle}</Text> : null}
            </View>
            <Pressable onPress={onClose} hitSlop={8} testID={`${testID || "sheet"}-close`}>
              <Ionicons name="close" size={22} color={colors.muted} />
            </Pressable>
          </View>
          {header ? <View style={{ marginBottom: 10 }}>{header}</View> : null}
          <ScrollView
            ref={scrollRef}
            {...scrollProps}
            contentContainerStyle={{ paddingBottom: keyboardHeight > 0 ? keyboardHeight : 8 }}
          >
            {children}
          </ScrollView>
        </Pressable>
      </Pressable>
    </Modal>
  );
}
