/**
 * Kuveyt RSA: travist/jsencrypt demo (2048-bit PKCS1).
 * Private Key TamKobi’de kalır; Public Key Kuveyt API Market uygulamasına yüklenir.
 * https://travistidwell.com/jsencrypt/demo/
 */
export async function generateJsencryptKeyPair() {
  const mod = await import("jsencrypt");
  const JSEncrypt = mod.JSEncrypt || mod.default;
  if (typeof JSEncrypt !== "function") {
    throw new Error("JSEncrypt yüklenemedi");
  }
  return new Promise((resolve, reject) => {
    try {
      const crypt = new JSEncrypt({ default_key_size: 2048 });
      crypt.getKey(() => {
        const privateKey = crypt.getPrivateKey();
        const publicKey = crypt.getPublicKey();
        if (!privateKey || !String(privateKey).includes("BEGIN")) {
          reject(new Error("JSEncrypt Invalid key"));
          return;
        }
        resolve({ privateKey, publicKey: publicKey || "" });
      });
    } catch (e) {
      reject(e);
    }
  });
}

export async function generateJsencryptPrivateKeyPem() {
  const pair = await generateJsencryptKeyPair();
  return pair.privateKey;
}
