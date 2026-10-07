/**
 * Kuveyt RSA: 2048-bit PKCS1 Private Key (JSEncrypt.signSha256 uyumlu).
 * Private Key TamKobi’de kalır; Public Key / .crt Kuveyt API Market’e yüklenir.
 *
 * Üretim: Web Crypto (hızlı) → node-forge yedek. JSEncrypt.getKey tarayıcıda
 * 2048-bit için ana iş parçacığını kilitleyip “uzun beklemede” bırakabiliyordu.
 */

const KEY_BITS = 2048;
const GEN_TIMEOUT_MS = 45000;

function _loadForge(mod) {
  return mod?.default || mod;
}

function _yieldToUi() {
  return new Promise((resolve) => {
    if (typeof requestAnimationFrame === "function") {
      requestAnimationFrame(() => setTimeout(resolve, 0));
    } else {
      setTimeout(resolve, 0);
    }
  });
}

function _withTimeout(promise, ms, label) {
  let timer;
  const timeout = new Promise((_, reject) => {
    timer = setTimeout(() => {
      reject(new Error(`${label} ${Math.round(ms / 1000)} sn içinde bitmedi — sayfayı yenileyip tekrar deneyin.`));
    }, ms);
  });
  return Promise.race([promise, timeout]).finally(() => clearTimeout(timer));
}

function _bytesToBinary(buf) {
  const u8 = buf instanceof Uint8Array ? buf : new Uint8Array(buf);
  let out = "";
  const step = 0x8000;
  for (let i = 0; i < u8.length; i += step) {
    out += String.fromCharCode.apply(null, u8.subarray(i, Math.min(i + step, u8.length)));
  }
  return out;
}

function _derToPem(forge, buf, label) {
  const b64 = forge.util.encode64(_bytesToBinary(buf));
  const lines = b64.match(/.{1,64}/g) || [];
  return `-----BEGIN ${label}-----\n${lines.join("\n")}\n-----END ${label}-----\n`;
}

async function _forgeModule() {
  return _loadForge(await import("node-forge"));
}

/** PKCS8/SPKI ArrayBuffer → forge key → PKCS1 PEM çifti. */
async function _pairFromWebCrypto() {
  const subtle = globalThis.crypto?.subtle;
  if (!subtle?.generateKey) {
    throw new Error("Web Crypto yok");
  }
  const keyPair = await subtle.generateKey(
    {
      name: "RSASSA-PKCS1-v1_5",
      modulusLength: KEY_BITS,
      publicExponent: new Uint8Array([1, 0, 1]),
      hash: "SHA-256",
    },
    true,
    ["sign", "verify"],
  );
  const [pkcs8, spki] = await Promise.all([
    subtle.exportKey("pkcs8", keyPair.privateKey),
    subtle.exportKey("spki", keyPair.publicKey),
  ]);
  const forge = await _forgeModule();
  const privateKeyObj = forge.pki.privateKeyFromPem(_derToPem(forge, pkcs8, "PRIVATE KEY"));
  const publicKeyObj = forge.pki.publicKeyFromPem(_derToPem(forge, spki, "PUBLIC KEY"));
  return {
    privateKey: forge.pki.privateKeyToPem(privateKeyObj),
    publicKey: forge.pki.publicKeyToPem(publicKeyObj),
  };
}

async function _pairFromForge() {
  const forge = await _forgeModule();
  const canWorker = typeof Worker !== "undefined";
  if (!canWorker) {
    const keys = forge.pki.rsa.generateKeyPair({ bits: KEY_BITS, workers: 0 });
    return {
      privateKey: forge.pki.privateKeyToPem(keys.privateKey),
      publicKey: forge.pki.publicKeyToPem(keys.publicKey),
    };
  }
  return new Promise((resolve, reject) => {
    forge.pki.rsa.generateKeyPair({ bits: KEY_BITS, workers: 2 }, (err, keys) => {
      if (err) {
        try {
          const sync = forge.pki.rsa.generateKeyPair({ bits: KEY_BITS, workers: 0 });
          resolve({
            privateKey: forge.pki.privateKeyToPem(sync.privateKey),
            publicKey: forge.pki.publicKeyToPem(sync.publicKey),
          });
        } catch (e2) {
          reject(err instanceof Error ? err : e2);
        }
        return;
      }
      if (!keys?.privateKey) {
        reject(new Error("node-forge anahtar üretemedi"));
        return;
      }
      resolve({
        privateKey: forge.pki.privateKeyToPem(keys.privateKey),
        publicKey: forge.pki.publicKeyToPem(keys.publicKey),
      });
    });
  });
}

export async function generateJsencryptKeyPair() {
  await _yieldToUi();
  const work = (async () => {
    let privateKey = "";
    let publicKey = "";
    try {
      ({ privateKey, publicKey } = await _pairFromWebCrypto());
    } catch (_) {
      ({ privateKey, publicKey } = await _pairFromForge());
    }
    if (!privateKey || !String(privateKey).includes("BEGIN")) {
      throw new Error("JSEncrypt Invalid key");
    }
    let certificatePem = "";
    try {
      certificatePem = await selfSignedCrtFromPrivatePem(privateKey);
    } catch (_) {
      // Portal çoğu zaman PUBLIC KEY PEM’i .crt olarak da kabul eder.
      certificatePem = publicKey || "";
    }
    return { privateKey, publicKey: publicKey || "", certificatePem };
  })();
  return _withTimeout(work, GEN_TIMEOUT_MS, "RSA anahtar üretimi");
}

/** Private PEM → self-signed X.509 .crt (API Market Public Key yüklemesi). */
export async function selfSignedCrtFromPrivatePem(privateKeyPem, { commonName = "TamKobi-Kuveyt", years = 10 } = {}) {
  const pem = String(privateKeyPem || "").trim();
  if (!pem.includes("BEGIN")) {
    throw new Error("PRIVATE KEY PEM gerekli");
  }
  const forge = await _forgeModule();
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
