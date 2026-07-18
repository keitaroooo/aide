import { listPushSubs, listTasks, listUsersForDigest } from "../db";
import type { Env, User } from "../types";

function b64urlToBytes(b64url: string): Uint8Array {
  const padded = b64url.replace(/-/g, "+").replace(/_/g, "/");
  const pad = padded.length % 4 === 0 ? "" : "=".repeat(4 - (padded.length % 4));
  const bin = atob(padded + pad);
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}

function bytesToB64url(bytes: ArrayBuffer | Uint8Array): string {
  const arr = bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes);
  let s = "";
  for (const b of arr) s += String.fromCharCode(b);
  return btoa(s).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

async function importVapidPrivateKey(pemOrB64: string): Promise<CryptoKey> {
  // Accept raw base64url PKCS8 or PEM
  let raw = pemOrB64.trim();
  if (raw.includes("BEGIN")) {
    raw = raw
      .replace(/-----BEGIN PRIVATE KEY-----/, "")
      .replace(/-----END PRIVATE KEY-----/, "")
      .replace(/\s+/g, "");
  }
  const keyData = b64urlToBytes(raw.replace(/\+/g, "-").replace(/\//g, "_"));
  return crypto.subtle.importKey("pkcs8", keyData.buffer as ArrayBuffer, { name: "ECDSA", namedCurve: "P-256" }, false, [
    "sign",
  ]);
}

async function createVapidAuthHeader(
  env: Env,
  audience: string,
): Promise<string> {
  if (!env.VAPID_PRIVATE_KEY || !env.VAPID_PUBLIC_KEY) {
    throw new Error("VAPID keys not configured");
  }
  const subject = env.VAPID_SUBJECT || "mailto:aide@example.com";
  const header = { typ: "JWT", alg: "ES256" };
  const exp = Math.floor(Date.now() / 1000) + 12 * 60 * 60;
  const payload = { aud: audience, exp, sub: subject };
  const enc = (obj: unknown) =>
    bytesToB64url(new TextEncoder().encode(JSON.stringify(obj)));
  const unsigned = `${enc(header)}.${enc(payload)}`;
  const key = await importVapidPrivateKey(env.VAPID_PRIVATE_KEY);
  const sig = await crypto.subtle.sign(
    { name: "ECDSA", hash: "SHA-256" },
    key,
    new TextEncoder().encode(unsigned),
  );
  // Convert IEEE P1363 sig to... Web Push expects raw r||s which Web Crypto ECDSA gives for P-256
  const jwt = `${unsigned}.${bytesToB64url(sig)}`;
  return `vapid t=${jwt}, k=${env.VAPID_PUBLIC_KEY}`;
}

/**
 * Minimal Web Push: sends an unencrypted (aes128gcm empty) payload via Urgency only
 * when encryption libs are heavy. Prefer encrypted body with web-push semantics.
 * For MVP we send a small encrypted payload using Web Crypto ECDH if possible;
 * otherwise a TTL-only ping with title in FCM topic is not available — use
 * RFC8291-lite: many browsers accept body via `fetch` with encrypted content.
 *
 * Practical MVP approach: use the Push API with `Content-Encoding: aes128gcm`
 * via a compact implementation.
 */
async function encryptPayload(
  userPublicKeyB64: string,
  userAuthB64: string,
  payload: string,
): Promise<{ ciphertext: ArrayBuffer; salt: Uint8Array; localPublicKey: Uint8Array }> {
  const userKeyBytes = b64urlToBytes(userPublicKeyB64);
  const authSecret = b64urlToBytes(userAuthB64);
  const salt = crypto.getRandomValues(new Uint8Array(16));

  const userKey = await crypto.subtle.importKey(
    "raw",
    userKeyBytes.buffer as ArrayBuffer,
    { name: "ECDH", namedCurve: "P-256" },
    true,
    [],
  );
  const localPair = (await crypto.subtle.generateKey(
    { name: "ECDH", namedCurve: "P-256" },
    true,
    ["deriveBits"],
  )) as CryptoKeyPair;
  const sharedSecret = await crypto.subtle.deriveBits(
    { name: "ECDH", public: userKey } as never,
    localPair.privateKey,
    256,
  );
  const localPubRaw = await crypto.subtle.exportKey("raw", localPair.publicKey);
  const localPub = new Uint8Array(localPubRaw as ArrayBuffer);

  // HKDF info for auth + ikm (RFC 8291)
  const ikm = await hkdf(
    new Uint8Array(sharedSecret),
    authSecret,
    concat(new TextEncoder().encode("WebPush: info\0"), userKeyBytes, localPub),
    32,
  );
  const cekInfo = new TextEncoder().encode("Content-Encoding: aes128gcm\0");
  const nonceInfo = new TextEncoder().encode("Content-Encoding: nonce\0");
  const contentKey = await hkdf(ikm, salt, cekInfo, 16);
  const nonce = await hkdf(ikm, salt, nonceInfo, 12);

  const key = await crypto.subtle.importKey(
    "raw",
    toArrayBuffer(contentKey),
    "AES-GCM",
    false,
    ["encrypt"],
  );
  // Record: plaintext || 0x02 (padding delimiter)
  const plain = concat(new TextEncoder().encode(payload), new Uint8Array([2]));
  const encrypted = await crypto.subtle.encrypt(
    { name: "AES-GCM", iv: nonce },
    key,
    plain,
  );

  // aes128gcm header: salt(16) + rs(4) + idlen(1) + keyid + ciphertext
  const rs = new Uint8Array(4);
  new DataView(rs.buffer).setUint32(0, 4096);
  const idlen = new Uint8Array([localPub.length]);
  const body = concat(salt, rs, idlen, localPub, new Uint8Array(encrypted));
  return { ciphertext: toArrayBuffer(body), salt, localPublicKey: localPub };
}

function toArrayBuffer(view: Uint8Array): ArrayBuffer {
  return view.buffer.slice(view.byteOffset, view.byteOffset + view.byteLength) as ArrayBuffer;
}

async function hkdf(
  ikm: Uint8Array,
  salt: Uint8Array,
  info: Uint8Array,
  length: number,
): Promise<Uint8Array> {
  const baseKey = await crypto.subtle.importKey("raw", toArrayBuffer(ikm), "HKDF", false, [
    "deriveBits",
  ]);
  const bits = await crypto.subtle.deriveBits(
    {
      name: "HKDF",
      hash: "SHA-256",
      salt: toArrayBuffer(salt),
      info: toArrayBuffer(info),
    },
    baseKey,
    length * 8,
  );
  return new Uint8Array(bits);
}

function concat(...parts: Uint8Array[]): Uint8Array {
  const len = parts.reduce((n, p) => n + p.length, 0);
  const out = new Uint8Array(len);
  let o = 0;
  for (const p of parts) {
    out.set(p, o);
    o += p.length;
  }
  return out;
}

export async function sendPush(
  env: Env,
  sub: { endpoint: string; p256dh: string; auth: string },
  payload: { title: string; body: string; url?: string },
): Promise<boolean> {
  if (!env.VAPID_PUBLIC_KEY || !env.VAPID_PRIVATE_KEY) return false;
  const endpointUrl = new URL(sub.endpoint);
  const audience = `${endpointUrl.protocol}//${endpointUrl.host}`;
  const authorization = await createVapidAuthHeader(env, audience);
  const { ciphertext } = await encryptPayload(sub.p256dh, sub.auth, JSON.stringify(payload));

  const res = await fetch(sub.endpoint, {
    method: "POST",
    headers: {
      Authorization: authorization,
      TTL: "86400",
      Urgency: "normal",
      "Content-Encoding": "aes128gcm",
      "Content-Type": "application/octet-stream",
    },
    body: ciphertext,
  });
  return res.status >= 200 && res.status < 300;
}

function localHourMinute(timezone: string): { hhmm: string; date: string } {
  const fmt = new Intl.DateTimeFormat("en-CA", {
    timeZone: timezone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  });
  const parts = Object.fromEntries(fmt.formatToParts(new Date()).map((p) => [p.type, p.value]));
  const hhmm = `${parts.hour}:${parts.minute}`;
  const date = `${parts.year}-${parts.month}-${parts.day}`;
  return { hhmm, date };
}

export async function buildDigest(env: Env, user: User): Promise<string> {
  const [soon, should] = await Promise.all([
    listTasks(env.DB, user.id, { horizon: "soon" }),
    listTasks(env.DB, user.id, { horizon: "should" }),
  ]);
  const { date } = localHourMinute(user.timezone);
  const due = should.filter((t) => t.due_at && t.due_at.slice(0, 10) <= date);
  const lines = [
    ...soon.slice(0, 5).map((t) => `・${t.title}`),
    ...due.slice(0, 5).map((t) => `・[期限] ${t.title}`),
  ];
  if (!lines.length) return "今日の直近タスクはありません。Inbox を仕分けましょう。";
  return lines.join("\n");
}

export async function runDigestCron(env: Env): Promise<{ sent: number }> {
  if (!env.VAPID_PUBLIC_KEY || !env.VAPID_PRIVATE_KEY) return { sent: 0 };
  const users = await listUsersForDigest(env.DB);
  let sent = 0;
  for (const user of users) {
    const { hhmm } = localHourMinute(user.timezone);
    if (hhmm !== user.digest_time) continue;
    const body = await buildDigest(env, user);
    const subs = await listPushSubs(env.DB, user.id);
    for (const sub of subs) {
      const ok = await sendPush(env, sub, {
        title: "Aide — 今朝のやること",
        body,
        url: "/",
      });
      if (ok) sent++;
    }
  }
  return { sent };
}
