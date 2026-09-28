import { shopFloorCardActions, shopFloorCardBorder } from "./shopFloorActions";

describe("shopFloorCardActions", () => {
  test("ready shows only start", () => {
    expect(shopFloorCardActions("ready")).toEqual({
      start: true, pause: false, resume: false, finish: false,
    });
  });

  test("in_progress shows Duraklat + Bitir", () => {
    expect(shopFloorCardActions("in_progress")).toEqual({
      start: false, pause: true, resume: false, finish: true,
    });
  });

  test("paused shows Devam + Bitir", () => {
    expect(shopFloorCardActions("paused")).toEqual({
      start: false, pause: false, resume: true, finish: true,
    });
  });

  test("border highlights running and paused", () => {
    expect(shopFloorCardBorder("in_progress")).toMatch(/amber/);
    expect(shopFloorCardBorder("paused")).toMatch(/orange/);
    expect(shopFloorCardBorder("ready")).toMatch(/blue/);
  });
});
