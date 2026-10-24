import { qrLoginCode } from "./qrLogin";

const CODE = "abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQ";

describe("qrLoginCode", () => {
  it("accepts only a long random code", () => {
    expect(qrLoginCode(`  ${CODE}\n`)).toBe(CODE);
    expect(qrLoginCode("8690001111111")).toBeNull();
    expect(qrLoginCode("https://app.tamkobi.com/login?code=" + CODE)).toBeNull();
    expect(qrLoginCode("tklogin:" + CODE)).toBeNull();
    expect(qrLoginCode("")).toBeNull();
  });
});
