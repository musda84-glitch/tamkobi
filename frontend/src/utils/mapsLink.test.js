import { workMapsLink } from "./mapsLink";

describe("workMapsLink", () => {
  it("prefers location_url, then coords, then address search", () => {
    expect(workMapsLink({ location_url: "https://maps.example/x", address: "Kadıköy" })).toBe("https://maps.example/x");
    expect(workMapsLink({ latitude: 41, longitude: 29 })).toBe("https://www.google.com/maps?q=41,29");
    expect(workMapsLink({ address: "Kayabaşı Mah. Başakşehir İstanbul" })).toBe(
      "https://www.google.com/maps/search/?api=1&query=Kayaba%C5%9F%C4%B1%20Mah.%20Ba%C5%9Fak%C5%9Fehir%20%C4%B0stanbul",
    );
    expect(workMapsLink({ address: "  " })).toBeNull();
    expect(workMapsLink(null)).toBeNull();
  });
});
