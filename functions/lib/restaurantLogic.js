const { FieldValue, Timestamp } = require("firebase-admin/firestore");
const { DateTime } = require("luxon");

const BUFFER_MS = 30 * 60 * 1000;
const BLOCKING = new Set(["pending", "confirmed", "manual_block"]);

function cleanupBufferMinutes() {
  return 30;
}

function warsawFromParts(dateYmd, timeHm) {
  const [y, m, d] = String(dateYmd)
    .trim()
    .split("-")
    .map((x) => Number(x));
  const [hh, mm] = String(timeHm)
    .trim()
    .split(":")
    .map((x) => Number(x));
  if (!y || !m || !d || Number.isNaN(hh) || Number.isNaN(mm)) {
    return null;
  }
  const dt = DateTime.fromObject(
    { year: y, month: m, day: d, hour: hh, minute: mm, second: 0, millisecond: 0 },
    { zone: "Europe/Warsaw" }
  );
  return dt.isValid ? dt : null;
}

/** Zwraca start/end w ms (UTC epoch) oraz ISO dla zapisu */
function computeWindowMs(reservationDate, startTime, durationHours) {
  const dur = Number(durationHours);
  if (!dur || dur < 1 || dur > 12) {
    throw new Error("Nieprawidłowa liczba godzin (1–12).");
  }
  const start = warsawFromParts(reservationDate, startTime);
  if (!start) {
    throw new Error("Nieprawidłowa data lub godzina rozpoczęcia.");
  }
  const end = start.plus({ hours: dur });
  return {
    startMs: start.toMillis(),
    endMs: end.toMillis(),
    startIso: start.toISO(),
    endIso: end.toISO(),
  };
}

function blockEndMsFromEnd(endMs) {
  return endMs + BUFFER_MS;
}

/** Interwał blokady stołu: [startMs, blockEndMs) dla konfliktu z innym blokiem */
function intervalsOverlapBlock(aStart, aBlockEnd, bStart, bBlockEnd) {
  return aStart < bBlockEnd && bStart < aBlockEnd;
}

async function getReservation(db, id) {
  const snap = await db.collection("restaurantReservations").doc(id).get();
  return snap.exists ? { id: snap.id, ...snap.data() } : null;
}

async function isReservationBlocking(db, reservationId) {
  if (!reservationId) return false;
  const r = await getReservation(db, reservationId);
  if (!r) return false;
  return BLOCKING.has(r.status);
}

async function loadSettings(db) {
  const snap = await db.collection("restaurantSettings").doc("default").get();
  return snap.exists ? snap.data() : null;
}

async function loadTablesList(db) {
  const snap = await db.collection("restaurantTables").get();
  const list = [];
  snap.forEach((d) => list.push({ id: d.id, ...d.data() }));
  list.sort((a, b) => (a.sortOrder ?? a.number ?? 0) - (b.sortOrder ?? b.number ?? 0));
  return list;
}

/** Stoliki dostępne do automatycznego przydziału: aktywne i nieukryte */
function filterBookableTables(tables) {
  return tables.filter((t) => t.active !== false && t.hidden !== true);
}

/**
 * Sprawdza czy stół wolny w [startMs, blockEndMs) vs istniejące locki z blokującymi rezerwacjami.
 */
async function isTableFree(db, tableId, startMs, blockEndMs, excludeReservationId) {
  const q = await db
    .collection("restaurantTableLocks")
    .where("tableId", "==", tableId)
    .where("blockEndMs", ">", startMs)
    .limit(40)
    .get();
  for (const doc of q.docs) {
    const L = doc.data();
    if (!intervalsOverlapBlock(L.startMs, L.blockEndMs, startMs, blockEndMs)) {
      continue;
    }
    if (L.reservationId === excludeReservationId) {
      continue;
    }
    const blocking = await isReservationBlocking(db, L.reservationId);
    if (blocking) {
      return false;
    }
  }
  return true;
}

async function findAvailableTableIds(db, { startMs, endMs, tablesNeeded, joinTables, excludeReservationId }) {
  const blockEndMs = blockEndMsFromEnd(endMs);
  const tables = filterBookableTables(await loadTablesList(db));
  if (tables.length < tablesNeeded) {
    return { ok: false, reason: "NOT_ENOUGH_TABLES" };
  }

  const tryPick = async (ordered) => {
    const picked = [];
    for (const t of ordered) {
      if (await isTableFree(db, t.id, startMs, blockEndMs, excludeReservationId)) {
        picked.push(t);
        if (picked.length === tablesNeeded) {
          return picked.map((x) => x.id);
        }
      }
    }
    return null;
  };

  if (joinTables) {
    const byZone = {};
    for (const t of tables) {
      const z = t.zone || "sala";
      if (!byZone[z]) byZone[z] = [];
      byZone[z].push(t);
    }
    for (const z of Object.keys(byZone).sort()) {
      const list = byZone[z].sort((a, b) => (a.number || 0) - (b.number || 0));
      const ids = await tryPick(list);
      if (ids) {
        return { ok: true, tableIds: ids, zonePreference: z };
      }
    }
  }

  const sorted = [...tables].sort((a, b) => (a.number || 0) - (b.number || 0));
  const ids = await tryPick(sorted);
  if (ids) {
    return { ok: true, tableIds: ids };
  }
  return { ok: false, reason: "NO_SLOT" };
}

async function allocateRestaurantNumber(db) {
  const year = new Date().getFullYear();
  return db.runTransaction(async (tx) => {
    const ref = db.collection("restaurantSettings").doc("counters");
    const snap = await tx.get(ref);
    const data = snap.exists ? snap.data() : {};
    const field = `seq_${year}`;
    const seq = Number(data[field] || 0) + 1;
    tx.set(
      ref,
      {
        [field]: seq,
        updatedAt: FieldValue.serverTimestamp(),
      },
      { merge: true }
    );
    return `RS-${year}-${String(seq).padStart(5, "0")}`;
  });
}

async function releaseLocksForReservation(db, reservationId) {
  const q = await db.collection("restaurantTableLocks").where("reservationId", "==", reservationId).get();
  if (q.empty) {
    return;
  }
  const batch = db.batch();
  q.forEach((d) => batch.delete(d.ref));
  await batch.commit();
}

/**
 * Transakcyjne zajęcie stołów: najpierw wszystkie odczyty, potem zapisy (wymóg Firestore).
 */
async function claimTableLocksInTransaction(tx, db, { reservationId, tableIds, startMs, endMs, excludeReservationId }) {
  const blockEndMs = blockEndMsFromEnd(endMs);
  const resIdsToCheck = new Set();
  const querySnaps = [];

  for (const tableId of tableIds) {
    const q = db
      .collection("restaurantTableLocks")
      .where("tableId", "==", tableId)
      .where("blockEndMs", ">", startMs);
    const snap = await tx.get(q);
    querySnaps.push({ tableId, snap });
    for (const doc of snap.docs) {
      const L = doc.data();
      if (!intervalsOverlapBlock(L.startMs, L.blockEndMs, startMs, blockEndMs)) {
        continue;
      }
      if (L.reservationId === reservationId || L.reservationId === excludeReservationId) {
        continue;
      }
      resIdsToCheck.add(L.reservationId);
    }
  }

  const otherStatuses = {};
  for (const rid of resIdsToCheck) {
    const rs = await tx.get(db.collection("restaurantReservations").doc(rid));
    otherStatuses[rid] = rs.exists ? rs.data().status : null;
  }

  for (const { tableId, snap } of querySnaps) {
    for (const doc of snap.docs) {
      const L = doc.data();
      if (!intervalsOverlapBlock(L.startMs, L.blockEndMs, startMs, blockEndMs)) {
        continue;
      }
      if (L.reservationId === reservationId || L.reservationId === excludeReservationId) {
        continue;
      }
      const st = otherStatuses[L.reservationId];
      if (st && BLOCKING.has(st)) {
        throw new Error("CONFLICT: wybrany termin i stoliki są już zajęte.");
      }
    }
  }

  const lockIds = [];
  for (const tableId of tableIds) {
    const lockId = `${tableId}__${reservationId}`;
    const ref = db.collection("restaurantTableLocks").doc(lockId);
    lockIds.push(lockId);
    tx.set(ref, {
      tableId,
      reservationId,
      startMs,
      endMs,
      blockEndMs,
      cleanupBufferMinutes: cleanupBufferMinutes(),
      createdAt: FieldValue.serverTimestamp(),
    });
  }
  return lockIds;
}

/** Odczyt refów locków do usunięcia (tylko odczyt — zapis na końcu transakcji). */
async function collectReservationLockRefs(tx, db, reservationId) {
  const q = await tx.get(
    db.collection("restaurantTableLocks").where("reservationId", "==", reservationId)
  );
  return q.docs.map((d) => d.ref);
}

/**
 * Zastępuje locki rezerwacji: najpierw wszystkie odczyty (stare locki + konflikty), potem usunięcia + nowe locki.
 */
async function replaceTableLocksInTransaction(tx, db, { reservationId, tableIds, startMs, endMs }) {
  const blockEndMs = blockEndMsFromEnd(endMs);
  const oldRefs = await collectReservationLockRefs(tx, db, reservationId);

  const querySnaps = [];
  const resIdsToCheck = new Set();

  for (const tableId of tableIds) {
    const q = db
      .collection("restaurantTableLocks")
      .where("tableId", "==", tableId)
      .where("blockEndMs", ">", startMs);
    const snap = await tx.get(q);
    querySnaps.push({ tableId, snap });
    for (const doc of snap.docs) {
      const L = doc.data();
      if (!intervalsOverlapBlock(L.startMs, L.blockEndMs, startMs, blockEndMs)) {
        continue;
      }
      if (L.reservationId === reservationId) {
        continue;
      }
      resIdsToCheck.add(L.reservationId);
    }
  }

  const otherStatuses = {};
  for (const rid of resIdsToCheck) {
    const rs = await tx.get(db.collection("restaurantReservations").doc(rid));
    otherStatuses[rid] = rs.exists ? rs.data().status : null;
  }

  for (const { snap } of querySnaps) {
    for (const doc of snap.docs) {
      const L = doc.data();
      if (!intervalsOverlapBlock(L.startMs, L.blockEndMs, startMs, blockEndMs)) {
        continue;
      }
      if (L.reservationId === reservationId) {
        continue;
      }
      const st = otherStatuses[L.reservationId];
      if (st && BLOCKING.has(st)) {
        throw new Error("CONFLICT: wybrany termin i stoliki są już zajęte.");
      }
    }
  }

  for (const ref of oldRefs) {
    tx.delete(ref);
  }
  for (const tableId of tableIds) {
    const lockId = `${tableId}__${reservationId}`;
    tx.set(db.collection("restaurantTableLocks").doc(lockId), {
      tableId,
      reservationId,
      startMs,
      endMs,
      blockEndMs,
      cleanupBufferMinutes: cleanupBufferMinutes(),
      createdAt: FieldValue.serverTimestamp(),
    });
  }
}

/**
 * W jednej transakcji: walidacja slotów (odczyty), zapis dokumentu rezerwacji, zapis locków.
 * Wymaga wcześniej wygenerowanego ref (doc()) z znanym id.
 */
async function setReservationAndTableLocksInTransaction(tx, db, { resRef, reservationPayload, tableIds, startMs, endMs }) {
  const reservationId = resRef.id;
  const blockEndMs = blockEndMsFromEnd(endMs);
  const querySnaps = [];
  const resIdsToCheck = new Set();

  for (const tableId of tableIds) {
    const q = db
      .collection("restaurantTableLocks")
      .where("tableId", "==", tableId)
      .where("blockEndMs", ">", startMs);
    const snap = await tx.get(q);
    querySnaps.push({ tableId, snap });
    for (const doc of snap.docs) {
      const L = doc.data();
      if (!intervalsOverlapBlock(L.startMs, L.blockEndMs, startMs, blockEndMs)) {
        continue;
      }
      if (L.reservationId === reservationId) {
        continue;
      }
      resIdsToCheck.add(L.reservationId);
    }
  }

  const otherStatuses = {};
  for (const rid of resIdsToCheck) {
    const rs = await tx.get(db.collection("restaurantReservations").doc(rid));
    otherStatuses[rid] = rs.exists ? rs.data().status : null;
  }

  for (const { snap } of querySnaps) {
    for (const doc of snap.docs) {
      const L = doc.data();
      if (!intervalsOverlapBlock(L.startMs, L.blockEndMs, startMs, blockEndMs)) {
        continue;
      }
      if (L.reservationId === reservationId) {
        continue;
      }
      const st = otherStatuses[L.reservationId];
      if (st && BLOCKING.has(st)) {
        throw new Error("CONFLICT: wybrany termin i stoliki są już zajęte.");
      }
    }
  }

  tx.set(resRef, reservationPayload);
  for (const tableId of tableIds) {
    const lockId = `${tableId}__${reservationId}`;
    tx.set(db.collection("restaurantTableLocks").doc(lockId), {
      tableId,
      reservationId,
      startMs,
      endMs,
      blockEndMs,
      cleanupBufferMinutes: cleanupBufferMinutes(),
      createdAt: FieldValue.serverTimestamp(),
    });
  }
}

async function claimTableLocksInTransactionFresh(tx, db, { reservationId, tableIds, startMs, endMs }) {
  return claimTableLocksInTransaction(tx, db, {
    reservationId,
    tableIds,
    startMs,
    endMs,
    excludeReservationId: null,
  });
}

function assertReservationWindowInSettings(settings, startMs, endMs) {
  if (!settings) return;
  const open = settings.reservationOpenTime || "10:00";
  const close = settings.reservationCloseTime || "23:00";
  const [oh, om] = open.split(":").map(Number);
  const [ch, cm] = close.split(":").map(Number);
  const start = DateTime.fromMillis(startMs, { zone: "Europe/Warsaw" });
  const end = DateTime.fromMillis(endMs, { zone: "Europe/Warsaw" });
  const dayOpen = start.set({ hour: oh, minute: om || 0, second: 0, millisecond: 0 });
  let dayClose = start.set({ hour: ch, minute: cm || 0, second: 0, millisecond: 0 });
  if (dayClose <= dayOpen) {
    dayClose = dayClose.plus({ days: 1 });
  }
  if (start < dayOpen || end > dayClose) {
    throw new Error("Rezerwacja poza godzinami działania restauracji.");
  }
}

function assertNotPast(startMs) {
  const now = Date.now();
  if (startMs < now - 60 * 1000) {
    throw new Error("Nie można rezerwować terminów z przeszłości.");
  }
}

module.exports = {
  BUFFER_MS,
  BLOCKING,
  cleanupBufferMinutes,
  warsawFromParts,
  computeWindowMs,
  blockEndMsFromEnd,
  intervalsOverlapBlock,
  getReservation,
  isReservationBlocking,
  loadSettings,
  loadTablesList,
  filterBookableTables,
  isTableFree,
  findAvailableTableIds,
  allocateRestaurantNumber,
  releaseLocksForReservation,
  claimTableLocksInTransaction,
  claimTableLocksInTransactionFresh,
  replaceTableLocksInTransaction,
  setReservationAndTableLocksInTransaction,
  assertReservationWindowInSettings,
  assertNotPast,
};
