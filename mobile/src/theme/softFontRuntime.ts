import {
  Nunito_400Regular,
  Nunito_500Medium,
  Nunito_600SemiBold,
  Nunito_700Bold,
  Nunito_800ExtraBold,
  Nunito_900Black,
} from "@expo-google-fonts/nunito";
import React from "react";
import { Platform, StyleSheet, Text, TextInput } from "react-native";
import { fontFamilyForWeight, shouldReplaceFontFamily } from "./softFont";

export const SOFT_FONT_FACES = {
  Nunito_400Regular,
  Nunito_500Medium,
  Nunito_600SemiBold,
  Nunito_700Bold,
  Nunito_800ExtraBold,
  Nunito_900Black,
} as const;

let patched = false;

function installWebSmoothing() {
  if (Platform.OS !== "web" || typeof document === "undefined") return;
  const id = "tamkobi-soft-font";
  if (document.getElementById(id)) return;
  const style = document.createElement("style");
  style.id = id;
  style.textContent = `
    html, body, #root {
      -webkit-font-smoothing: antialiased;
      -moz-osx-font-smoothing: grayscale;
      text-rendering: optimizeLegibility;
    }
  `;
  document.head.appendChild(style);
}

function flattenStyle(style: unknown): { fontFamily?: string; fontWeight?: string | number } {
  try {
    return (StyleSheet.flatten(style as never) || {}) as { fontFamily?: string; fontWeight?: string | number };
  } catch {
    return {};
  }
}

export function enableSoftFonts() {
  if (patched) return;
  patched = true;
  installWebSmoothing();
  const original = React.createElement.bind(React);
  (React as { createElement: typeof React.createElement }).createElement = ((
    type: unknown,
    props: { style?: unknown } | null,
    ...children: unknown[]
  ) => {
    if ((type === Text || type === TextInput) && props) {
      const flat = flattenStyle(props.style);
      if (shouldReplaceFontFamily(flat.fontFamily ? String(flat.fontFamily) : null)) {
        return original(
          type as "div",
          { ...props, style: [props.style, { fontFamily: fontFamilyForWeight(flat.fontWeight) }] } as never,
          ...(children as []),
        );
      }
    }
    return original(type as "div", props as never, ...(children as []));
  }) as unknown as typeof React.createElement;
}
