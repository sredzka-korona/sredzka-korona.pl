const crypto = require("crypto");

function json(res, data, status = 200) {
  res.status(status).json(data);
}

function parseAdminEmails() {
  const raw = process.env.FIREBASE_ADMIN_EMAILS || "";
  return raw
    .split(",")
    .map((e) => e.trim().toLowerCase())
    .filter(Boolean);
}

async function verifyAdminAuth(admin, authHeader) {
  const m = /^Bearer\s+(.+)$/i.exec(authHeader || "");
  if (!m) {
    throw new Error("UNAUTHORIZED");
  }
  const decoded = await admin.auth().verifyIdToken(m[1]);
  const email = String(decoded.email || "")
    .trim()
    .toLowerCase();
  const allow = parseAdminEmails();
  if (!allow.length || !allow.includes(email)) {
    throw new Error("FORBIDDEN");
  }
  return { uid: decoded.uid, email };
}

function hashToken(token) {
  return crypto.createHash("sha256").update(token).digest("hex");
}

function randomToken() {
  return crypto.randomBytes(32).toString("hex");
}

async function verifyTurnstile(token, remoteIp) {
  const secret = process.env.TURNSTILE_SECRET;
  if (!secret) {
    return false;
  }
  if (!token) {
    return false;
  }
  const body = new URLSearchParams({
    secret,
    response: token,
    remoteip: remoteIp || "",
  });
  const r = await fetch("https://challenges.cloudflare.com/turnstile/v0/siteverify", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body,
  });
  const data = await r.json();
  return Boolean(data.success);
}

function roomsListFromItems(items) {
  if (!items || !items.length) return "";
  return items.map((i) => `${i.roomNameSnapshot} × ${i.nights} nocy — ${i.lineTotal} PLN`).join("; ");
}

module.exports = {
  json,
  verifyAdminAuth,
  hashToken,
  randomToken,
  verifyTurnstile,
  roomsListFromItems,
  parseAdminEmails,
};
