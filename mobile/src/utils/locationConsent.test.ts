import {
  CONSENT_WARNING,
  locationConsentAccepted,
  locationConsentStatusLabel,
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

  it("shows settings status for accept vs revoke", () => {
    expect(locationConsentStatusLabel({ accept_kvkk: true, accept_share: true, accepted: true })).toMatch(/kabul/);
    expect(locationConsentStatusLabel({ accept_kvkk: false, accept_share: false })).toMatch(/kilitli/);
  });

  it("signal tones match last location outcome", () => {
    expect(normalizeLocationSignal({}).tone).toBe("amber");
    expect(normalizeLocationSignal({ ok: true }).label).toBe("Konum alındı");
    expect(normalizeLocationSignal({ ok: false }).tone).toBe("red");
    expect(locationUnavailablePayload(" GPS yok ").reason).toBe("GPS yok");
  });
});
