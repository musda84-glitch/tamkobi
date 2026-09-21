import { Ionicons } from "@expo/vector-icons";
import React, { useEffect, useRef } from "react";
import { Animated, PanResponder, Pressable, Text, View } from "react-native";
import { colors } from "../theme";

const ACTION_W = 72;
const MENU_W = ACTION_W * 2;

export function SwipeRevealRow({
  rowKey,
  openKey,
  onOpen,
  onEdit,
  onDelete,
  children,
  testID,
}: {
  rowKey: string;
  openKey: string | null;
  onOpen: (key: string | null) => void;
  onEdit: () => void;
  onDelete: () => void;
  children: React.ReactNode;
  testID?: string;
}) {
  const open = openKey === rowKey;
  const pan = useRef(new Animated.Value(open ? -MENU_W : 0)).current;
  const startX = useRef(open ? -MENU_W : 0);
  const openKeyRef = useRef(openKey);
  const onOpenRef = useRef(onOpen);
  openKeyRef.current = openKey;
  onOpenRef.current = onOpen;

  useEffect(() => {
    const to = open ? -MENU_W : 0;
    startX.current = to;
    Animated.spring(pan, { toValue: to, useNativeDriver: true, bounciness: 0, speed: 18 }).start();
  }, [open, pan]);

  const responder = useRef(
    PanResponder.create({
      onMoveShouldSetPanResponder: (_, g) => Math.abs(g.dx) > 10 && Math.abs(g.dx) > Math.abs(g.dy),
      onPanResponderGrant: () => {
        startX.current = openKeyRef.current === rowKey ? -MENU_W : 0;
      },
      onPanResponderMove: (_, g) => {
        const x = Math.min(0, Math.max(-MENU_W, startX.current + g.dx));
        pan.setValue(x);
      },
      onPanResponderRelease: (_, g) => {
        const next = startX.current + g.dx;
        const shouldOpen = next < -MENU_W / 2 || g.vx < -0.4;
        onOpenRef.current(shouldOpen ? rowKey : null);
      },
    })
  ).current;

  return (
    <View testID={testID} style={{ overflow: "hidden" }}>
      <View style={{ position: "absolute", right: 0, top: 0, bottom: 0, flexDirection: "row", width: MENU_W }}>
        <Pressable
          testID={testID ? `${testID}-edit` : undefined}
          onPress={onEdit}
          style={{ width: ACTION_W, alignItems: "center", justifyContent: "center", backgroundColor: colors.indigo }}
        >
          <Ionicons name="create-outline" size={18} color="#fff" />
          <Text style={{ color: "#fff", fontWeight: "800", fontSize: 11, marginTop: 2 }}>Düzenle</Text>
        </Pressable>
        <Pressable
          testID={testID ? `${testID}-del` : undefined}
          onPress={onDelete}
          style={{ width: ACTION_W, alignItems: "center", justifyContent: "center", backgroundColor: colors.danger }}
        >
          <Ionicons name="trash-outline" size={18} color="#fff" />
          <Text style={{ color: "#fff", fontWeight: "800", fontSize: 11, marginTop: 2 }}>Sil</Text>
        </Pressable>
      </View>
      <Animated.View
        {...responder.panHandlers}
        style={{ backgroundColor: colors.background, transform: [{ translateX: pan }] }}
      >
        {children}
      </Animated.View>
    </View>
  );
}
