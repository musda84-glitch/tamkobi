#!/usr/bin/env node
/**
 * travist/jsencrypt — Kuveyt Signature başlığı.
 * stdin JSON: { privateKey, data }  → stdout Base64 signSha256(data)
 */
"use strict";

const JSEncrypt = require("jsencrypt");

function readStdin() {
  return new Promise((resolve, reject) => {
    const chunks = [];
    process.stdin.setEncoding("utf8");
    process.stdin.on("data", (c) => chunks.push(c));
    process.stdin.on("end", () => resolve(chunks.join("")));
    process.stdin.on("error", reject);
  });
}

(async () => {
  let input;
  try {
    input = JSON.parse(await readStdin());
  } catch (e) {
    process.stderr.write("JSEncrypt: geçersiz JSON\n");
    process.exit(2);
  }
  const pem = input.privateKey || input.private_key || "";
  const data = input.data || "";
  const crypt = new JSEncrypt();
  crypt.setPrivateKey(pem);
  const sig = crypt.signSha256(data);
  if (!sig) {
    process.stderr.write("JSEncrypt Invalid key\n");
    process.exit(1);
  }
  process.stdout.write(String(sig));
})().catch((err) => {
  process.stderr.write(`JSEncrypt: ${err && err.message ? err.message : err}\n`);
  process.exit(1);
});
