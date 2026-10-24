import AsyncStorage from "@react-native-async-storage/async-storage";
import { HOME_QUICK_EXTRA_KEY, HOME_QUICK_HIDDEN_KEY } from "./homeQuickHidden";
import { splitNotificationsTile, visibleQuickTiles } from "./quickMenu";
import {
  HOME_QUICK_ORDER_PREFIX,
  homeQuickOrderKey,
  isDefaultQuickOrder,
  moveQuickTile,
  parseStoredQuickOrder,
  readHomeQuickOrder,
  reconcileQuickOrder,
  resetHomeQuickOrder,
  serializeQuickOrder,
  tileDropIndex,
  writeHomeQuickOrder,
} from "./homeQuickOrder";

const store = new Map<string, string>();

jest.mock("@react-native-async-storage/async-storage", () => ({
  getItem: jest.fn(async (key: string) => store.get(key) ?? null),
  setItem: jest.fn(async (key: string, value: string) => { store.set(key, value); }),
  removeItem: jest.fn(async (key: string) => { store.delete(key); }),
}));

const ALLOWED = ["invoices", "contacts", "orders", "vehicles"];

describe("homeQuickOrder", () => {
  beforeEach(() => {
    store.clear();
    (AsyncStorage.getItem as jest.Mock).mockClear();
    (AsyncStorage.setItem as jest.Mock).mockClear();
    (AsyncStorage.removeItem as jest.Mock).mockClear();
  });

  it("keeps a different key per user and company and stays off the hidden keys", () => {
    expect(HOME_QUICK_ORDER_PREFIX).toBe("tamkobi.home.quick_order.v1");
    expect(homeQuickOrderKey("u1", "c1")).toBe("tamkobi.home.quick_order.v1:u1:c1");
    expect(homeQuickOrderKey("u1", "c2")).not.toBe(homeQuickOrderKey("u1", "c1"));
    expect(homeQuickOrderKey("u2", "c1")).not.toBe(homeQuickOrderKey("u1", "c1"));
    expect(homeQuickOrderKey("u1", "c1")).not.toBe(HOME_QUICK_HIDDEN_KEY);
    expect(homeQuickOrderKey("u1", "c1")).not.toBe(HOME_QUICK_EXTRA_KEY);
  });

  it("parses only string ids and drops broken JSON", () => {
    expect(parseStoredQuickOrder(null)).toEqual([]);
    expect(parseStoredQuickOrder("")).toEqual([]);
    expect(parseStoredQuickOrder("{bozuk")).toEqual([]);
    expect(parseStoredQuickOrder("{}")).toEqual([]);
    expect(parseStoredQuickOrder('["vehicles", "vehicles", " ", 7, {"token":"x"}]')).toEqual(["vehicles"]);
  });

  it("saves an order and reads it back for the same user and company", async () => {
    const order = ["vehicles", "invoices", "contacts", "orders"];
    await writeHomeQuickOrder("u1", "c1", order, ALLOWED);
    await expect(readHomeQuickOrder("u1", "c1")).resolves.toEqual(order);
    await expect(readHomeQuickOrder("u1", "c2")).resolves.toEqual([]);
    await expect(readHomeQuickOrder("u2", "c1")).resolves.toEqual([]);
    const raw = store.get(homeQuickOrderKey("u1", "c1")) || "";
    expect(raw).toBe(JSON.stringify(order));
    expect(raw).not.toMatch(/@|token|password|email/i);
    expect(JSON.parse(raw).every((id: unknown) => typeof id === "string")).toBe(true);
  });

  it("resets the order key and leaves the hidden key untouched", async () => {
    store.set(HOME_QUICK_HIDDEN_KEY, JSON.stringify(["vehicles"]));
    await writeHomeQuickOrder("u1", "c1", ["vehicles", "invoices"], ALLOWED);
    const reset = await resetHomeQuickOrder("u1", "c1", ALLOWED);
    expect(AsyncStorage.removeItem).toHaveBeenCalledWith(homeQuickOrderKey("u1", "c1"));
    expect(AsyncStorage.removeItem).not.toHaveBeenCalledWith(HOME_QUICK_HIDDEN_KEY);
    expect(store.get(HOME_QUICK_HIDDEN_KEY)).toBe(JSON.stringify(["vehicles"]));
    expect(reset).toEqual(ALLOWED);
    await expect(readHomeQuickOrder("u1", "c1")).resolves.toEqual([]);
    expect(isDefaultQuickOrder(reset, ALLOWED)).toBe(true);
    expect(isDefaultQuickOrder(["vehicles", "invoices", "contacts", "orders"], ALLOWED)).toBe(false);
  });

  it("appends new ids and drops deleted ones", () => {
    expect(reconcileQuickOrder(["vehicles", "invoices"], ["invoices", "contacts", "vehicles", "orders"])).toEqual([
      "vehicles",
      "invoices",
      "contacts",
      "orders",
    ]);
    expect(reconcileQuickOrder(["invoices", "gone", "vehicles"], ALLOWED)).toEqual([
      "invoices",
      "vehicles",
      "contacts",
      "orders",
    ]);
  });

  it("drops tiles the role cannot see and keeps the rest in saved order", () => {
    const user = { role: "sales", permissions: { "/banking": "none", "/stock": "view", "/invoices": "view" } };
    const allowed = splitNotificationsTile(visibleQuickTiles(user, { modules: { "/cheques": false } })).tiles.map((tile) => tile.id);
    expect(allowed).not.toContain("banking");
    expect(allowed).not.toContain("pay");
    expect(allowed).not.toContain("cheques");
    expect(allowed).toContain("invoices");
    const next = reconcileQuickOrder(["banking", "cheques", "pay", "invoices", "ghost-token"], allowed);
    expect(next).not.toContain("banking");
    expect(next).not.toContain("pay");
    expect(next).not.toContain("cheques");
    expect(next).not.toContain("ghost-token");
    expect(next[0]).toBe("invoices");
    expect([...next].sort()).toEqual([...allowed].sort());
    expect(next.filter((id) => id !== "invoices").every((id) => next.indexOf(id) > 0)).toBe(true);
  });

  it("moves a tile and ignores a drop on the same cell", () => {
    expect(moveQuickTile(ALLOWED, 0, 2)).toEqual(["contacts", "orders", "invoices", "vehicles"]);
    expect(moveQuickTile(ALLOWED, 0, 0)).toEqual(ALLOWED);
    expect(moveQuickTile(ALLOWED, -1, 1)).toEqual(ALLOWED);
    expect(tileDropIndex({
      fromIndex: 0,
      dx: 90,
      dy: 0,
      cellWidth: 90,
      cellHeight: 124,
      columns: 4,
      count: 4,
    })).toBe(1);
    expect(tileDropIndex({
      fromIndex: 0,
      dx: 20,
      dy: 10,
      cellWidth: 90,
      cellHeight: 124,
      columns: 4,
      count: 4,
    })).toBe(0);
    expect(tileDropIndex({
      fromIndex: 1,
      dx: 0,
      dy: 124,
      cellWidth: 90,
      cellHeight: 124,
      columns: 4,
      count: 6,
    })).toBe(5);
    expect(tileDropIndex({
      fromIndex: 0,
      dx: 400,
      dy: 0,
      cellWidth: 0,
      cellHeight: 124,
      columns: 4,
      count: 4,
    })).toBe(0);
  });

  it("does not write without a user or company and survives storage errors", async () => {
    await writeHomeQuickOrder("", "c1", ["invoices"], ALLOWED);
    await writeHomeQuickOrder("u1", "", ["invoices"], ALLOWED);
    expect(AsyncStorage.setItem).not.toHaveBeenCalled();
    await expect(readHomeQuickOrder("", "c1")).resolves.toEqual([]);
    (AsyncStorage.getItem as jest.Mock).mockRejectedValueOnce(new Error("read"));
    await expect(readHomeQuickOrder("u1", "c1")).resolves.toEqual([]);
    (AsyncStorage.setItem as jest.Mock).mockRejectedValueOnce(new Error("write"));
    await expect(writeHomeQuickOrder("u1", "c1", ["vehicles"], ALLOWED)).resolves.toBeNull();
    expect(serializeQuickOrder(["nope", "vehicles"], ALLOWED)).toBe(JSON.stringify([
      "vehicles",
      "invoices",
      "contacts",
      "orders",
    ]));
  });
});
