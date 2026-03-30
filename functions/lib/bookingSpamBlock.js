const crypto = require("crypto");
const { FieldValue, Timestamp } = require("firebase-admin/firestore");
const { SPAM_BLOCK_MS } = require("./bookingConstants");

function hashDocId(key) {
  return `sb_${crypto.createHash("sha256").update(key).digest("hex").slice(0, 40)}`;
}

/**
 * Blokada anty-duplikacja po złożeniu zgłoszenia: ten sam IP lub e-mail nie może
 * ponownie złożyć zgłoszenia w module przez SPAM_BLOCK_MS.
 */
async function checkSpamBlock(db, moduleKey, ip, emailNorm) {
  const keys = [`${moduleKey}:ip:${ip}`];
  if (emailNorm) {
    keys.push(`${moduleKey}:em:${emailNorm}`);
  }
  for (const k of keys) {
    const ref = db.collection("bookingSpamBlocks").doc(hashDocId(k));
    const snap = await ref.get();
    if (!snap.exists) continue;
    const until = snap.data().until?.toMillis?.() || 0;
    if (until > Date.now()) {
      const mins = Math.ceil((until - Date.now()) / 60000);
      return { blocked: true, untilMs: until, waitMinutes: mins };
    }
  }
  return { blocked: false };
}

async function setSpamBlock(db, moduleKey, ip, emailNorm) {
  const until = Timestamp.fromMillis(Date.now() + SPAM_BLOCK_MS);
  const batch = db.batch();
  batch.set(
    db.collection("bookingSpamBlocks").doc(hashDocId(`${moduleKey}:ip:${ip}`)),
    { until, module: moduleKey, kind: "ip", updatedAt: FieldValue.serverTimestamp() },
    { merge: true }
  );
  if (emailNorm) {
    batch.set(
      db.collection("bookingSpamBlocks").doc(hashDocId(`${moduleKey}:em:${emailNorm}`)),
      { until, module: moduleKey, kind: "email", updatedAt: FieldValue.serverTimestamp() },
      { merge: true }
    );
  }
  await batch.commit();
}

module.exports = {
  checkSpamBlock,
  setSpamBlock,
};
