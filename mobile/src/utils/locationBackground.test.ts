import {
  LOCATION_BG_NOTIFICATION,
  locationBgDistanceM,
  locationBgIntervalMs,
  locationBgUpdatesOptions,
  locationFromTaskData,
  parseLocationBgConfig,
  serializeLocationBgConfig,
  shouldRunLocationBackground,
} from "./locationBackground";

describe("location background tracking", () => {
  it("uses 1 minute for continuous and 15 minutes by default", () => {
    expect(locationBgIntervalMs({ continuous: true, interval_minutes: 0 })).toBe(60_000);
    expect(locationBgIntervalMs({ interval_minutes: 15 })).toBe(15 * 60_000);
    expect(locationBgIntervalMs(null)).toBe(15 * 60_000);
    expect(locationBgDistanceM({ continuous: true })).toBe(25);
    expect(locationBgDistanceM({ interval_minutes: 15 })).toBe(80);
  });

  it("runs only with consent, tracking, token and not after checkout", () => {
    expect(shouldRunLocationBackground({ consented: true, enabled: true, token: "t" })).toBe(true);
    expect(shouldRunLocationBackground({ consented: true, enabled: true, token: "t", checkedOut: true })).toBe(false);
    expect(shouldRunLocationBackground({ consented: false, enabled: true, token: "t" })).toBe(false);
    expect(shouldRunLocationBackground({ consented: true, enabled: true, token: "t", platform: "web" })).toBe(false);
    expect(shouldRunLocationBackground({ consented: true, enabled: true, token: "" })).toBe(false);
  });

  it("builds native update options with a closed-app notification", () => {
    const opts = locationBgUpdatesOptions({ continuous: true, interval_minutes: 0 });
    expect(opts.timeInterval).toBe(60_000);
    expect(opts.foregroundService.notificationTitle).toBe(LOCATION_BG_NOTIFICATION.notificationTitle);
    expect(opts.foregroundService.notificationBody).toMatch(/kapalı/);
  });

  it("reads the last coords from a location task payload", () => {
    expect(locationFromTaskData({ locations: [{ coords: { latitude: 41.01, longitude: 28.97, accuracy: 12 } }] })).toEqual({
      latitude: 41.01,
      longitude: 28.97,
      accuracy_m: 12,
    });
    expect(locationFromTaskData({})).toBeNull();
  });

  it("round-trips persisted config", () => {
    const raw = serializeLocationBgConfig({
      enabled: true,
      consented: true,
      continuous: false,
      interval_minutes: 10,
      checkedOut: false,
    });
    expect(parseLocationBgConfig(raw)).toMatchObject({ enabled: true, interval_minutes: 10, consented: true });
    expect(parseLocationBgConfig("nope")).toBeNull();
  });
});
