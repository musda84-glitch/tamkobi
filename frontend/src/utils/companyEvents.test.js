import { companyEventStreamEnabled, createChangeBuffer, nextRetryDelay, parseSseBlock, scopesForEventType } from "./companyEvents";

test("scopesForEventType maps finance entities and falls back to all", () => {
  expect(scopesForEventType("invoice")).toEqual(["invoices", "contacts", "cash"]);
  expect(scopesForEventType("transfer")).toEqual(["cash", "contacts"]);
  expect(scopesForEventType("stock")).toEqual(["stock"]);
  expect(scopesForEventType("unknown-kind")).toEqual(["all"]);
});

test("parseSseBlock reads changed type and id only", () => {
  const parsed = parseSseBlock('event: changed\ndata: {"event":"changed","type":"order","id":"o1"}\n');
  expect(parsed).toEqual({ event: "changed", data: { event: "changed", type: "order", id: "o1" } });
  expect(parseSseBlock(": ping\n")).toBeNull();
});

test("createChangeBuffer debounces a burst into one refresh", () => {
  jest.useFakeTimers();
  const flushed = [];
  const buf = createChangeBuffer({ debounceMs: 400, onFlush: (scopes) => flushed.push(scopes) });
  buf.push("invoice");
  buf.push("contact");
  buf.push("invoice");
  expect(flushed).toEqual([]);
  jest.advanceTimersByTime(399);
  expect(flushed).toEqual([]);
  jest.advanceTimersByTime(1);
  expect(flushed).toEqual([["invoices", "contacts", "cash"]]);
  buf.cancel();
  jest.useRealTimers();
});

test("flushNow refreshes immediately and reconnect delay backs off", () => {
  const flushed = [];
  const buf = createChangeBuffer({ debounceMs: 400, onFlush: (scopes) => flushed.push(scopes) });
  buf.push("stock");
  buf.flushNow(["all"]);
  expect(flushed).toEqual([["stock", "all"]]);
  expect(nextRetryDelay(0)).toBe(1000);
  expect(nextRetryDelay(4)).toBe(15000);
  expect(nextRetryDelay(8)).toBe(15000);
});

test("ik and ynt hosts do not open the company event stream", () => {
  expect(companyEventStreamEnabled("ik")).toBe(false);
  expect(companyEventStreamEnabled("ynt")).toBe(false);
  expect(companyEventStreamEnabled("app")).toBe(true);
  expect(companyEventStreamEnabled("b2b")).toBe(true);
  expect(companyEventStreamEnabled("site")).toBe(true);
});
