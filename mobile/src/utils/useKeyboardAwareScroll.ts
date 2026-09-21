import { useCallback, useEffect, useRef, useState } from "react";
import { Keyboard, Platform, ScrollView, TextInput, type NativeSyntheticEvent, type NativeScrollEvent, type LayoutChangeEvent } from "react-native";
import {
  focusedFieldScrollDelta,
  keyboardTopFromEvent,
  keyboardTopFromVisualViewport,
  nextScrollY,
  webKeyboardHeight,
} from "./keyboardPad";

function isWebTextField(el: Element | null): el is HTMLElement {
  if (!el || typeof (el as HTMLElement).tagName !== "string") return false;
  const tag = (el as HTMLElement).tagName;
  return tag === "INPUT" || tag === "TEXTAREA" || !!(el as HTMLElement).isContentEditable;
}

function windowHeight(): number {
  return typeof window !== "undefined" ? window.innerHeight : 0;
}

export function useKeyboardAwareScroll(enabled = true) {
  const scrollRef = useRef<ScrollView>(null);
  const scrollY = useRef(0);
  const contentH = useRef(0);
  const viewportH = useRef(0);
  const [keyboardHeight, setKeyboardHeight] = useState(0);

  const scrollFocusedAboveKeyboard = useCallback((keyboardTop: number) => {
    if (!enabled) return;
    const maxY = Math.max(0, contentH.current - viewportH.current);
    if (Platform.OS === "web" && typeof document !== "undefined") {
      const el = document.activeElement;
      if (!isWebTextField(el)) return;
      const lift = () => {
        const rect = el.getBoundingClientRect();
        const delta = focusedFieldScrollDelta(rect.bottom, keyboardTop);
        if (delta <= 0) return;
        if (typeof el.scrollIntoView === "function") {
          el.scrollIntoView({ block: "center", inline: "nearest", behavior: "smooth" });
        }
        scrollRef.current?.scrollTo({ y: nextScrollY(scrollY.current, delta, maxY), animated: true });
      };
      lift();
      requestAnimationFrame(lift);
      return;
    }
    const input = TextInput.State?.currentlyFocusedInput?.();
    if (!input || !scrollRef.current) return;
    input.measureInWindow((_x: number, y: number, _w: number, h: number) => {
      const delta = focusedFieldScrollDelta(y + h, keyboardTop);
      if (delta <= 0) return;
      scrollRef.current?.scrollTo({ y: nextScrollY(scrollY.current, delta, maxY), animated: true });
    });
  }, [enabled]);

  useEffect(() => {
    if (!enabled) return undefined;
    const showEvt = Platform.OS === "ios" ? "keyboardWillShow" : "keyboardDidShow";
    const hideEvt = Platform.OS === "ios" ? "keyboardWillHide" : "keyboardDidHide";
    const show = Keyboard.addListener(showEvt, (e) => {
      const height = e.endCoordinates?.height || 0;
      const top = keyboardTopFromEvent(e.endCoordinates?.screenY, height, windowHeight());
      setKeyboardHeight(height);
      setTimeout(() => scrollFocusedAboveKeyboard(top), 50);
    });
    const hide = Keyboard.addListener(hideEvt, () => setKeyboardHeight(0));
    return () => {
      show.remove();
      hide.remove();
    };
  }, [scrollFocusedAboveKeyboard]);

  useEffect(() => {
    if (!enabled || Platform.OS !== "web" || typeof window === "undefined" || !window.visualViewport) return undefined;
    const vv = window.visualViewport;
    const sync = () => {
      const covered = webKeyboardHeight(window.innerHeight, vv.height, vv.offsetTop);
      setKeyboardHeight(covered);
      if (covered > 0) {
        const top = keyboardTopFromVisualViewport(window.innerHeight, vv.height, vv.offsetTop);
        setTimeout(() => scrollFocusedAboveKeyboard(top), 50);
      }
    };
    vv.addEventListener("resize", sync);
    vv.addEventListener("scroll", sync);
    return () => {
      vv.removeEventListener("resize", sync);
      vv.removeEventListener("scroll", sync);
    };
  }, [scrollFocusedAboveKeyboard]);

  useEffect(() => {
    if (!enabled || Platform.OS !== "web" || typeof document === "undefined") return undefined;
    const onFocus = () => {
      const vv = typeof window !== "undefined" ? window.visualViewport : null;
      const top = vv
        ? keyboardTopFromVisualViewport(window.innerHeight, vv.height, vv.offsetTop)
        : 0;
      if (top > 0 && webKeyboardHeight(window.innerHeight, vv?.height, vv?.offsetTop) > 0) {
        setTimeout(() => scrollFocusedAboveKeyboard(top), 30);
      }
    };
    document.addEventListener("focusin", onFocus);
    return () => document.removeEventListener("focusin", onFocus);
  }, [scrollFocusedAboveKeyboard]);

  return {
    keyboardHeight,
    scrollRef,
    scrollProps: {
      onScroll: (e: NativeSyntheticEvent<NativeScrollEvent>) => {
        scrollY.current = e.nativeEvent.contentOffset.y;
      },
      onContentSizeChange: (_w: number, h: number) => {
        contentH.current = h;
      },
      onLayout: (e: LayoutChangeEvent) => {
        viewportH.current = e.nativeEvent.layout.height;
      },
      scrollEventThrottle: 16 as const,
      keyboardShouldPersistTaps: "handled" as const,
      keyboardDismissMode: "on-drag" as const,
      automaticallyAdjustKeyboardInsets: true,
    },
  };
}
