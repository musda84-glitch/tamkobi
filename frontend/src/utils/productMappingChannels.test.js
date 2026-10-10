import { describe, expect, it } from "@jest/globals";
import { connectedMapChannels, pickMapChannel } from "./productMappingChannels";

describe("productMappingChannels", () => {
  it("lists only active added integrations, unique by channel", () => {
    expect(connectedMapChannels([
      { channel: "trendyol", channel_name: "Trendyol", is_active: true },
      { channel: "n11", channel_name: "N11", is_active: true },
      { channel: "trendyol", channel_name: "Trendyol 2", is_active: true },
      { channel: "hepsiburada", channel_name: "HB", is_active: false },
      { channel: "", channel_name: "Boş" },
    ])).toEqual([
      { channel: "trendyol", label: "Trendyol" },
      { channel: "n11", label: "N11" },
    ]);
  });

  it("falls back to channelTr when name missing", () => {
    expect(connectedMapChannels([{ channel: "ciceksepeti" }])).toEqual([
      { channel: "ciceksepeti", label: "Çiçeksepeti" },
    ]);
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
