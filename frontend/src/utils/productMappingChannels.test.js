import { describe, expect, it } from "@jest/globals";
import { NON_MARKETPLACE_CHANNELS, connectedMapChannels, isMappableChannel, pickMapChannel } from "./productMappingChannels";

describe("productMappingChannels", () => {
  it("lists every added integration, including inactive, plus unique extra channel codes", () => {
    expect(connectedMapChannels([
      { channel: "trendyol", channel_name: "Trendyol", is_active: true },
      { channel: "n11", channel_name: "N11", is_active: true },
      { channel: "trendyol", channel_name: "Trendyol 2", is_active: true },
      { channel: "hepsiburada", channel_name: "HB", is_active: false },
      { channel: "", channel_name: "Boş" },
    ], ["n11", "pazarama", "flo", "b2b", "manual", "saha", "", "  ", null])).toEqual([
      { channel: "trendyol", label: "Trendyol" },
      { channel: "n11", label: "N11" },
      { channel: "hepsiburada", label: "HB" },
      { channel: "pazarama", label: "Pazarama" },
      { channel: "flo", label: "flo" },
    ]);
  });

  it("falls back to channelTr when name missing", () => {
    expect(connectedMapChannels([{ channel: "ciceksepeti" }])).toEqual([
      { channel: "ciceksepeti", label: "Çiçeksepeti" },
    ]);
  });

  it("isMappableChannel uses the same lowercase key and skips b2b, manual, saha", () => {
    expect([...NON_MARKETPLACE_CHANNELS].sort()).toEqual(["b2b", "manual", "saha"]);
    expect(isMappableChannel("  Hepsiburada ")).toBe(true);
    expect(isMappableChannel("n11")).toBe(true);
    expect(isMappableChannel("manual")).toBe(false);
    expect(isMappableChannel("MANUAL")).toBe(false);
    expect(isMappableChannel("b2b")).toBe(false);
    expect(isMappableChannel(" Saha ")).toBe(false);
    expect(isMappableChannel("")).toBe(false);
    expect(isMappableChannel(null)).toBe(false);
  });

  it("pickMapChannel keeps current when still available", () => {
    const ch = connectedMapChannels([
      { channel: "n11", channel_name: "N11" },
      { channel: "trendyol", channel_name: "Trendyol" },
    ]);
    expect(pickMapChannel("trendyol", ch)).toBe("trendyol");
    expect(pickMapChannel("amazon", ch)).toBe("n11");
    expect(pickMapChannel("x", [])).toBe("");
  });
});
