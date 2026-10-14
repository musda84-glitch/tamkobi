import {
  companyEventStreamEnabled,
  emitLiveRefresh,
  nextRetryDelay,
  parseSseChunk,
  scopesForEventType,
  scopesOverlap,
  shouldRefreshOnForeground,
  subscribeLiveRefresh,
} from "./companyEvents";

test("parseSseChunk yields type and id and keeps a partial tail", () => {
  const raw = 'event: changed\ndata: {"event":"changed","type":"invoice","id":"f1"}\n\n: ping\n\ndata: {"event":"cha';
  const parsed = parseSseChunk(raw);
  expect(parsed.events).toEqual([{ event: "changed", data: { event: "changed", type: "invoice", id: "f1" } }]);
  expect(parsed.rest).toContain("cha");
  expect(JSON.stringify(parsed.events[0].data)).not.toContain("amount");
});

test("scopes overlap and unknown types refresh everything", () => {
  expect(scopesForEventType("stock")).toEqual(["stock"]);
  expect(scopesOverlap(["cash"], scopesForEventType("payment"))).toBe(true);
  expect(scopesOverlap(["stock"], scopesForEventType("contact"))).toBe(false);
  expect(scopesOverlap(["orders"], scopesForEventType("nope"))).toBe(true);
});

test("foreground and retry", () => {
  expect(shouldRefreshOnForeground("active")).toBe(true);
  expect(shouldRefreshOnForeground("background")).toBe(false);
  expect(nextRetryDelay(0)).toBe(1000);
  expect(nextRetryDelay(6)).toBe(15000);
});

test("ik and ynt hosts do not open the company event stream", () => {
  expect(companyEventStreamEnabled("https://ik.tamkobi.com")).toBe(false);
  expect(companyEventStreamEnabled("https://ynt.taiyazilim.com")).toBe(false);
  expect(companyEventStreamEnabled("https://app.tamkobi.com")).toBe(true);
  expect(companyEventStreamEnabled("https://tamkobi.com")).toBe(true);
  expect(companyEventStreamEnabled("")).toBe(true);
});

test("emitLiveRefresh reaches subscribers", () => {
  const seen: string[][] = [];
  const stop = subscribeLiveRefresh((scopes) => seen.push(scopes));
  emitLiveRefresh(["cash"]);
  stop();
  emitLiveRefresh(["stock"]);
  expect(seen).toEqual([["cash"]]);
});
