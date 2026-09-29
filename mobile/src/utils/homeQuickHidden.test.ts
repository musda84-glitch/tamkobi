import {
  MORE_SCREEN_TO_TILE,
  addExtraTile,
  filterHomeQuickTiles,
  hideQuickTile,
  isTileOnHome,
  parseHiddenTileIds,
  removeExtraTile,
  restoreQuickTile,
  serializeHiddenTileIds,
} from "./homeQuickHidden";

describe("homeQuickHidden", () => {
  it("parses and serializes unique tile ids", () => {
    expect(parseHiddenTileIds(null)).toEqual([]);
    expect(parseHiddenTileIds('["vehicles","vehicles"," "]')).toEqual(["vehicles"]);
    expect(serializeHiddenTileIds(["vehicles", "vehicles", ""])).toBe('["vehicles"]');
  });

  it("hides default tiles and restores them", () => {
    expect(hideQuickTile([], "vehicles")).toEqual(["vehicles"]);
    expect(restoreQuickTile(["vehicles", "atolye"], "vehicles")).toEqual(["atolye"]);
    expect(isTileOnHome({ id: "vehicles" }, ["vehicles"], [])).toBe(false);
    expect(isTileOnHome({ id: "vehicles" }, [], [])).toBe(true);
  });

  it("keeps opt-in tiles off home until added", () => {
    const sayim = { id: "sayim", optIn: true as const };
    expect(isTileOnHome(sayim, [], [])).toBe(false);
    expect(isTileOnHome(sayim, [], addExtraTile([], "sayim"))).toBe(true);
    expect(isTileOnHome(sayim, [], removeExtraTile(["sayim"], "sayim"))).toBe(false);
  });

  it("filters home grid with hidden + extras", () => {
    const tiles = [
      { id: "a" },
      { id: "vehicles" },
      { id: "sayim", optIn: true as const },
    ];
    expect(filterHomeQuickTiles(tiles, ["vehicles"], ["sayim"]).map((t) => t.id)).toEqual(["a", "sayim"]);
  });

  it("maps Daha screens to tile ids for Ekle", () => {
    expect(MORE_SCREEN_TO_TILE.Vehicles).toBe("vehicles");
    expect(MORE_SCREEN_TO_TILE.StockCount).toBe("sayim");
    expect(MORE_SCREEN_TO_TILE.Production).toBe("production");
    expect(MORE_SCREEN_TO_TILE.Settings).toBe("settings");
  });
});
