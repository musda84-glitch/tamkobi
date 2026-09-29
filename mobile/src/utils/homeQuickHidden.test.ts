import {
  filterHiddenQuickTiles,
  hideQuickTile,
  hiddenQuickTilesToRestore,
  parseHiddenTileIds,
  restoreQuickTile,
  serializeHiddenTileIds,
} from "./homeQuickHidden";

describe("homeQuickHidden", () => {
  it("parses and serializes unique tile ids", () => {
    expect(parseHiddenTileIds(null)).toEqual([]);
    expect(parseHiddenTileIds('["vehicles","vehicles"," "]')).toEqual(["vehicles"]);
    expect(serializeHiddenTileIds(["vehicles", "vehicles", ""])).toBe('["vehicles"]');
  });

  it("hides and restores tiles", () => {
    expect(hideQuickTile([], "vehicles")).toEqual(["vehicles"]);
    expect(hideQuickTile(["vehicles"], "vehicles")).toEqual(["vehicles"]);
    expect(restoreQuickTile(["vehicles", "atolye"], "vehicles")).toEqual(["atolye"]);
  });

  it("filters home tiles and lists restore candidates", () => {
    const tiles = [{ id: "a" }, { id: "vehicles" }, { id: "b" }];
    expect(filterHiddenQuickTiles(tiles, ["vehicles"]).map((t) => t.id)).toEqual(["a", "b"]);
    expect(hiddenQuickTilesToRestore(tiles, ["vehicles", "missing"]).map((t) => t.id)).toEqual(["vehicles"]);
  });
});
