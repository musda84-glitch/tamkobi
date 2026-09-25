import { Ionicons } from "@expo/vector-icons";
import type { ReactNode } from "react";
import { Pressable, Text, View } from "react-native";
import {
  requestActionLook,
  requestDecisionActions,
  type PendingRequest,
  type RequestDecision,
} from "../utils/personnel";

export function RequestDecisionButtons({
  item,
  settled,
  busy,
  testIDFor,
  onDecide,
  children,
}: {
  item: PendingRequest;
  settled?: RequestDecision | null;
  busy?: boolean;
  testIDFor: (btn: { key: string }) => string;
  onDecide: (decision: RequestDecision) => void;
  children?: ReactNode;
}) {
  const locked = settled != null || !!busy;
  return (
    <View style={{ flexDirection: "row", flexWrap: "wrap", gap: 8 }}>
      {requestDecisionActions(item.kind).map((btn) => {
        const look = requestActionLook(btn, settled);
        return (
          <Pressable
            key={btn.key}
            testID={testIDFor(btn)}
            accessibilityLabel={look.title}
            accessibilityRole="button"
            disabled={locked}
            onPress={() => onDecide(btn.decision)}
            style={{
              minHeight: 44,
              paddingHorizontal: 12,
              borderRadius: 12,
              backgroundColor: look.color,
              opacity: look.muted || busy ? 0.55 : 1,
              flexDirection: "row",
              alignItems: "center",
              justifyContent: "center",
              gap: 6,
            }}
          >
            {look.icon ? (
              <Ionicons
                name={look.icon}
                size={16}
                color="#fff"
                testID={`${testIDFor(btn)}-icon`}
              />
            ) : null}
            <Text style={{ color: "#fff", fontWeight: "800", fontSize: 13 }}>{look.title}</Text>
          </Pressable>
        );
      })}
      {children}
    </View>
  );
}
