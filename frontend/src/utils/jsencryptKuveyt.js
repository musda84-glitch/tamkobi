/**
 * Kuveyt RSA: travist/jsencrypt demo (2048-bit PKCS1).
 * Private Key TamKobi’de kalır; Public Key / .crt Kuveyt API Market’e yüklenir.
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
      crypt.getKey(async () => {
        try {
          const privateKey = crypt.getPrivateKey();
          const publicKey = crypt.getPublicKey();
          if (!privateKey || !String(privateKey).includes("BEGIN")) {
            reject(new Error("JSEncrypt Invalid key"));
            return;
          }
          let certificatePem = "";
          try {
            certificatePem = await selfSignedCrtFromPrivatePem(privateKey);
          } catch (_) {
            // Portal çoğu zaman PUBLIC KEY PEM’i .crt olarak da kabul eder.
            certificatePem = publicKey || "";
          }
          resolve({ privateKey, publicKey: publicKey || "", certificatePem });
        } catch (e) {
          reject(e);
        }
      });
    } catch (e) {
      reject(e);
    }
  });
}

/** Private PEM → self-signed X.509 .crt (API Market Public Key yüklemesi). */
export async function selfSignedCrtFromPrivatePem(privateKeyPem, { commonName = "TamKobi-Kuveyt", years = 10 } = {}) {
  const pem = String(privateKeyPem || "").trim();
  if (!pem.includes("BEGIN")) {
    throw new Error("PRIVATE KEY PEM gerekli");
  }
  const forge = (await import("node-forge")).default || (await import("node-forge"));
  const privateKey = forge.pki.privateKeyFromPem(pem);
  const publicKey = forge.pki.setRsaPublicKey(privateKey.n, privateKey.e);
  const cert = forge.pki.createCertificate();
  cert.publicKey = publicKey;
  cert.serialNumber = String(Date.now());
  const now = new Date();
  cert.validity.notBefore = now;
  const notAfter = new Date(now);
  notAfter.setFullYear(notAfter.getFullYear() + years);
  cert.validity.notAfter = notAfter;
  const attrs = [{ name: "commonName", value: commonName }];
  cert.setSubject(attrs);
  cert.setIssuer(attrs);
  cert.setExtensions([
    { name: "basicConstraints", cA: false },
    { name: "keyUsage", digitalSignature: true, keyEncipherment: true },
  ]);
  cert.sign(privateKey, forge.md.sha256.create());
  return forge.pki.certificateToPem(cert);
}

export function downloadTextFile(filename, content, mime = "application/x-x509-ca-cert") {
  const blob = new Blob([content], { type: mime });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  a.rel = "noopener";
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(url);
}

export async function generateJsencryptPrivateKeyPem() {
  const pair = await generateJsencryptKeyPair();
  return pair.privateKey;
}
