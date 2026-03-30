/**
 * Weryfikacja Firebase ID token (RS256) dla Cloudflare Workers — bez firebase-admin.
 * @see https://firebase.google.com/docs/auth/admin/verify-id-tokens
 */

const GOOGLE_CERTS_URL =
  "https://www.googleapis.com/robot/v1/metadata/x509/securetoken@system.gserviceaccount.com";
const CERT_CACHE_MS = 55 * 60 * 1000;

let certCache = { map: null, fetchedAt: 0 };

function base64UrlToArrayBuffer(segment) {
  let base64 = segment.replace(/-/g, "+").replace(/_/g, "/");
  const pad = base64.length % 4;
  if (pad) {
    base64 += "=".repeat(4 - pad);
  }
  const binary = atob(base64);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i += 1) {
    bytes[i] = binary.charCodeAt(i);
  }
  return bytes.buffer;
}

function base64UrlToString(segment) {
  const bytes = new Uint8Array(base64UrlToArrayBuffer(segment));
  return new TextDecoder().decode(bytes);
}

function pemCertificateToSpki(pem) {
  const b64 = pem
    .replace(/-----BEGIN CERTIFICATE-----/g, "")
    .replace(/-----END CERTIFICATE-----/g, "")
    .replace(/\s/g, "");
  const binary = atob(b64);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i += 1) {
    bytes[i] = binary.charCodeAt(i);
  }
  return bytes.buffer;
}

async function importRsaKeyFromCertPem(pem) {
  const spki = pemCertificateToSpki(pem);
  return crypto.subtle.importKey(
    "spki",
    spki,
    { name: "RSASSA-PKCS1-v1_5", hash: "SHA-256" },
    false,
    ["verify"]
  );
}

async function getPublicKeyMap() {
  const now = Date.now();
  if (certCache.map && now - certCache.fetchedAt < CERT_CACHE_MS) {
    return certCache.map;
  }
  const response = await fetch(GOOGLE_CERTS_URL);
  if (!response.ok) {
    throw new Error("Nie udalo sie pobrac kluczy Google do weryfikacji tokenu.");
  }
  certCache.map = await response.json();
  certCache.fetchedAt = now;
  return certCache.map;
}

/**
 * @param {string} idToken
 * @param {{ FIREBASE_PROJECT_ID: string }} env
 * @returns {Promise<Record<string, unknown>>}
 */
export async function verifyFirebaseIdToken(idToken, env) {
  const projectId = env.FIREBASE_PROJECT_ID;
  if (!projectId) {
    throw new Error("Brak FIREBASE_PROJECT_ID po stronie serwera.");
  }

  const parts = idToken.split(".");
  if (parts.length !== 3) {
    throw new Error("Nieprawidlowy format tokenu.");
  }

  const [headerSeg, payloadSeg, signatureSeg] = parts;
  const header = JSON.parse(base64UrlToString(headerSeg));
  const payload = JSON.parse(base64UrlToString(payloadSeg));

  const keys = await getPublicKeyMap();
  const pem = keys[header.kid];
  if (!pem) {
    throw new Error("Nieznany klucz podpisu tokenu.");
  }

  const cryptoKey = await importRsaKeyFromCertPem(pem);
  const signature = base64UrlToArrayBuffer(signatureSeg);
  const data = new TextEncoder().encode(`${headerSeg}.${payloadSeg}`);
  const ok = await crypto.subtle.verify(
    "RSASSA-PKCS1-v1_5",
    cryptoKey,
    signature,
    data
  );
  if (!ok) {
    throw new Error("Podpis tokenu jest nieprawidlowy.");
  }

  const nowSec = Math.floor(Date.now() / 1000);
  if (typeof payload.exp === "number" && nowSec >= payload.exp) {
    throw new Error("Token wygasl.");
  }
  if (typeof payload.iat === "number" && payload.iat > nowSec + 300) {
    throw new Error("Token wystawiony w przyszlosci.");
  }

  const expectedIss = `https://securetoken.google.com/${projectId}`;
  if (payload.iss !== expectedIss) {
    throw new Error("Nieprawidlowy wydawca tokenu.");
  }
  if (payload.aud !== projectId) {
    throw new Error("Nieprawidlowy odbiorca tokenu.");
  }

  return payload;
}

export function parseAdminEmailAllowlist(raw) {
  if (!raw || typeof raw !== "string") {
    return [];
  }
  return raw
    .split(",")
    .map((e) => e.trim().toLowerCase())
    .filter(Boolean);
}
