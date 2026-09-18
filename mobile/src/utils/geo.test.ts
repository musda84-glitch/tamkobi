import { coordText, coordValue, mapsLink, mapsUrlFor, parseMapsUrl } from "./geo";

describe("geo", () => {
  it("parses coordinates from the maps links web accepts", () => {
    expect(parseMapsUrl("https://www.google.com/maps/@41.015137,28.979530,15z")).toEqual({ lat: 41.015137, lng: 28.97953 });
    expect(parseMapsUrl("https://maps.google.com/?q=39.925533,32.866287")).toEqual({ lat: 39.925533, lng: 32.866287 });
    expect(parseMapsUrl("41.0151, 28.9795")).toEqual({ lat: 41.0151, lng: 28.9795 });
    expect(parseMapsUrl("https://maps.app.goo.gl/abc")).toBeNull();
  });

  it("falls back to coordinates when no link is stored", () => {
    expect(mapsLink({ location_url: "https://x.test/map" })).toBe("https://x.test/map");
    expect(mapsLink({ latitude: 41, longitude: 29 })).toBe(mapsUrlFor(41, 29));
    expect(mapsLink({ latitude: null, longitude: null })).toBeNull();
    expect(mapsLink(null)).toBeNull();
  });

  it("keeps empty coordinates null for the API", () => {
    expect(coordValue("")).toBeNull();
    expect(coordValue("41,0151")).toBe(41.0151);
    expect(coordValue("abc")).toBeNull();
    expect(coordText(null)).toBe("");
    expect(coordText(41.5)).toBe("41.5");
  });
});
