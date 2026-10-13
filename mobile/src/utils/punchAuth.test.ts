import { pinMatches, punchAuthRequired, punchSecurityFields, validatePunchPin } from "./punchAuth";

describe("punchAuth", () => {
  it("asks for biometric or pin only when the company setting is on", () => {
    expect(punchAuthRequired("off")).toBe(false);
    expect(punchAuthRequired(null)).toBe(false);
    expect(punchAuthRequired("pin")).toBe(true);
    expect(punchAuthRequired("either")).toBe(true);
  });

  it("checks a 4-6 digit pin", () => {
    expect(validatePunchPin("123")).toMatch(/4-6/);
    expect(validatePunchPin("1234")).toBeNull();
    expect(pinMatches("1234", "1234")).toBe(true);
    expect(pinMatches("1234", "9999")).toBe(false);
  });

  it("sends the registered device and integrity flags", () => {
    expect(punchSecurityFields({
      deviceId: "phone-a",
      platform: "android",
      isMock: true,
      isRooted: false,
      punchAuth: true,
    })).toEqual({
      device_id: "phone-a",
      platform: "android",
      is_mock: true,
      is_rooted: false,
      punch_auth: true,
    });
  });
});
