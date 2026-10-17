const mockMemory = new Map<string, string>();
const mockGetExpoPushTokenAsync = jest.fn();

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
  getExpoPushTokenAsync: (...args: unknown[]) => mockGetExpoPushTokenAsync(...args),
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
import { FCM_PUSH_UNAVAILABLE, PUSH_LAST_ERROR_KEY, getStoredPushToken, registerDevicePush } from "../pushRegister";

const client = { baseUrl: "https://tamkobi.com", token: "sess" };

beforeEach(() => {
  mockMemory.clear();
  mockGetExpoPushTokenAsync.mockReset();
  (post as jest.Mock).mockClear();
});

describe("registerDevicePush FCM errors", () => {
  it("stores the FCM message when FirebaseApp is not initialized", async () => {
    mockGetExpoPushTokenAsync.mockRejectedValue(new Error("Default FirebaseApp is not initialized"));
    const result = await registerDevicePush(client);
    expect(result.status).toBe("unavailable");
    expect(result.error).toBe(FCM_PUSH_UNAVAILABLE);
    const stored = JSON.parse(mockMemory.get(PUSH_LAST_ERROR_KEY) || "");
    expect(stored).toEqual({ status: "unavailable", error: FCM_PUSH_UNAVAILABLE });
    expect(post).not.toHaveBeenCalled();
  });

  it("keeps other token errors as-is", async () => {
    mockGetExpoPushTokenAsync.mockRejectedValue(new Error("network down"));
    const result = await registerDevicePush(client);
    expect(result.status).toBe("unavailable");
    expect(result.error).toBe("network down");
    expect(JSON.parse(mockMemory.get(PUSH_LAST_ERROR_KEY) || "").error).toBe("network down");
  });

  it("clears the last error after the token is registered", async () => {
    mockMemory.set(PUSH_LAST_ERROR_KEY, JSON.stringify({ status: "unavailable", error: FCM_PUSH_UNAVAILABLE }));
    mockGetExpoPushTokenAsync.mockResolvedValue({ data: "ExponentPushToken[abc123]" });
    const result = await registerDevicePush(client);
    expect(result.status).toBe("ok");
    expect(result.token).toBe("ExponentPushToken[abc123]");
    expect(mockMemory.has(PUSH_LAST_ERROR_KEY)).toBe(false);
    expect(await getStoredPushToken()).toBe("ExponentPushToken[abc123]");
    expect(post).toHaveBeenCalled();
  });
});
