import { browserDeviceId, promptWebPunchPin, readWebDeviceToken, saveWebDeviceToken } from "./punchDevice";

describe("punchDevice", () => {
  beforeEach(() => {
    localStorage.clear();
    window.prompt = () => "1234";
  });

  it("does not fall back to a shared web-device id", () => {
    localStorage.setItem("tamkobi.deviceId", "web-device");
    const id = browserDeviceId();
    expect(id).toBeTruthy();
    expect(id).not.toBe("web-device");
    expect(browserDeviceId()).toBe(id);
  });

  it("does not keep the punch PIN in localStorage", () => {
    localStorage.setItem("tamkobi.punchPin", "9999");
    const result = promptWebPunchPin("pin");
    expect(result).toEqual({ ok: true, punch_pin: "1234" });
    expect(localStorage.getItem("tamkobi.punchPin")).toBeNull();
    expect(localStorage.getItem("tamkobi.deviceToken")).toBeNull();
  });

  it("stores only the server device token", () => {
    expect(readWebDeviceToken()).toBe("");
    saveWebDeviceToken("tok-1");
    expect(readWebDeviceToken()).toBe("tok-1");
  });
});
