const crypto = require("crypto");

const WINDOW_MS = 60 * 60 * 1000;
const MAX_PER_WINDOW = 12;

function hashKey(s) {
  return crypto.createHash("sha256").update(s).digest("hex").slice(0, 32);
}

/**
 * Prosty limit: licznik na okno czasowe per klucz (IP + akcja lub e-mail + akcja).
 */
async function checkRateLimit(db, keyBase) {
  const bucket = Math.floor(Date.now() / WINDOW_MS);
  const docId = `rl_${hashKey(`${keyBase}_${bucket}`)}`;
  const ref = db.collection("hotelRateLimits").doc(docId);
  return db.runTransaction(async (tx) => {
    const snap = await tx.get(ref);
    const count = snap.exists ? Number(snap.data().count || 0) : 0;
    if (count >= MAX_PER_WINDOW) {
      return false;
    }
    tx.set(
      ref,
      {
        count: count + 1,
        windowBucket: bucket,
        updatedAt: new Date(),
      },
      { merge: true }
    );
    return true;
  });
}

module.exports = {
  checkRateLimit,
  WINDOW_MS,
  MAX_PER_WINDOW,
};
