import React, { useEffect, useRef } from "react";
import { Platform, Pressable, StyleSheet, View } from "react-native";
import { colors } from "../theme";

/** Basılı tutma eşiği, tek okuma penceresi ve aynı kodun tekrar sayılmama süresi. */
export const SHUTTER_HOLD_MS = 400;
export const SHUTTER_SINGLE_MS = 1500;
export const SHUTTER_DEDUPE_MS = 1500;

export type ShutterMode = "idle" | "single" | "serial";

type Handlers = {
  onSingle: () => void;
  onSerialStart: () => void;
  onSerialEnd: () => void;
};

/**
 * Dokunuş tek okuma, 400 ms basılı tutma seri okuma.
 * Web'de fare basılı tutması aynı olaylara düşer; uzun basma menüsü ve metin seçimi kapalıdır.
 */
export function ScanShutter({
  mode,
  onSingle,
  onSerialStart,
  onSerialEnd,
}: {
  mode: ShutterMode;
  onSingle: () => void;
  onSerialStart: () => void;
  onSerialEnd: () => void;
}) {
  const holding = useRef(false);
  const serial = useRef(false);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const cbs = useRef<Handlers>({ onSingle, onSerialStart, onSerialEnd });
  cbs.current = { onSingle, onSerialStart, onSerialEnd };

  const clear = () => {
    if (timer.current) clearTimeout(timer.current);
    timer.current = null;
  };

  useEffect(() => () => clear(), []);

  const armSerial = () => {
    if (!holding.current || serial.current) return;
    serial.current = true;
    clear();
    cbs.current.onSerialStart();
  };

  const pressIn = () => {
    holding.current = true;
    serial.current = false;
    clear();
    timer.current = setTimeout(armSerial, SHUTTER_HOLD_MS);
  };

  const pressOut = () => {
    const wasSerial = serial.current;
    holding.current = false;
    clear();
    if (wasSerial) {
      serial.current = false;
      cbs.current.onSerialEnd();
      return;
    }
    cbs.current.onSingle();
  };

  return (
    <Pressable
      testID="barcode-shutter"
      accessibilityRole="button"
      accessibilityLabel={mode === "serial" ? "Seri okuma" : "Barkod deklanşör"}
      delayLongPress={SHUTTER_HOLD_MS}
      onPressIn={pressIn}
      onPressOut={pressOut}
      onLongPress={armSerial}
      {...(Platform.OS === "web" ? { onContextMenu: preventShutterMenu } : null)}
      style={[styles.hit, Platform.OS === "web" ? (webHit as never) : null]}
    >
      {mode === "serial" ? <View pointerEvents="none" style={styles.pulse} /> : null}
      <View pointerEvents="none" style={[styles.ring, mode === "serial" && styles.ringSerial]}>
        <View pointerEvents="none" style={[styles.core, mode === "serial" && styles.coreSerial]} />
      </View>
    </Pressable>
  );
}

function preventShutterMenu(event?: { preventDefault?: () => void }) {
  event?.preventDefault?.();
}

const webHit = {
  userSelect: "none",
  WebkitUserSelect: "none",
  WebkitTouchCallout: "none",
  touchAction: "none",
} as const;

const styles = StyleSheet.create({
  hit: {
    width: 96,
    height: 96,
    alignItems: "center",
    justifyContent: "center",
    alignSelf: "center",
  },
  pulse: {
    position: "absolute",
    width: 92,
    height: 92,
    borderRadius: 46,
    borderWidth: 3,
    borderColor: colors.danger,
    opacity: 0.55,
  },
  ring: {
    width: 78,
    height: 78,
    borderRadius: 39,
    borderWidth: 4,
    borderColor: "#fff",
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: "transparent",
  },
  ringSerial: { borderColor: colors.danger },
  core: {
    width: 58,
    height: 58,
    borderRadius: 29,
    backgroundColor: "#fff",
  },
  coreSerial: {
    width: 44,
    height: 44,
    borderRadius: 12,
    backgroundColor: colors.danger,
  },
});
