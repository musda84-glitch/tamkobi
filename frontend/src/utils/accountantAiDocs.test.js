import { guessAccountantDocKind, accountantAiKindById, ACCOUNTANT_AI_KINDS } from "./accountantAiDocs";

test("kinds cover invoice expense cheque and bank", () => {
  expect(ACCOUNTANT_AI_KINDS.map((k) => k.id)).toEqual(["purchase", "sales", "expense", "cheque", "bank"]);
  expect(accountantAiKindById("sales").label).toMatch(/Satış/);
});

test("guessAccountantDocKind from name and type", () => {
  expect(guessAccountantDocKind({ name: "fatura.xml", type: "application/xml" })).toBe("sales");
  expect(guessAccountantDocKind({ name: "cek-gorsel.jpg", type: "image/jpeg" })).toBe("cheque");
  expect(guessAccountantDocKind({ name: "isbank-ekstre.pdf", type: "application/pdf" })).toBe("bank");
  expect(guessAccountantDocKind({ name: "hareketler.csv", type: "text/csv" })).toBe("bank");
  expect(guessAccountantDocKind({ name: "ofis-fisi.jpg", type: "image/jpeg" })).toBe("expense");
  expect(guessAccountantDocKind({ name: "photo.png", type: "image/png" })).toBe("expense");
  expect(guessAccountantDocKind({ name: "tedarikci-fatura.pdf", type: "application/pdf" })).toBe("purchase");
});
