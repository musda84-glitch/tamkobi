import { describe, expect, test } from "@jest/globals";
import {
  dismissKey,
  dismissNotice,
  isDismissed,
  isUpdateTransportError,
  pickVisibleNotice,
} from "./platformNotices";

function memStore() {
  const map = new Map();
  return {
    getItem: (k) => (map.has(k) ? map.get(k) : null),
    setItem: (k, v) => { map.set(k, String(v)); },
    removeItem: (k) => { map.delete(k); },
  };
}

describe("platformNotices", () => {
  test("pickVisibleNotice prefers active maintenance", () => {
    const n = pickVisibleNotice({
      maintenance: { active: true, title: "Bakım", body: "Şimdi", notify_popup: true },
      announcements: [{ id: "a1", title: "X", body: "Y" }],
    }, memStore());
    expect(n.id).toBe("maintenance-active");
    expect(n.activeUpdate).toBe(true);
    expect(n.dismissible).toBe(false);
  });

  test("pickVisibleNotice skips dismissed announcements", () => {
    const store = memStore();
    dismissNotice("a1", store);
    expect(isDismissed("a1", store)).toBe(true);
    expect(dismissKey("a1")).toContain("a1");
    const n = pickVisibleNotice({
      announcements: [
        { id: "a1", title: "Eski", body: "…" },
        { id: "a2", title: "Yeni", body: "Merhaba" },
      ],
    }, store);
    expect(n.id).toBe("a2");
    expect(n.title).toBe("Yeni");
  });

  test("upcoming maintenance shows as dismissible popup", () => {
    const n = pickVisibleNotice({
      maintenance: {
        upcoming: true,
        notify_popup: true,
        title: "Yarın güncelleme",
        body: "Planlı",
        starts_at: "2026-09-24T02:00:00+00:00",
      },
      announcements: [],
    }, memStore());
    expect(n.id).toBe("maintenance-upcoming");
    expect(n.dismissible).toBe(true);
  });

  test("isUpdateTransportError detects 503 and network", () => {
    expect(isUpdateTransportError({ response: { status: 503 } })).toBe(true);
    expect(isUpdateTransportError({ response: { status: 502 } })).toBe(true);
    expect(isUpdateTransportError({ code: "ERR_NETWORK", message: "Network Error" })).toBe(true);
    expect(isUpdateTransportError({ response: { status: 400 } })).toBe(false);
  });
});
