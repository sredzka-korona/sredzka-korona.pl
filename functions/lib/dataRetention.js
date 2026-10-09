const { Timestamp } = require('firebase-admin/firestore');

// Used only by the already existing legacy Firebase booking crons.
async function pruneAuditLogs(db, collection, now = Date.now()) {
  const cutoff = Timestamp.fromMillis(now - 90 * 86400000);
  const expired = await db.collection(collection).where('createdAt', '<=', cutoff).limit(100).get();
  if (expired.empty) return;
  const batch = db.batch();
  for (const document of expired.docs) batch.delete(document.ref);
  await batch.commit();
}

module.exports = { pruneAuditLogs };
