import { Ionicons } from "@expo/vector-icons";
import React, { useEffect, useRef } from "react";
import { Animated, PanResponder, Platform, Pressable, Text, View } from "react-native";
import { colors } from "../theme";
import { swipeRevealOutcome, SWIPE_MENU_W } from "../utils/swipeReveal";

const ACTION_W = SWIPE_MENU_W / 2;

function clientX(e: { nativeEvent?: { clientX?: number; pageX?: number }; clientX?: number }): number {
  return e?.nativeEvent?.pageX ?? e?.nativeEvent?.clientX ?? e?.clientX ?? 0;
}

export function SwipeRevealRow({
  rowKey,
  openKey,
  onOpen,
  onEdit,
  onDelete,
  onPress,
  children,
  testID,
}: {
  rowKey: string;
  openKey: string | null;
  onOpen: (key: string | null) => void;
  onEdit?: () => void;
  onDelete: () => void;
  onPress?: () => void;
  children: React.ReactNode;
  testID?: string;
}) {
  const open = openKey === rowKey;
  const pan = useRef(new Animated.Value(open ? -SWIPE_MENU_W : 0)).current;
  const startX = useRef(open ? -SWIPE_MENU_W : 0);
  const originX = useRef(0);
  const dragging = useRef(false);
  const openKeyRef = useRef(openKey);
  const onOpenRef = useRef(onOpen);
  const onPressRef = useRef(onPress);
  openKeyRef.current = openKey;
  onOpenRef.current = onOpen;
  onPressRef.current = onPress;

  useEffect(() => {
    const to = open ? -SWIPE_MENU_W : 0;
    startX.current = to;
    Animated.spring(pan, { toValue: to, useNativeDriver: true, bounciness: 0, speed: 18 }).start();
  }, [open, pan]);

  const finish = (dx: number, vx: number) => {
    dragging.current = false;
    const outcome = swipeRevealOutcome(startX.current, dx, vx);
    if (outcome === "press") {
      onPressRef.current?.();
      return;
    }
    onOpenRef.current(outcome === "open" ? rowKey : null);
  };

  const responder = useRef(
    PanResponder.create({
      onMoveShouldSetPanResponder: (_, g) => Math.abs(g.dx) > 6 && Math.abs(g.dx) > Math.abs(g.dy),
      onMoveShouldSetPanResponderCapture: (_, g) => Math.abs(g.dx) > 6 && Math.abs(g.dx) > Math.abs(g.dy),
      onPanResponderGrant: () => {
        startX.current = openKeyRef.current === rowKey ? -SWIPE_MENU_W : 0;
      },
      onPanResponderMove: (_, g) => {
        const x = Math.min(0, Math.max(-SWIPE_MENU_W, startX.current + g.dx));
        pan.setValue(x);
      },
      onPanResponderRelease: (_, g) => {
        finish(g.dx, g.vx);
      },
      onPanResponderTerminate: (_, g) => {
        finish(g.dx, g.vx);
      },
    })
  ).current;

  const webHandlers = {
    onStartShouldSetResponder: () => true,
    onResponderGrant: (e: { nativeEvent?: { pageX?: number } }) => {
      dragging.current = true;
      originX.current = clientX(e);
      startX.current = openKeyRef.current === rowKey ? -SWIPE_MENU_W : 0;
    },
    onResponderMove: (e: { nativeEvent?: { pageX?: number } }) => {
      if (!dragging.current) return;
      const dx = clientX(e) - originX.current;
      pan.setValue(Math.min(0, Math.max(-SWIPE_MENU_W, startX.current + dx)));
    },
    onResponderRelease: (e: { nativeEvent?: { pageX?: number } }) => {
      if (!dragging.current) return;
      finish(clientX(e) - originX.current, 0);
    },
    onResponderTerminate: (e: { nativeEvent?: { pageX?: number } }) => {
      if (!dragging.current) return;
      finish(clientX(e) - originX.current, 0);
    },
  } as object;

  return (
    <View testID={testID} style={{ overflow: "hidden" }}>
      <View style={{ position: "absolute", right: 0, top: 0, bottom: 0, flexDirection: "row", width: SWIPE_MENU_W }}>
        {onEdit ? (
          <Pressable
            testID={testID ? `${testID}-edit` : undefined}
            onPress={onEdit}
            style={{ width: ACTION_W, alignItems: "center", justifyContent: "center", backgroundColor: colors.indigo }}
          >
            <Ionicons name="create-outline" size={18} color="#fff" />
            <Text style={{ color: "#fff", fontWeight: "800", fontSize: 11, marginTop: 2 }}>Düzenle</Text>
          </Pressable>
        ) : null}
        <Pressable
          testID={testID ? `${testID}-del` : undefined}
          onPress={onDelete}
          style={{ width: onEdit ? ACTION_W : SWIPE_MENU_W, alignItems: "center", justifyContent: "center", backgroundColor: colors.danger }}
        >
          <Ionicons name="trash-outline" size={18} color="#fff" />
          <Text style={{ color: "#fff", fontWeight: "800", fontSize: 11, marginTop: 2 }}>Sil</Text>
        </Pressable>
      </View>
      <Animated.View
        {...(Platform.OS === "web" ? webHandlers : responder.panHandlers)}
        style={{ backgroundColor: colors.background, transform: [{ translateX: pan }] }}
      >
        {children}
      </Animated.View>
    </View>
  );
}
