import {
  CONSENT_WARNING,
  locationConsentAccepted,
  locationUnavailablePayload,
  normalizeLocationConsent,
  normalizeLocationSignal,
  validateLocationConsent,
} from "./locationConsent";

describe("locationConsent", () => {
  it("requires both K and KK before the panel opens", () => {
    const empty = normalizeLocationConsent(null);
    expect(empty.accepted).toBe(false);
    expect(empty.warning).toBe(CONSENT_WARNING);
    expect(empty.warning).toMatch(/panel/);
    expect(validateLocationConsent({})).toMatch(/KVKK/);
    expect(validateLocationConsent({ accept_kvkk: true })).toMatch(/KK/);
    expect(validateLocationConsent({ accept_kvkk: true, accept_share: true })).toBeNull();
    expect(locationConsentAccepted({ accept_kvkk: true, accept_share: true, accepted: true })).toBe(true);
    expect(locationConsentAccepted({ accept_kvkk: true })).toBe(false);
  });

  it("signal tones match last location outcome", () => {
    expect(normalizeLocationSignal({}).tone).toBe("amber");
    expect(normalizeLocationSignal({ ok: true }).label).toBe("Konum alındı");
    expect(normalizeLocationSignal({ ok: false }).tone).toBe("red");
    expect(locationUnavailablePayload(" GPS yok ").reason).toBe("GPS yok");
  });
});
