import { downloadTextFile, generateJsencryptKeyPair, selfSignedCrtFromPrivatePem } from "./jsencryptKuveyt";

test("selfSignedCrtFromPrivatePem rejects non-PEM", async () => {
  await expect(selfSignedCrtFromPrivatePem("not-a-key")).rejects.toThrow(/PRIVATE KEY/);
});

test("downloadTextFile creates anchor click", () => {
  const createObjectURL = jest.fn(() => "blob:mock");
  const revokeObjectURL = jest.fn();
  global.URL.createObjectURL = createObjectURL;
  global.URL.revokeObjectURL = revokeObjectURL;
  const click = jest.fn();
  const remove = jest.fn();
  const appendChild = jest.spyOn(document.body, "appendChild").mockImplementation((el) => {
    el.click = click;
    el.remove = remove;
    return el;
  });
  downloadTextFile("kuveyt-public.crt", "-----BEGIN CERTIFICATE-----\nX\n-----END CERTIFICATE-----\n");
  expect(createObjectURL).toHaveBeenCalled();
  expect(click).toHaveBeenCalled();
  expect(revokeObjectURL).toHaveBeenCalled();
  appendChild.mockRestore();
});

test("selfSignedCrtFromPrivatePem builds CERTIFICATE from forge key", async () => {
  const forge = require("node-forge");
  const keys = forge.pki.rsa.generateKeyPair({ bits: 1024, workers: 0 });
  const privPem = forge.pki.privateKeyToPem(keys.privateKey);
  const crt = await selfSignedCrtFromPrivatePem(privPem, { commonName: "TamKobi-Test" });
  expect(crt).toContain("BEGIN CERTIFICATE");
  expect(crt).toContain("END CERTIFICATE");
  const cert = forge.pki.certificateFromPem(crt);
  expect(cert.subject.getField("CN").value).toBe("TamKobi-Test");
});

test("generateJsencryptKeyPair returns PKCS1 PEM and certificate quickly", async () => {
  const started = Date.now();
  const pair = await generateJsencryptKeyPair();
  expect(Date.now() - started).toBeLessThan(20000);
  expect(pair.privateKey).toMatch(/BEGIN (RSA )?PRIVATE KEY/);
  expect(pair.privateKey).toMatch(/END (RSA )?PRIVATE KEY/);
  expect(pair.publicKey).toContain("BEGIN PUBLIC KEY");
  expect(pair.certificatePem).toContain("BEGIN CERTIFICATE");
  const forge = require("node-forge");
  const priv = forge.pki.privateKeyFromPem(pair.privateKey);
  expect(priv.n.bitLength()).toBeGreaterThanOrEqual(2048);
}, 25000);
