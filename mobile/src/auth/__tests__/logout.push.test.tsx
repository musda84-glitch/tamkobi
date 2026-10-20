import "../../test/domSetup";
import React, { act, useEffect } from "react";
import { removeTestNavigator } from "../../test/domSetup";
import { AuthProvider, useAuth } from "../AuthContext";

const { createRoot } = require("react-dom/client") as {
  createRoot: (container: unknown) => { render: (node: unknown) => void; unmount: () => void };
};

const mockMemory = new Map<string, string>();
const mockDismiss = jest.fn(async () => undefined);
const mockBadge = jest.fn(async (_count?: number) => true);
const mockGet = jest.fn();
const mockPost = jest.fn();
const mockDel = jest.fn();

jest.mock("@react-native-async-storage/async-storage", () => ({
  __esModule: true,
  default: {
    getItem: (key: string) => Promise.resolve(mockMemory.has(key) ? mockMemory.get(key)! : null),
    setItem: (key: string, value: string) => {
      mockMemory.set(key, value);
      return Promise.resolve();
    },
    removeItem: (key: string) => {
      mockMemory.delete(key);
      return Promise.resolve();
    },
  },
}));

jest.mock("expo-secure-store", () => ({
  getItemAsync: (key: string) => Promise.resolve(mockMemory.has(key) ? mockMemory.get(key)! : null),
  setItemAsync: (key: string, value: string) => {
    mockMemory.set(key, value);
    return Promise.resolve();
  },
  deleteItemAsync: (key: string) => {
    mockMemory.delete(key);
    return Promise.resolve();
  },
}));

jest.mock("expo-notifications", () => ({
  dismissAllNotificationsAsync: () => mockDismiss(),
  setBadgeCountAsync: (count: number) => mockBadge(count),
}));

jest.mock("react-native", () => ({
  Platform: { OS: "ios" },
}));

jest.mock("../../utils/locationBackgroundSync", () => ({
  haltLocationBackground: jest.fn(async () => undefined),
}));

jest.mock("../../api/client", () => ({
  get: (...args: unknown[]) => mockGet(...args),
  post: (...args: unknown[]) => mockPost(...args),
  put: jest.fn(async () => ({})),
  del: (...args: unknown[]) => mockDel(...args),
}));

const session = {
  authenticated: true,
  user: {
    id: "admin-1",
    email: "admin@example.com",
    name: "Admin",
    role: "admin",
    active_company_id: "co-1",
  },
  companies: [{ id: "co-1", name: "Matek" }],
  license: null,
};

function Grab({ onLogout }: { onLogout: (logout: () => Promise<void>) => void }) {
  const auth = useAuth();
  useEffect(() => {
    if (auth.ready && auth.user) onLogout(auth.logout);
  }, [auth, onLogout]);
  return null;
}

afterAll(() => {
  removeTestNavigator();
});

describe("logout push cleanup", () => {
  beforeEach(() => {
    mockMemory.clear();
    mockDismiss.mockClear();
    mockBadge.mockClear();
    mockGet.mockReset();
    mockPost.mockReset();
    mockDel.mockReset();
    mockMemory.set("tamkobi.accessToken", "sess-token");
    mockMemory.set("tamkobi.sessionKind", "erp");
    mockMemory.set("tamkobi.pushToken", "ExponentPushToken[admin]");
    mockMemory.set("tamkobi.pushLocalSeen", JSON.stringify(["note-1"]));
    mockMemory.set("tamkobi.pushLocalSeeded", "1");
    mockGet.mockImplementation(async (_client: unknown, path: string) => {
      if (path === "/auth/me") return session;
      return [];
    });
    mockPost.mockImplementation(async (_client: unknown, path: string) => {
      if (path === "/notifications/push-token/unregister") throw new Error("network down");
      return { status: "success" };
    });
    mockDel.mockImplementation(async () => {
      throw new Error("network down");
    });
  });

  it("unregisters, dismisses presented notifications, and drops the local token when the network fails", async () => {
    const container = document.createElement("div");
    const root = createRoot(container);
    let logout: (() => Promise<void>) | null = null;
    const onLogout = (fn: () => Promise<void>) => {
      logout = fn;
    };
    await act(async () => {
      root.render(React.createElement(AuthProvider, null, React.createElement(Grab, { onLogout })));
    });
    for (let i = 0; i < 20 && !logout; i += 1) {
      await act(async () => {
        await new Promise((resolve) => setTimeout(resolve, 0));
      });
    }
    expect(logout).toBeTruthy();
    expect(mockDismiss).not.toHaveBeenCalled();
    expect(mockMemory.get("tamkobi.pushToken")).toBe("ExponentPushToken[admin]");

    await act(async () => {
      await logout!();
    });

    expect(mockPost).toHaveBeenCalledWith(
      expect.objectContaining({ token: "sess-token" }),
      "/notifications/push-token/unregister",
      { token: "ExponentPushToken[admin]" },
    );
    expect(mockDel).toHaveBeenCalled();
    expect(mockDismiss).toHaveBeenCalled();
    expect(mockBadge).toHaveBeenCalledWith(0);
    expect(mockMemory.has("tamkobi.pushToken")).toBe(false);
    expect(mockMemory.get("tamkobi.pushLocalSeen")).toBe("[]");
    expect(mockMemory.has("tamkobi.pushLocalSeeded")).toBe(false);

    await act(async () => {
      root.unmount();
    });
  });
});
