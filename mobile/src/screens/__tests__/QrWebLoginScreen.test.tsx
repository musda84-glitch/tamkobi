jest.mock("react-native", () => ({
  Pressable: "Pressable",
  Text: "Text",
  View: "View",
}));
jest.mock("@expo/vector-icons", () => ({ Ionicons: () => null }));
jest.mock("expo-camera", () => ({ CameraView: () => null, useCameraPermissions: () => [{ granted: false }, jest.fn()] }));
jest.mock("../../components/BarcodeScannerModal", () => ({ BarcodeScannerModal: () => null }));
jest.mock("../../auth/AuthContext", () => ({ useAuth: () => ({ client: { baseUrl: "", token: null } }) }));
jest.mock("../../api/client", () => ({ post: jest.fn() }));
jest.mock("../../api/errors", () => ({ apiErrorMessage: (err: unknown, fallback: string) => fallback }));
jest.mock("../../components/kit", () => ({
  ErrorBanner: () => null,
  PrimaryButton: "PrimaryButton",
  Screen: ({ children }: { children?: unknown }) => children ?? null,
}));

import { QrLoginConfirm } from "../QrWebLoginScreen";
import { QR_LOGIN_APPROVE, QR_LOGIN_PREVIEW, QR_LOGIN_REJECT } from "../../utils/qrLogin";

function textOf(node: unknown): string {
  if (node == null || typeof node === "boolean") return "";
  if (typeof node === "string" || typeof node === "number") return String(node);
  if (Array.isArray(node)) return node.map(textOf).join("");
  if (typeof node === "object" && node && "props" in node) {
    const props = (node as { props?: { children?: unknown; testID?: string } }).props;
    return `${props?.testID || ""}${textOf(props?.children)}`;
  }
  return "";
}

describe("QR web login confirm", () => {
  it("shows company, user, browser and IP before approve or reject", () => {
    const text = textOf(QrLoginConfirm({
      preview: {
        company_name: "Birinci Ltd",
        user_name: "Ada Kaya",
        user_email: "ada@example.com",
        browser: "Chrome",
        ip: "203.0.113.10",
      },
      onApprove: () => undefined,
      onReject: () => undefined,
    }));
    expect(text).toContain("Bu cihazda girişi onayla");
    expect(text).toContain("qr-login-companyBirinci Ltd");
    expect(text).toContain("Ada Kaya · ada@example.com");
    expect(text).toContain("Chrome");
    expect(text).toContain("203.0.113.10");
    expect(text).toContain("Reddet");
    expect(text).toContain("qr-login-approve");
    expect(text).toContain("qr-login-reject");
    expect(text).not.toContain("atolye");
  });

  it("calls the authenticated approve and reject paths", () => {
    expect(QR_LOGIN_PREVIEW).toBe("/auth/qr-login/preview");
    expect(QR_LOGIN_APPROVE).toBe("/auth/qr-login/approve");
    expect(QR_LOGIN_REJECT).toBe("/auth/qr-login/reject");
  });
});
