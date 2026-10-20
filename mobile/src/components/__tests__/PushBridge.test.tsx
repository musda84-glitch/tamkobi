import "../../test/domSetup";
import React, { act } from "react";
import { removeTestNavigator } from "../../test/domSetup";
import { goHref } from "../../nav";
import { PushBridge } from "../PushBridge";

const { createRoot } = require("react-dom/client") as {
  createRoot: (container: unknown) => { render: (node: unknown) => void; unmount: () => void };
};

const mockClearLast = jest.fn(async () => undefined);
const mockGetLast = jest.fn(async () => ({
  notification: {
    request: {
      identifier: "admin-old",
      content: {
        data: {
          target_route: "/edoc-inbox",
          user_id: "admin-1",
          company_id: "co-1",
        },
      },
    },
  },
}));

jest.mock("../../nav", () => ({ goHref: jest.fn() }));
jest.mock("../../auth/BadgeContext", () => ({ useBadges: () => ({ refresh: jest.fn() }) }));
jest.mock("../../auth/AuthContext", () => ({
  useAuth: () => ({
    client: { baseUrl: "https://tamkobi.com", token: "tok" },
    user: {
      id: "staff-1",
      role: "personel",
      email: "staff@example.com",
      name: "Ali",
      permissions: { "/mesai": "view" },
    },
    token: "tok",
    sessionKind: "erp",
    companyId: "co-1",
  }),
}));
jest.mock("../../api/client", () => ({ get: jest.fn(async () => []) }));
jest.mock("../../utils/pushRegister", () => ({
  askPushPermission: jest.fn(async () => "ok"),
  enablePushHandler: jest.fn(async () => undefined),
  registerDevicePush: jest.fn(async () => ({ status: "ok" })),
  rememberPresentedNotificationIds: jest.fn(async () => undefined),
  rememberReceivedNotification: jest.fn(async () => undefined),
  syncLocalPhoneAlerts: jest.fn(async () => 0),
}));
jest.mock("react-native", () => ({
  Platform: { OS: "ios" },
  AppState: { addEventListener: () => ({ remove() { /* no-op */ } }) },
}));
jest.mock("expo-notifications", () => ({
  addNotificationResponseReceivedListener: jest.fn(() => ({ remove() { /* no-op */ } })),
  addNotificationReceivedListener: jest.fn(() => ({ remove() { /* no-op */ } })),
  getLastNotificationResponseAsync: () => mockGetLast(),
  clearLastNotificationResponseAsync: () => mockClearLast(),
}));

afterAll(() => {
  removeTestNavigator();
});

describe("PushBridge cold start", () => {
  it("does not open an old admin notification for the signed-in staff user", async () => {
    const container = document.createElement("div");
    const root = createRoot(container);
    await act(async () => {
      root.render(React.createElement(PushBridge));
    });
    for (let i = 0; i < 20 && mockClearLast.mock.calls.length === 0; i += 1) {
      await act(async () => {
        await new Promise((resolve) => setTimeout(resolve, 0));
      });
    }
    expect(mockGetLast).toHaveBeenCalled();
    expect(goHref).not.toHaveBeenCalled();
    expect(mockClearLast).toHaveBeenCalled();
    await act(async () => {
      root.unmount();
    });
  });
});
