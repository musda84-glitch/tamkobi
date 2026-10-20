const mockMemory = new Map<string, string>();
const scheduled: Array<{ identifier?: string; content?: { data?: Record<string, string> } }> = [];
let presented: Array<{ request: { identifier?: string; content: { data?: Record<string, string> } } }> = [];
const logLines: string[] = [];

jest.mock("react-native", () => ({
  Platform: { OS: "android" },
}));

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

jest.mock("expo-notifications", () => ({
  getPermissionsAsync: jest.fn(async () => ({ status: "granted", granted: true })),
  requestPermissionsAsync: jest.fn(async () => ({ status: "granted", granted: true })),
  setNotificationChannelAsync: jest.fn(async () => undefined),
  getExpoPushTokenAsync: jest.fn(async () => ({ data: "ExponentPushToken[abc123]" })),
  scheduleNotificationAsync: jest.fn(async (req: { identifier?: string; content?: { data?: Record<string, string> } }) => {
    scheduled.push(req);
    presented.push({
      request: { identifier: req.identifier, content: { data: { ...(req.content?.data || {}) } } },
    });
    return req.identifier || "local";
  }),
  getPresentedNotificationsAsync: jest.fn(async () => presented.map((item) => ({ ...item }))),
  AndroidImportance: { HIGH: 4 },
}));

jest.mock("expo-device", () => ({ isDevice: true }));

jest.mock("expo-constants", () => ({
  __esModule: true,
  default: { expoConfig: { extra: { eas: { projectId: "pid-1" } } } },
}));

jest.mock("../../api/client", () => ({
  post: jest.fn(async () => ({ ok: true })),
  del: jest.fn(async () => ({ ok: true })),
}));

import { post } from "../../api/client";
import { localPushContent } from "../pushLocal";
import {
  PUSH_LAST_ERROR_KEY,
  clearDevicePushState,
  presentLocalNotification,
  registerDevicePush,
  rememberReceivedNotification,
  syncLocalPhoneAlerts,
} from "../pushRegister";

const client = { baseUrl: "https://tamkobi.com", token: "sess" };

function note(id: string, created_at = "2026-10-20T14:32:00Z") {
  return {
    id,
    title: `Başlık ${id}`,
    message: `B2B-2026-0098 ${id}`,
    created_at,
    is_read: false,
    type: "b2b_order",
    link: "/orders",
  };
}

function idsOfScheduled(): string[] {
  return scheduled.map((item) => String(item.content?.data?.notification_id || ""));
}

beforeEach(async () => {
  mockMemory.clear();
  scheduled.length = 0;
  presented = [];
  logLines.length = 0;
  (post as jest.Mock).mockClear();
  await clearDevicePushState();
  mockMemory.delete("tamkobi.pushLocalSeen");
  mockMemory.delete("tamkobi.pushLocalSeeded");
});

describe("local phone alerts vs FCM", () => {
  it("does not locally alert a notification_id already received via FCM", async () => {
    await rememberReceivedNotification({
      request: { content: { data: { notification_id: "n-fcm" } } },
    });
    const shown = await syncLocalPhoneAlerts([note("n-fcm", "2026-10-20T14:32:00Z"), note("n-new", "2026-10-20T14:57:00Z")]);
    expect(shown).toBe(1);
    expect(idsOfScheduled()).toEqual(["n-new"]);
    const seen = JSON.parse(mockMemory.get("tamkobi.pushLocalSeen") || "[]") as string[];
    expect(seen).toEqual(expect.arrayContaining(["n-fcm", "n-new"]));
  });

  it("remembers a wrapped FCM payload and skips it on the next pull", async () => {
    await rememberReceivedNotification({
      notification: { request: { content: { data: { notification_id: "wrap-1" } } } },
    });
    const shown = await syncLocalPhoneAlerts([note("wrap-1")]);
    expect(shown).toBe(0);
    expect(scheduled).toHaveLength(0);
  });

  it("returns 0 alerts when the push token is registered", async () => {
    mockMemory.set("tamkobi.pushToken", "ExponentPushToken[abc123]");
    const shown = await syncLocalPhoneAlerts([note("a"), note("b")]);
    expect(shown).toBe(0);
    expect(scheduled).toHaveLength(0);
    expect(mockMemory.get("tamkobi.pushLocalSeeded")).toBe("1");
    const seen = JSON.parse(mockMemory.get("tamkobi.pushLocalSeen") || "[]") as string[];
    expect(seen).toEqual(expect.arrayContaining(["a", "b"]));
  });

  it("does not alert on an unseeded pull when remote push is ok", async () => {
    mockMemory.set("tamkobi.pushToken", "ExponentPushToken[abc123]");
    expect(mockMemory.has("tamkobi.pushLocalSeeded")).toBe(false);
    const shown = await syncLocalPhoneAlerts([note("fresh")]);
    expect(shown).toBe(0);
    expect(scheduled).toHaveLength(0);
    expect(mockMemory.get("tamkobi.pushLocalSeeded")).toBe("1");
    expect(JSON.parse(mockMemory.get("tamkobi.pushLocalSeen") || "[]")).toEqual(["fresh"]);
  });

  it("keeps local alerts when there is no push token", async () => {
    const shown = await syncLocalPhoneAlerts([note("only")]);
    expect(shown).toBe(1);
    expect(idsOfScheduled()).toEqual(["only"]);
    expect(scheduled[0]?.identifier).toBe("tk-only");
  });

  it("keeps local alerts when the token never reached the server", async () => {
    mockMemory.set("tamkobi.pushToken", "ExponentPushToken[abc123]");
    mockMemory.set(PUSH_LAST_ERROR_KEY, JSON.stringify({ status: "unavailable", error: "Token sunucuya yazılamadı." }));
    const shown = await syncLocalPhoneAlerts([note("pending")]);
    expect(shown).toBe(1);
    expect(idsOfScheduled()).toEqual(["pending"]);
  });

  it("does not schedule when the tray already has the same notification_id", async () => {
    presented = [{
      request: {
        identifier: "fcm-native",
        content: { data: { notification_id: "tray-1" } },
      },
    }];
    const ok = await presentLocalNotification(localPushContent(note("tray-1")));
    expect(ok).toBe(false);
    expect(scheduled).toHaveLength(0);
  });

  it("does not present the same notification_id twice", async () => {
    const content = localPushContent(note("same"));
    expect(await presentLocalNotification(content)).toBe(true);
    expect(await presentLocalNotification(content)).toBe(false);
    expect(scheduled).toHaveLength(1);
    expect(scheduled[0]?.identifier).toBe("tk-same");
  });

  it("skips a tray notification that already has the same data.notification_id", async () => {
    presented = [{
      request: {
        identifier: "fcm-native",
        content: { data: { notification_id: "tray-1" } },
      },
    }];
    const shown = await syncLocalPhoneAlerts([note("tray-1"), note("other")]);
    expect(shown).toBe(1);
    expect(idsOfScheduled()).toEqual(["other"]);
  });

  it("registers the token without logging it and then suppresses local alerts", async () => {
    const originals = {
      log: console.log,
      info: console.info,
      debug: console.debug,
      warn: console.warn,
      error: console.error,
    };
    const capture = (...args: unknown[]) => {
      logLines.push(args.map((item) => String(item)).join(" "));
    };
    console.log = capture;
    console.info = capture;
    console.debug = capture;
    console.warn = capture;
    console.error = capture;
    try {
      const result = await registerDevicePush(client);
      expect(result.status).toBe("ok");
      expect(post).toHaveBeenCalledWith(
        client,
        "/notifications/push-token",
        expect.objectContaining({ platform: "android", token: "ExponentPushToken[abc123]" }),
      );
      const shown = await syncLocalPhoneAlerts([note("after-register")]);
      expect(shown).toBe(0);
      expect(scheduled).toHaveLength(0);
      expect(logLines.join("\n")).not.toContain("ExponentPushToken[abc123]");
    } finally {
      console.log = originals.log;
      console.info = originals.info;
      console.debug = originals.debug;
      console.warn = originals.warn;
      console.error = originals.error;
    }
  });
});
