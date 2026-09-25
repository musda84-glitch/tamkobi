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
  deleteLabel = "Sil",
  deleteColor = colors.danger,
}: {
  rowKey: string;
  openKey: string | null;
  onOpen: (key: string | null) => void;
  onEdit?: () => void;
  onDelete?: () => void;
  onPress?: () => void;
  children: React.ReactNode;
  testID?: string;
  deleteLabel?: string;
  deleteColor?: string;
}) {
  const open = openKey === rowKey;
  const hasActions = Boolean(onEdit || onDelete);
  const pan = useRef(new Animated.Value(open && hasActions ? -SWIPE_MENU_W : 0)).current;
  const startX = useRef(open && hasActions ? -SWIPE_MENU_W : 0);
  const originX = useRef(0);
  const dragging = useRef(false);
  const openKeyRef = useRef(openKey);
  const onOpenRef = useRef(onOpen);
  const onPressRef = useRef(onPress);
  const hasActionsRef = useRef(hasActions);
  openKeyRef.current = openKey;
  onOpenRef.current = onOpen;
  onPressRef.current = onPress;
  hasActionsRef.current = hasActions;

  useEffect(() => {
    const to = open && hasActions ? -SWIPE_MENU_W : 0;
    startX.current = to;
    Animated.spring(pan, { toValue: to, useNativeDriver: true, bounciness: 0, speed: 18 }).start();
  }, [open, pan, hasActions]);

  const finish = (dx: number, vx: number) => {
    dragging.current = false;
    if (!hasActionsRef.current) {
      onPressRef.current?.();
      return;
    }
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
        startX.current = openKeyRef.current === rowKey && hasActionsRef.current ? -SWIPE_MENU_W : 0;
      },
      onPanResponderMove: (_, g) => {
        if (!hasActionsRef.current) return;
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
      startX.current = openKeyRef.current === rowKey && hasActionsRef.current ? -SWIPE_MENU_W : 0;
    },
    onResponderMove: (e: { nativeEvent?: { pageX?: number } }) => {
      if (!dragging.current || !hasActionsRef.current) return;
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
      {hasActions ? (
        <View style={{ position: "absolute", right: 0, top: 0, bottom: 0, flexDirection: "row", width: SWIPE_MENU_W }}>
          {onEdit ? (
            <Pressable
              testID={testID ? `${testID}-edit` : undefined}
              onPress={onEdit}
              style={{ width: onDelete ? ACTION_W : SWIPE_MENU_W, alignItems: "center", justifyContent: "center", backgroundColor: colors.indigo }}
            >
              <Ionicons name="create-outline" size={18} color="#fff" />
              <Text style={{ color: "#fff", fontWeight: "800", fontSize: 11, marginTop: 2 }}>Düzenle</Text>
            </Pressable>
          ) : null}
          {onDelete ? (
            <Pressable
              testID={testID ? `${testID}-del` : undefined}
              onPress={onDelete}
              style={{ width: onEdit ? ACTION_W : SWIPE_MENU_W, alignItems: "center", justifyContent: "center", backgroundColor: deleteColor }}
            >
              <Ionicons name={deleteLabel === "İptal" ? "close-circle-outline" : "trash-outline"} size={18} color="#fff" />
              <Text style={{ color: "#fff", fontWeight: "800", fontSize: 11, marginTop: 2 }}>{deleteLabel}</Text>
            </Pressable>
          ) : null}
        </View>
      ) : null}
      <Animated.View
        {...(Platform.OS === "web" ? webHandlers : responder.panHandlers)}
        style={{ backgroundColor: colors.background, transform: [{ translateX: pan }] }}
      >
        {children}
      </Animated.View>
    </View>
  );
}
