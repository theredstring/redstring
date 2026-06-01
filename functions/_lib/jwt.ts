// GitHub App JWT signing on Cloudflare Workers via the `jose` library.
//
// Workers have Web Crypto (`crypto.subtle.sign`) but not Node's `crypto`/
// `jsonwebtoken`. The token shape is identical to what `jwt.sign(payload,
// privateKey, { algorithm: 'RS256' })` produced in the old Node server.
//
// GitHub provides PEMs in PKCS#1 format (`-----BEGIN RSA PRIVATE KEY-----`).
// jose's `importPKCS8` expects PKCS#8 (`-----BEGIN PRIVATE KEY-----`). The
// two are wire-different. We accept either by sniffing the header and
// converting PKCS#1 → PKCS#8 on the fly (a one-line ASN.1 wrapper prepend).

import { SignJWT, importPKCS8 } from 'jose';

const PKCS1_HEADER = '-----BEGIN RSA PRIVATE KEY-----';
const PKCS8_HEADER = '-----BEGIN PRIVATE KEY-----';

// PKCS#8 wrapper for an RSA private key:
// SEQUENCE { version=0, AlgorithmIdentifier { rsaEncryption, NULL }, OCTET STRING { <PKCS#1> } }
// Pre-computed DER prefix that wraps a PKCS#1 RSAPrivateKey into PKCS#8.
const PKCS8_RSA_PREFIX = new Uint8Array([
  0x30, 0x82, 0x00, 0x00,             // SEQUENCE, length placeholder (filled in)
  0x02, 0x01, 0x00,                   // INTEGER 0 (version)
  0x30, 0x0d,                         // SEQUENCE (AlgorithmIdentifier)
  0x06, 0x09, 0x2a, 0x86, 0x48,       // OID 1.2.840.113549.1.1.1 (rsaEncryption)
  0x86, 0xf7, 0x0d, 0x01, 0x01, 0x01,
  0x05, 0x00,                         // NULL parameters
  0x04, 0x82, 0x00, 0x00,             // OCTET STRING, length placeholder (filled in)
]);

function base64ToBytes(b64: string): Uint8Array {
  const bin = atob(b64);
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}

function bytesToBase64(bytes: Uint8Array): string {
  let s = '';
  for (let i = 0; i < bytes.length; i++) s += String.fromCharCode(bytes[i]);
  return btoa(s);
}

// Convert a PKCS#1 RSA PEM to a PKCS#8 PEM by wrapping the inner DER.
function pkcs1ToPkcs8(pem: string): string {
  const body = pem
    .replace(/-----BEGIN RSA PRIVATE KEY-----/, '')
    .replace(/-----END RSA PRIVATE KEY-----/, '')
    .replace(/\s+/g, '');
  const pkcs1 = base64ToBytes(body);

  const prefix = new Uint8Array(PKCS8_RSA_PREFIX);
  // OCTET STRING length = pkcs1.length (last two bytes of prefix)
  prefix[prefix.length - 2] = (pkcs1.length >> 8) & 0xff;
  prefix[prefix.length - 1] = pkcs1.length & 0xff;
  // Outer SEQUENCE length = (prefix.length - 4) + pkcs1.length
  const inner = (prefix.length - 4) + pkcs1.length;
  prefix[2] = (inner >> 8) & 0xff;
  prefix[3] = inner & 0xff;

  const pkcs8 = new Uint8Array(prefix.length + pkcs1.length);
  pkcs8.set(prefix, 0);
  pkcs8.set(pkcs1, prefix.length);

  const b64 = bytesToBase64(pkcs8);
  const lines = b64.match(/.{1,64}/g)?.join('\n') || b64;
  return `-----BEGIN PRIVATE KEY-----\n${lines}\n-----END PRIVATE KEY-----\n`;
}

function normalizePem(pem: string): string {
  const trimmed = pem.trim();
  if (trimmed.includes(PKCS8_HEADER)) return trimmed;
  if (trimmed.includes(PKCS1_HEADER)) return pkcs1ToPkcs8(trimmed);
  throw new Error('GITHUB_APP_PRIVATE_KEY is not a recognized PEM (need PKCS#1 or PKCS#8 RSA)');
}

// Mint a 10-minute GitHub App JWT. Same payload shape the Node server used.
export async function appJwt(appId: string | number, privateKeyPem: string): Promise<string> {
  const pem = normalizePem(privateKeyPem);
  const key = await importPKCS8(pem, 'RS256');
  const now = Math.floor(Date.now() / 1000);
  return new SignJWT({})
    .setProtectedHeader({ alg: 'RS256', typ: 'JWT' })
    .setIssuer(String(appId))
    .setIssuedAt(now - 60)
    .setExpirationTime(now + 10 * 60)
    .sign(key);
}
