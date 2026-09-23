import { describe, expect, test } from "@jest/globals";
import {
  dismissKey,
  dismissNotice,
  formatCountdown,
  isDismissed,
  isUpdateTransportError,
  makeTransportNotice,
  pickVisibleNotice,
  remainingMs,
  UPDATE_DONE_NOTICE,
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
  test("pickVisibleNotice prefers active maintenance and keeps ends_at", () => {
    const n = pickVisibleNotice({
      maintenance: {
        active: true,
        title: "Bakım",
        body: "Şimdi",
        notify_popup: true,
        ends_at: "2026-09-23T15:30:00+00:00",
      },
      announcements: [{ id: "a1", title: "X", body: "Y" }],
    }, memStore());
    expect(n.id).toBe("maintenance-active");
    expect(n.activeUpdate).toBe(true);
    expect(n.dismissible).toBe(false);
    expect(n.ends_at).toBe("2026-09-23T15:30:00+00:00");
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

  test("countdown helpers and transport/done notices", () => {
    expect(formatCountdown(125000)).toBe("02:05");
    expect(formatCountdown(0)).toBe("00:00");
    expect(formatCountdown(-5000)).toBe("00:00");
    const now = Date.parse("2026-09-23T12:00:00.000Z");
    expect(remainingMs("2026-09-23T12:02:00.000Z", now)).toBe(120000);
    const t = makeTransportNotice(now);
    expect(t.activeUpdate).toBe(true);
    expect(t.etaEstimated).toBe(true);
    expect(t.ends_at).toBe("2026-09-23T12:05:00.000Z");
    expect(UPDATE_DONE_NOTICE.updateDone).toBe(true);
    expect(UPDATE_DONE_NOTICE.activeUpdate).toBe(false);
  });
});
