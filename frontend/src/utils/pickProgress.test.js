import { pickProgressLabel } from "./pickProgress";

describe("pickProgressLabel", () => {
  test("kalem sayısı ve toplanan adedi Türkçe yazar", () => {
    const label = pickProgressLabel({ picked: 4, ordered: 6 }, 2);
    expect(label.lines).toBe("2 kalem");
    expect(label.qty).toBe("4 / 6 adet toplandı");
    expect(label.text).toContain("2 kalem");
    expect(label.text).toContain("4 / 6 adet toplandı");
  });

  test("binlik ayırır; eksik ilerlemeyi sıfırlar", () => {
    const label = pickProgressLabel({ picked: 1200, ordered: 3400 }, 12);
    expect(label.lines).toBe("12 kalem");
    expect(label.qty).toBe("1.200 / 3.400 adet toplandı");
    const empty = pickProgressLabel(null, undefined);
    expect(empty.lines).toBe("0 kalem");
    expect(empty.qty).toBe("0 / 0 adet toplandı");
  });
});
