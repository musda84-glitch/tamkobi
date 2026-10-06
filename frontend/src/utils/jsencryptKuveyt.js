/**
 * Kuveyt RSA: travist/jsencrypt demo (2048-bit PKCS1 Private Key).
 * Public Key alanı imza için kullanılmaz — yalnızca getPrivateKey() yapıştırılır.
 * https://travistidwell.com/jsencrypt/demo/
 */
export async function generateJsencryptPrivateKeyPem() {
  const mod = await import("jsencrypt");
  const JSEncrypt = mod.JSEncrypt || mod.default;
  if (typeof JSEncrypt !== "function") {
    throw new Error("JSEncrypt yüklenemedi");
  }
  return new Promise((resolve, reject) => {
    try {
      const crypt = new JSEncrypt({ default_key_size: 2048 });
      crypt.getKey(() => {
        const pem = crypt.getPrivateKey();
        if (!pem || !String(pem).includes("BEGIN")) {
          reject(new Error("JSEncrypt Invalid key"));
          return;
        }
        resolve(pem);
      });
    } catch (e) {
      reject(e);
    }
  });
}
