import { notifySoundPlan, TAMKOBI_NOTIFY_SRC } from "./notifySound";

describe("notifySound", () => {
  it("uses the TamKobi chime and skips the first snapshot", () => {
    expect(TAMKOBI_NOTIFY_SRC).toBe("/sounds/tamkobi.wav");
    const first = notifySoundPlan([], ["a", "b"], false);
    expect(first).toEqual({ play: false, seen: ["a", "b"], seeded: true });
    const later = notifySoundPlan(first.seen, ["a", "b", "c"], true);
    expect(later.play).toBe(true);
    expect(later.seen).toContain("c");
    expect(notifySoundPlan(later.seen, ["a", "b", "c"], true).play).toBe(false);
  });
});
