import { navigateNewOrder, stripNewOrderParam } from "./ordersNewQuery";

test("stripNewOrderParam removes only new=1", () => {
  const sp = new URLSearchParams("new=1&status=pending");
  const next = stripNewOrderParam(sp);
  expect(next.get("new")).toBeNull();
  expect(next.get("status")).toBe("pending");
  expect(stripNewOrderParam(new URLSearchParams("q=abc"))).toBeNull();
});

test("navigateNewOrder remounts query when already open", () => {
  const calls = [];
  const navigate = (to, opts) => calls.push({ to, opts });
  navigateNewOrder(navigate, { pathname: "/stock", search: "" });
  expect(calls).toEqual([{ to: "/orders?new=1", opts: undefined }]);

  calls.length = 0;
  navigateNewOrder(navigate, { pathname: "/orders", search: "?new=1" });
  expect(calls[0]).toEqual({ to: "/orders", opts: { replace: true } });
  // microtask
  return Promise.resolve().then(() => {
    expect(calls[1]).toEqual({ to: "/orders?new=1", opts: undefined });
  });
});
