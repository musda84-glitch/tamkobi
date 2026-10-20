import AsyncStorage from "@react-native-async-storage/async-storage";
import { DEFAULT_OVERVIEW_SECTION_ORDER } from "../components/home/overviewSections";
import {
  HOME_OVERVIEW_ORDER_PREFIX,
  homeOverviewOrderKey,
  isDefaultOverviewOrder,
  moveOverviewSection,
  normalizeOverviewOrder,
  parseOverviewOrder,
  readHomeOverviewOrder,
  resetHomeOverviewOrder,
  serializeOverviewOrder,
  writeHomeOverviewOrder,
} from "./homeOverviewOrder";

const store = new Map<string, string>();

jest.mock("@react-native-async-storage/async-storage", () => ({
  getItem: jest.fn(async (key: string) => store.get(key) ?? null),
  setItem: jest.fn(async (key: string, value: string) => { store.set(key, value); }),
  removeItem: jest.fn(async (key: string) => { store.delete(key); }),
}));

jest.mock("react-native", () => ({
  Platform: { OS: "ios", select: (spec: { ios?: unknown; default?: unknown }) => spec.ios ?? spec.default },
  StyleSheet: { absoluteFill: {}, hairlineWidth: 1, create: (styles: Record<string, unknown>) => styles },
  View: () => null,
  Text: () => null,
  Pressable: () => null,
}));
jest.mock("@expo/vector-icons", () => ({ Ionicons: () => null }));
jest.mock("expo-router", () => ({ router: { push: jest.fn(), navigate: jest.fn() } }));

const DEFAULT = [...DEFAULT_OVERVIEW_SECTION_ORDER];

describe("homeOverviewOrder", () => {
  beforeEach(() => {
    store.clear();
    (AsyncStorage.getItem as jest.Mock).mockClear();
    (AsyncStorage.setItem as jest.Mock).mockClear();
    (AsyncStorage.removeItem as jest.Mock).mockClear();
  });

  it("keeps a different key per user and company", () => {
    expect(HOME_OVERVIEW_ORDER_PREFIX).toBe("tamkobi.home.overview_order.v1");
    expect(homeOverviewOrderKey("u1", "c1")).toBe("tamkobi.home.overview_order.v1:u1:c1");
    expect(homeOverviewOrderKey("u1", "c2")).toBe("tamkobi.home.overview_order.v1:u1:c2");
    expect(homeOverviewOrderKey("u2", "c1")).toBe("tamkobi.home.overview_order.v1:u2:c1");
    expect(homeOverviewOrderKey("u1", "c2")).not.toBe(homeOverviewOrderKey("u1", "c1"));
    expect(homeOverviewOrderKey("u2", "c1")).not.toBe(homeOverviewOrderKey("u1", "c1"));
  });

  it("parses empty or broken JSON as the default order", () => {
    expect(parseOverviewOrder(null)).toEqual(DEFAULT);
    expect(parseOverviewOrder("")).toEqual(DEFAULT);
    expect(parseOverviewOrder("{bozuk")).toEqual(DEFAULT);
    expect(parseOverviewOrder("{}")).toEqual(DEFAULT);
    expect(parseOverviewOrder("42")).toEqual(DEFAULT);
  });

  it("appends missing keys in default order", () => {
    expect(normalizeOverviewOrder(["stock", "today"])).toEqual([
      "stock",
      "today",
      "panels",
      "month",
      "production",
      "projects",
    ]);
  });

  it("drops unknown values and duplicates and stays a permutation of the default", () => {
    const order = normalizeOverviewOrder(["foo", 7, null, "month", "month", "today"]);
    expect(order).toEqual(["month", "today", "panels", "stock", "production", "projects"]);
    expect(order).toHaveLength(6);
    expect(new Set(order).size).toBe(6);
    expect([...order].sort()).toEqual([...DEFAULT].sort());
  });

  it("appends a new default key onto an older saved list", () => {
    const defaults = ["today", "panels", "month", "stock", "production", "projects", "new"];
    expect(normalizeOverviewOrder(["stock", "today"], defaults)).toEqual([
      "stock",
      "today",
      "panels",
      "month",
      "production",
      "projects",
      "new",
    ]);
  });

  it("round-trips a saved order through serialize and parse", () => {
    const order = ["projects", "stock", "today", "panels", "month", "production"];
    expect(parseOverviewOrder(serializeOverviewOrder(order))).toEqual(order);
  });

  it("reads back the order written for the same user and company", async () => {
    const order = ["stock", "today", "panels", "month", "production", "projects"];
    await writeHomeOverviewOrder("u1", "c1", order);
    await expect(readHomeOverviewOrder("u1", "c1")).resolves.toEqual(order);
    await expect(readHomeOverviewOrder("u1", "c2")).resolves.toEqual(DEFAULT);
    await expect(readHomeOverviewOrder("u2", "c1")).resolves.toEqual(DEFAULT);
  });

  it("resets to the default order and removes the stored key", async () => {
    await writeHomeOverviewOrder("u1", "c1", ["stock", "today"]);
    const reset = await resetHomeOverviewOrder("u1", "c1");
    expect(AsyncStorage.removeItem).toHaveBeenCalledWith(homeOverviewOrderKey("u1", "c1"));
    expect(reset).toEqual(DEFAULT);
    await expect(readHomeOverviewOrder("u1", "c1")).resolves.toEqual(DEFAULT);
  });

  it("returns the default when storage rejects and does not throw on write", async () => {
    (AsyncStorage.getItem as jest.Mock).mockRejectedValueOnce(new Error("read"));
    await expect(readHomeOverviewOrder("u1", "c1")).resolves.toEqual(DEFAULT);
    (AsyncStorage.setItem as jest.Mock).mockRejectedValueOnce(new Error("write"));
    await expect(writeHomeOverviewOrder("u1", "c1", ["stock", "today"])).resolves.toBeNull();
  });

  it("does not write when the user or company id is empty", async () => {
    await writeHomeOverviewOrder("", "c1", ["stock", "today"]);
    await writeHomeOverviewOrder("u1", "", ["stock", "today"]);
    await resetHomeOverviewOrder("", "c1");
    await readHomeOverviewOrder("", "c1");
    expect(AsyncStorage.setItem).not.toHaveBeenCalled();
    expect(AsyncStorage.removeItem).not.toHaveBeenCalled();
    expect(AsyncStorage.getItem).not.toHaveBeenCalled();
    await expect(readHomeOverviewOrder("", "c1")).resolves.toEqual(DEFAULT);
    await expect(resetHomeOverviewOrder("u1", "")).resolves.toEqual(DEFAULT);
  });

  it("detects the default order and rejects a permutation", () => {
    expect(isDefaultOverviewOrder(DEFAULT_OVERVIEW_SECTION_ORDER)).toBe(true);
    expect(isDefaultOverviewOrder([...DEFAULT_OVERVIEW_SECTION_ORDER])).toBe(true);
    expect(isDefaultOverviewOrder(["stock", "today", "panels", "month", "production", "projects"])).toBe(false);
  });

  it("moves a section one step and leaves the ends and unknown keys in place", () => {
    const snapshot = [...DEFAULT];
    expect(moveOverviewSection(DEFAULT, "month", -1)).toEqual([
      "today",
      "month",
      "panels",
      "stock",
      "production",
      "projects",
    ]);
    expect(DEFAULT).toEqual(snapshot);
    expect(moveOverviewSection(DEFAULT, "today", -1)).toEqual(DEFAULT);
    expect(moveOverviewSection(DEFAULT, "projects", 1)).toEqual(DEFAULT);
    expect(moveOverviewSection(DEFAULT, "nope", -1)).toEqual(DEFAULT);
    expect(moveOverviewSection(DEFAULT, "nope", 1)).toEqual(DEFAULT);
    const moved = moveOverviewSection(["stock", "today"], "today", 1);
    expect(moved).toHaveLength(6);
    expect(new Set(moved).size).toBe(6);
    expect([...moved].sort()).toEqual([...DEFAULT].sort());
    const again = moveOverviewSection(moved, "projects", -1);
    expect(again).toHaveLength(6);
    expect(new Set(again).size).toBe(6);
    expect([...again].sort()).toEqual([...DEFAULT].sort());
  });
});
