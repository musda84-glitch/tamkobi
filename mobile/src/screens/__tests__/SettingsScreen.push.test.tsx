jest.mock("expo-image-picker", () => ({}));
jest.mock("expo-router", () => ({ router: { push: jest.fn(), navigate: jest.fn() } }));
jest.mock("react-native", () => ({
  Platform: { OS: "android" },
  Pressable: "Pressable",
  Text: "Text",
  View: "View",
}));
jest.mock("../../auth/AuthContext", () => ({
  useAuth: () => ({
    client: { baseUrl: "", token: null },
    companies: [],
    activeCompany: null,
    switchCompany: () => Promise.resolve(),
    companyId: "",
    user: null,
    logout: () => Promise.resolve(),
    updateProfile: () => Promise.resolve({}),
  }),
  apiErrorMessage: (_err: unknown, fallback: string) => fallback,
}));
jest.mock("../../components/EmployeeAvatar", () => ({ EmployeeAvatar: () => null }));
jest.mock("../../components/kit", () => ({
  Card: () => null,
  ErrorBanner: () => null,
  Field: () => null,
  H1: () => null,
  Muted: () => null,
  PrimaryButton: () => null,
  Screen: () => null,
}));
jest.mock("../../nav", () => ({ go: () => undefined }));

import { FCM_PUSH_UNAVAILABLE } from "../../utils/pushRegister";
import { FCM_ADMIN_HINT, PhonePushNotice, REMOTE_PUSH_OPEN, pushEnableOutcome } from "../SettingsScreen";

function textOf(node: unknown): string {
  if (node == null || typeof node === "boolean") return "";
  if (typeof node === "string" || typeof node === "number") return String(node);
  if (Array.isArray(node)) return node.map(textOf).join("");
  if (typeof node === "object" && node && "props" in node) {
    return textOf((node as { props?: { children?: unknown } }).props?.children);
  }
  return "";
}

describe("Settings phone notifications", () => {
  it("says remote push is on when a token is registered", () => {
    const text = textOf(PhonePushNotice({ status: "ok", error: null }));
    expect(text).toContain(REMOTE_PUSH_OPEN);
    expect(text).not.toContain(FCM_ADMIN_HINT);
  });

  it("shows the FCM warning and the real error after enable", () => {
    const text = textOf(PhonePushNotice({ status: "unavailable", error: FCM_PUSH_UNAVAILABLE }));
    expect(text).toContain(FCM_PUSH_UNAVAILABLE);
    expect(text).toContain(FCM_ADMIN_HINT);
    expect(text).not.toContain(REMOTE_PUSH_OPEN);
    const outcome = pushEnableOutcome({ status: "unavailable", error: FCM_PUSH_UNAVAILABLE }, true);
    expect(outcome.error).toBe(FCM_PUSH_UNAVAILABLE);
    expect(outcome.message).toBeNull();
  });
});
