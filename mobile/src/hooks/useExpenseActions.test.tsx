import "../test/domSetup";
import React, { act, useState } from "react";
import { Alert } from "react-native";
import { del, post } from "../api/client";
import { findByTestId, reactProps, removeTestNavigator, textOf } from "../test/domSetup";
import { useExpenseActions } from "./useExpenseActions";

const { createRoot } = require("react-dom/client") as {
  createRoot: (container: unknown) => { render: (node: unknown) => void; unmount: () => void };
};

const reload = jest.fn(async () => undefined);

jest.mock("expo-router", () => ({
  router: { back: jest.fn(), push: jest.fn() },
}));

jest.mock("@expo/vector-icons", () => ({ Ionicons: () => null }));

jest.mock("../auth/AuthContext", () => ({
  useAuth: () => ({ client: { baseUrl: "https://api.test", token: "tok" } }),
  apiErrorMessage: (_err: unknown, fallback?: string) => fallback || "İşlem başarısız.",
}));

jest.mock("../api/client", () => ({
  post: jest.fn(async () => ({})),
  del: jest.fn(async () => ({})),
  get: jest.fn(async () => ({})),
}));

jest.mock("react-native", () => {
  const ReactLib = require("react") as typeof import("react");
  const host = (tag: string) =>
    function Host(props: { testID?: string; onPress?: () => void; children?: React.ReactNode }) {
      return ReactLib.createElement(tag, {
        "data-testid": props.testID,
        onClick: () => props.onPress?.(),
      }, props.children);
    };
  return {
    Platform: { OS: "ios", select: (spec: { ios?: unknown; default?: unknown }) => spec.ios ?? spec.default },
    Alert: { alert: jest.fn() },
    View: host("div"),
    Text: host("span"),
    Pressable: host("button"),
  };
});

function Harness({ payAcc, expenseId = "e1", number = "MSR-1" }: { payAcc: string; expenseId?: string; number?: string }) {
  const [error, setError] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const actions = useExpenseActions({
    expenseId,
    expense: number ? { expense_number: number } : null,
    payAcc,
    reload,
    setError,
    setMessage,
    setBusy: () => undefined,
  });
  return (
    <>
      <span data-testid="err">{error}</span>
      <span data-testid="msg">{message}</span>
      <button type="button" data-testid="pay" onClick={() => { void actions.payTarget(); }}>pay</button>
      <button type="button" data-testid="unpay" onClick={() => actions.unpay()}>unpay</button>
      <button type="button" data-testid="del" onClick={() => actions.remove()}>del</button>
    </>
  );
}

async function settle() {
  for (let i = 0; i < 8; i += 1) {
    await act(async () => { await Promise.resolve(); });
  }
}

async function press(container: unknown, id: string) {
  const node = findByTestId(container, id);
  if (!node) throw new Error(`missing ${id}`);
  const props = reactProps(node);
  await act(async () => { await (props?.onClick || props?.onPress)?.(); });
  await settle();
}

function renderHarness(props: { payAcc: string; expenseId?: string; number?: string }) {
  const container = document.createElement("div");
  document.body.appendChild(container);
  const root = createRoot(container);
  act(() => { root.render(React.createElement(Harness, props)); });
  return { container, root };
}

async function confirmAlert() {
  const buttons = (Alert.alert as jest.Mock).mock.calls.at(-1)?.[2] as { style?: string; onPress?: () => void }[];
  const yes = buttons?.find((button) => button.style === "destructive");
  await act(async () => { await yes?.onPress?.(); });
  await settle();
}

describe("useExpenseActions", () => {
  beforeEach(() => {
    reload.mockClear();
    (post as unknown as jest.Mock).mockReset();
    (del as unknown as jest.Mock).mockReset();
    (post as unknown as jest.Mock).mockResolvedValue({});
    (del as unknown as jest.Mock).mockResolvedValue({});
    (Alert.alert as jest.Mock).mockReset();
  });

  afterEach(() => {
    document.body.innerHTML = "";
  });

  afterAll(() => {
    removeTestNavigator();
  });

  it("pays only after a target is chosen and reports the shared error text", async () => {
    const missing = renderHarness({ payAcc: "" });
    await press(missing.container, "pay");
    expect(textOf(findByTestId(missing.container, "err"))).toBe("Ödeme için kasa/banka/ortak seçin.");
    expect(post).not.toHaveBeenCalled();
    missing.root.unmount();

    const ready = renderHarness({ payAcc: "acc-1" });
    await press(ready.container, "pay");
    expect(post).toHaveBeenCalledWith(
      { baseUrl: "https://api.test", token: "tok" },
      "/expenses/e1/pay",
      { account_id: "acc-1", partner_id: null },
    );
    expect(textOf(findByTestId(ready.container, "msg"))).toBe("Masraf ödendi.");
    expect(reload).toHaveBeenCalled();
    ready.root.unmount();

    (post as unknown as jest.Mock).mockRejectedValueOnce(new Error("kapalı"));
    const failed = renderHarness({ payAcc: "partner:p1" });
    await press(failed.container, "pay");
    expect(post).toHaveBeenCalledWith(
      { baseUrl: "https://api.test", token: "tok" },
      "/expenses/e1/pay",
      { account_id: null, partner_id: "p1" },
    );
    expect(textOf(findByTestId(failed.container, "err"))).toBe("Ödenemedi.");
    failed.root.unmount();
  });

  it("confirms unpay and delete with the same alerts, then calls the API", async () => {
    const view = renderHarness({ payAcc: "" });
    await press(view.container, "unpay");
    expect(Alert.alert).toHaveBeenCalledWith("Ödemeyi geri al", "Kasa/banka bakiyesi düzeltilir.", expect.any(Array));
    await confirmAlert();
    expect(post).toHaveBeenCalledWith({ baseUrl: "https://api.test", token: "tok" }, "/expenses/e1/unpay");
    expect(textOf(findByTestId(view.container, "msg"))).toBe("Ödeme geri alındı.");

    (post as unknown as jest.Mock).mockRejectedValueOnce(new Error("olmadı"));
    await press(view.container, "unpay");
    await confirmAlert();
    expect(textOf(findByTestId(view.container, "err"))).toBe("İşlem başarısız.");

    await press(view.container, "del");
    expect(Alert.alert).toHaveBeenCalledWith("Masrafı sil", "MSR-1 silinsin mi?", expect.any(Array));
    const { router } = require("expo-router") as typeof import("expo-router");
    await confirmAlert();
    expect(del).toHaveBeenCalledWith({ baseUrl: "https://api.test", token: "tok" }, "/expenses/e1");
    expect(router.back).toHaveBeenCalled();
    view.root.unmount();

    (del as unknown as jest.Mock).mockRejectedValueOnce(new Error("kilitli"));
    const unnamed = renderHarness({ payAcc: "", number: "" });
    await press(unnamed.container, "del");
    expect(Alert.alert).toHaveBeenCalledWith("Masrafı sil", "Bu masraf silinsin mi?", expect.any(Array));
    await confirmAlert();
    expect(textOf(findByTestId(unnamed.container, "err"))).toBe("Silinemedi.");
    unnamed.root.unmount();
  });
});
