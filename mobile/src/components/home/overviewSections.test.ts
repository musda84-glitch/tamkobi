import { DEFAULT_OVERVIEW_SECTION_ORDER, type OverviewSectionKey } from "./overviewSections";

jest.mock("react-native", () => ({
  Platform: { OS: "ios", select: (spec: { ios?: unknown; default?: unknown }) => spec.ios ?? spec.default },
  StyleSheet: { absoluteFill: {}, hairlineWidth: 1, create: (styles: Record<string, unknown>) => styles },
  View: () => null,
  Text: () => null,
  Pressable: () => null,
}));
jest.mock("@expo/vector-icons", () => ({ Ionicons: () => null }));
jest.mock("expo-router", () => ({ router: { push: jest.fn(), navigate: jest.fn() } }));

const EXPECTED: OverviewSectionKey[] = ["today", "panels", "month", "stock", "production", "projects"];

describe("DEFAULT_OVERVIEW_SECTION_ORDER", () => {
  it("lists six unique section keys", () => {
    expect(DEFAULT_OVERVIEW_SECTION_ORDER).toEqual(EXPECTED);
    expect(DEFAULT_OVERVIEW_SECTION_ORDER).toHaveLength(6);
    expect(new Set(DEFAULT_OVERVIEW_SECTION_ORDER).size).toBe(DEFAULT_OVERVIEW_SECTION_ORDER.length);
  });
});
