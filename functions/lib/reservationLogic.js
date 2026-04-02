const { FieldValue, Timestamp } = require("firebase-admin/firestore");
const { enumerateNights, nightsCount, parseYmd, todayYmd } = require("./dates");
const { allocateSharedReservationNumber } = require("./humanNumber");

const BLOCKING = new Set(["email_verification_pending", "pending", "confirmed", "manual_block"]);

/** roomId nie powinien zawierać „__”; dateStr = YYYY-MM-DD */
function nightDocId(roomId, dateStr) {
  return `${roomId}__${dateStr}`;
}

async function getReservation(db, id) {
  const snap = await db.collection("hotelReservations").doc(id).get();
  return snap.exists ? { id: snap.id, ...snap.data() } : null;
}

async function isReservationBlocking(db, reservationId) {
  if (!reservationId) return false;
  const r = await getReservation(db, reservationId);
  if (!r) return false;
  return BLOCKING.has(r.status);
}

/**
 * Sprawdza cień nocy — poza transakcją (odczyty przed tx).
 */
async function checkNightsAvailable(db, roomIds, nights, excludeReservationId) {
  for (const roomId of roomIds) {
    for (const dateStr of nights) {
      const nid = nightDocId(roomId, dateStr);
      const snap = await db.collection("hotelRoomNights").doc(nid).get();
      if (!snap.exists) continue;
      const other = snap.data().reservationId;
      if (other && other !== excludeReservationId) {
        const blocking = await isReservationBlocking(db, other);
        if (blocking) {
          return { ok: false, roomId, dateStr, blockedBy: other };
        }
      }
    }
  }
  return { ok: true };
}

function buildNightKeys(roomIds, nights) {
  const nightKeys = [];
  for (const roomId of roomIds) {
    for (const dateStr of nights) {
      nightKeys.push(nightDocId(roomId, dateStr));
    }
  }
  return nightKeys;
}

/**
 * Atomowe zajęcie nocy w ramach istniejącej transakcji Firestore.
 */
async function claimNightsInTransactionAsync(tx, db, { reservationId, roomIds, nights, statusForLocks }) {
  const nightKeys = buildNightKeys(roomIds, nights);
  const refs = nightKeys.map((key) => db.collection("hotelRoomNights").doc(key));
  const snaps = [];
  for (const ref of refs) {
    snaps.push(await tx.get(ref));
  }
  const resRefsToRead = new Set();
  for (let i = 0; i < nightKeys.length; i += 1) {
    const key = nightKeys[i];
    const snap = snaps[i];
    const sep = key.lastIndexOf("__");
    const roomId = sep === -1 ? key : key.slice(0, sep);
    const dateStr = sep === -1 ? "" : key.slice(sep + 2);
    if (snap.exists) {
      const other = snap.data().reservationId;
      if (other && other !== reservationId) {
        resRefsToRead.add(other);
      }
    }
  }
  const otherStatuses = {};
  for (const rid of resRefsToRead) {
    const rSnap = await tx.get(db.collection("hotelReservations").doc(rid));
    otherStatuses[rid] = rSnap.exists ? rSnap.data().status : null;
  }
  for (let i = 0; i < nightKeys.length; i += 1) {
    const key = nightKeys[i];
    const snap = snaps[i];
    const ref = refs[i];
    const sep = key.lastIndexOf("__");
    const roomId = sep === -1 ? key : key.slice(0, sep);
    const dateStr = sep === -1 ? "" : key.slice(sep + 2);
    if (snap.exists) {
      const other = snap.data().reservationId;
      if (other && other !== reservationId) {
        const st = otherStatuses[other];
        if (st && BLOCKING.has(st)) {
          throw new Error("CONFLICT: termin został zajęty przez inną rezerwację. Odśwież wyszukiwanie.");
        }
      }
    }
    tx.set(ref, {
      roomId,
      dateStr,
      reservationId,
      lockStatus: statusForLocks,
      updatedAt: FieldValue.serverTimestamp(),
    });
  }
  return nightKeys;
}

async function releaseNightsForReservation(db, reservationId) {
  const res = await getReservation(db, reservationId);
  if (!res || !res.nightKeys || !res.nightKeys.length) {
    return;
  }
  const batch = db.batch();
  for (const key of res.nightKeys) {
    batch.delete(db.collection("hotelRoomNights").doc(key));
  }
  batch.update(db.collection("hotelReservations").doc(reservationId), {
    nightKeys: [],
    updatedAt: FieldValue.serverTimestamp(),
  });
  await batch.commit();
}

function computeLineItems(roomsById, roomIds, dateFrom, dateTo) {
  const nights = nightsCount(dateFrom, dateTo);
  if (nights < 1) {
    throw new Error("Wymagana jest co najmniej jedna noc.");
  }
  const items = [];
  let total = 0;
  for (const roomId of roomIds) {
    const room = roomsById[roomId];
    if (!room || !room.active) {
      throw new Error("Nieprawidłowy pokój.");
    }
    const price = Number(room.pricePerNight || 0);
    const line = Math.round(price * nights * 100) / 100;
    total += line;
    items.push({
      roomId,
      roomNameSnapshot: room.name || roomId,
      pricePerNightSnapshot: price,
      nights,
      lineTotal: line,
    });
  }
  total = Math.round(total * 100) / 100;
  return { items, total, nights };
}

async function allocateReservationNumber(db) {
  return allocateSharedReservationNumber(db, "hotel");
}

function assertDatesValid(dateFrom, dateTo) {
  const a = parseYmd(dateFrom);
  const b = parseYmd(dateTo);
  if (!a || !b) {
    throw new Error("Nieprawidłowy format dat.");
  }
  if (b <= a) {
    throw new Error("Data wyjazdu musi być późniejsza niż przyjazdu.");
  }
  const t = todayYmd();
  if (dateFrom < t) {
    throw new Error("Nie można rezerwować dat wstecz.");
  }
  if (nightsCount(dateFrom, dateTo) < 1) {
    throw new Error("Minimum jedna noc.");
  }
}

/**
 * Zastąpienie blokad nocy w jednej transakcji (odczyty przed zapisami zgodnie z Firestore).
 * Usuwa stare klucze, zakłada nowe — bez okna wyścigu między release a claim.
 */
async function swapNightsInTransaction(tx, db, { reservationId, oldNightKeys, roomIds, nights, statusForLocks }) {
  const newKeys = buildNightKeys(roomIds, nights);
  const oldRefs = (oldNightKeys || []).map((k) => db.collection("hotelRoomNights").doc(k));
  const oldSnaps = [];
  for (const r of oldRefs) {
    oldSnaps.push(await tx.get(r));
  }
  const newRefs = newKeys.map((k) => db.collection("hotelRoomNights").doc(k));
  const newSnaps = [];
  for (const r of newRefs) {
    newSnaps.push(await tx.get(r));
  }
  const resIds = new Set();
  for (let i = 0; i < newKeys.length; i += 1) {
    const s = newSnaps[i];
    if (s.exists) {
      const o = s.data().reservationId;
      if (o && o !== reservationId) {
        resIds.add(o);
      }
    }
  }
  const otherStatuses = {};
  for (const rid of resIds) {
    const rSnap = await tx.get(db.collection("hotelReservations").doc(rid));
    otherStatuses[rid] = rSnap.exists ? rSnap.data().status : null;
  }
  for (let i = 0; i < newKeys.length; i += 1) {
    const key = newKeys[i];
    const snap = newSnaps[i];
    if (snap.exists) {
      const other = snap.data().reservationId;
      if (other && other !== reservationId) {
        const st = otherStatuses[other];
        if (st && BLOCKING.has(st)) {
          throw new Error("CONFLICT: termin został zajęty przez inną rezerwację.");
        }
      }
    }
  }
  for (let i = 0; i < oldRefs.length; i += 1) {
    if (oldSnaps[i].exists) {
      tx.delete(oldRefs[i]);
    }
  }
  for (let i = 0; i < newKeys.length; i += 1) {
    const key = newKeys[i];
    const ref = newRefs[i];
    const sep = key.lastIndexOf("__");
    const roomId = sep === -1 ? key : key.slice(0, sep);
    const dateStr = sep === -1 ? "" : key.slice(sep + 2);
    tx.set(ref, {
      roomId,
      dateStr,
      reservationId,
      lockStatus: statusForLocks,
      updatedAt: FieldValue.serverTimestamp(),
    });
  }
  return newKeys;
}

module.exports = {
  nightDocId,
  getReservation,
  isReservationBlocking,
  checkNightsAvailable,
  buildNightKeys,
  claimNightsInTransactionAsync,
  swapNightsInTransaction,
  releaseNightsForReservation,
  computeLineItems,
  allocateReservationNumber,
  assertDatesValid,
  enumerateNights,
  nightsCount,
  BLOCKING,
  Timestamp,
  FieldValue,
};
