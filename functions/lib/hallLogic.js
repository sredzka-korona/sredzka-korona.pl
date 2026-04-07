const { DateTime } = require("luxon");
const { FieldValue } = require("firebase-admin/firestore");
const { allocateSharedReservationNumber } = require("./humanNumber");

const WARSAW = "Europe/Warsaw";

/** Statusy blokujące zasoby sali */
const BLOCKING = ["pending", "confirmed", "manual_block"];

function dtFromDateAndTime(dateStr, timeStr) {
  const t = DateTime.fromISO(`${dateStr}T${timeStr}`, { zone: WARSAW });
  if (!t.isValid) return null;
  return t;
}

/** Data kalendarzowa YYYY-MM-DD nie wcześniejsza niż dziś (strefa Europe/Warsaw). */
function assertNotPastCalendarDateWarsaw(dateStr) {
  const d = String(dateStr || "").trim();
  if (!/^\d{4}-\d{2}-\d{2}$/.test(d)) {
    return { ok: false, error: "Nieprawidłowa data." };
  }
  const now = DateTime.now().setZone(WARSAW);
  const today = now.toISODate();
  if (d < today) {
    return { ok: false, error: "Data rezerwacji nie może być z przeszłości." };
  }
  const maxDate = now.plus({ years: 3 }).toISODate();
  if (d > maxDate) {
    return { ok: false, error: "Rezerwację sali można złożyć maksymalnie na 3 lata do przodu." };
  }
  return { ok: true };
}

/**
 * Koniec zajętości sali dla konfliktów: koniec wydarzenia + bufor (np. przerwa organizacyjna).
 */
function computeBlockEndMs(startMs, endMs, bufferMinutes) {
  const buf = Number(bufferMinutes) || 60;
  return endMs + buf * 60 * 1000;
}

/**
 * Czy [aStart,aEnd) przecina się z [bStart,bEnd) (półotwarte przedziały).
 */
function rangesOverlap(aStart, aEnd, bStart, bEnd) {
  return aStart < bEnd && bStart < aEnd;
}

function isFullBlockLargeHall(r, fullGuestThreshold) {
  const thr = Number(fullGuestThreshold) > 0 ? Number(fullGuestThreshold) : 100;
  return Boolean(r.exclusive) || Number(r.guestsCount || 0) >= thr;
}

/**
 * Sprawdza dostępność sali. excludeReservationId — przy edycji / potwierdzaniu.
 */
function evaluateLargeHallOverlap({
  hallCapacity,
  fullGuestThreshold,
  newGuests,
  newExclusive,
  overlapping,
  excludeReservationId,
}) {
  const thr = Number(fullGuestThreshold) > 0 ? Number(fullGuestThreshold) : 100;
  const cap = Number(hallCapacity) || 120;

  const newFull = Boolean(newExclusive) || Number(newGuests) >= thr;

  let partialSum = 0;
  for (const r of overlapping) {
    if (excludeReservationId && r.id === excludeReservationId) continue;
    if (r.status === "manual_block") {
      return { ok: false, reason: "manual_block" };
    }
    if (isFullBlockLargeHall(r, thr)) {
      return { ok: false, reason: "full_block_existing" };
    }
    partialSum += Number(r.guestsCount || 0);
  }

  if (newFull) {
    const others = overlapping.filter((r) => !excludeReservationId || r.id !== excludeReservationId);
    if (others.length > 0) {
      return { ok: false, reason: "exclusive_or_full_needs_empty" };
    }
    return { ok: true };
  }

  if (partialSum + Number(newGuests) > cap) {
    return { ok: false, reason: "capacity", maxGuests: Math.max(0, cap - partialSum) };
  }
  return { ok: true, maxGuests: cap - partialSum };
}

function evaluateSmallHallOverlap({ overlapping, excludeReservationId }) {
  for (const r of overlapping) {
    if (excludeReservationId && r.id === excludeReservationId) continue;
    if (BLOCKING.includes(r.status)) {
      return { ok: false, reason: "occupied" };
    }
  }
  return { ok: true };
}

async function loadOverlappingReservations(db, hallId, blockStartMs, blockEndMs, excludeId) {
  const snap = await db
    .collection("venueReservations")
    .where("hallId", "==", hallId)
    .where("status", "in", ["pending", "confirmed", "manual_block"])
    .get();

  const rows = [];
  snap.forEach((d) => {
    const x = { id: d.id, ...d.data() };
    if (excludeId && x.id === excludeId) return;
    const bs = Number(x.blockStartMs || 0);
    const be = Number(x.blockEndMs || 0);
    if (!bs || !be) return;
    if (rangesOverlap(blockStartMs, blockEndMs, bs, be)) {
      rows.push(x);
    }
  });
  return rows;
}

async function hasBlockingReservationOnDate(db, hallId, reservationDate, excludeId) {
  const rows = await loadBlockingReservationsOnDate(db, hallId, reservationDate, excludeId);
  return rows.length > 0;
}

async function loadBlockingReservationsOnDate(db, hallId, reservationDate, excludeId) {
  const snap = await db
    .collection("venueReservations")
    .where("hallId", "==", hallId)
    .where("reservationDate", "==", String(reservationDate || ""))
    .where("status", "in", ["pending", "confirmed", "manual_block"])
    .get();
  const rows = [];
  for (const d of snap.docs) {
    if (excludeId && d.id === excludeId) continue;
    rows.push({ id: d.id, ...d.data() });
  }
  return rows;
}

async function checkHallAvailability(db, hallDoc, input, excludeReservationId, internalOptions = {}) {
  const hall = hallDoc.data ? { id: hallDoc.id, ...hallDoc.data() } : hallDoc;
  const bufferMinutes = Number(hall.bufferMinutes) ?? 60;
  const hallKind = hall.hallKind || (hall.capacity <= 40 ? "small" : "large");

  const start = dtFromDateAndTime(input.reservationDate, input.startTime);
  if (!start) return { ok: false, error: "Nieprawidłowa data lub godzina." };
  const durationHours = Number(input.durationHours);
  if (!durationHours || durationHours <= 0 || durationHours > 24) {
    return { ok: false, error: "Nieprawidłowa liczba godzin." };
  }
  const end = start.plus({ hours: durationHours });
  const startMs = start.toMillis();
  const endMs = end.toMillis();
  const blockStartMs = startMs;
  const blockEndMs = computeBlockEndMs(startMs, endMs, bufferMinutes);

  const now = Date.now();
  if (startMs < now - 60 * 1000) {
    return { ok: false, error: "Nie można rezerwować terminu z przeszłości." };
  }
  const guestsCount = Number(input.guestsCount || 0);
  const exclusive = Boolean(input.exclusive);

  if (hallKind === "small") {
    const isTakenOnDate = await hasBlockingReservationOnDate(
      db,
      hall.id,
      input.reservationDate,
      excludeReservationId
    );
    if (isTakenOnDate) {
      return { ok: false, error: "Wybrana data jest już zarezerwowana dla tej sali." };
    }
    if (guestsCount > Number(hall.capacity || 40)) {
      return { ok: false, error: `Maksymalnie ${hall.capacity} osób w tej sali.` };
    }
    return {
      ok: true,
      blockStartMs,
      blockEndMs,
      startMs,
      endMs,
      reservationDate: input.reservationDate,
      endTimeLabel: end.toFormat("HH:mm"),
      startTimeLabel: start.toFormat("HH:mm"),
    };
  }

  const fullThr = Number(hall.fullBlockGuestThreshold) > 0 ? Number(hall.fullBlockGuestThreshold) : 100;
  const cap = Number(hall.capacity) || 120;

  if (guestsCount > cap) {
    return { ok: false, error: `Maksymalnie ${cap} osób w tej sali.` };
  }
  if (guestsCount < 1) {
    return { ok: false, error: "Podaj liczbę gości." };
  }

  const blockingOnDate = await loadBlockingReservationsOnDate(
    db,
    hall.id,
    input.reservationDate,
    excludeReservationId
  );
  const ev = evaluateLargeHallOverlap({
    hallCapacity: cap,
    fullGuestThreshold: fullThr,
    newGuests: guestsCount,
    newExclusive: exclusive,
    overlapping: blockingOnDate,
    excludeReservationId,
  });
  if (!ev.ok) {
    if (ev.reason === "capacity") {
      return {
        ok: false,
        error: `Brak miejsc: w tym dniu pozostało maks. ${ev.maxGuests} osób (limit sali ${cap}).`,
        maxGuests: ev.maxGuests,
      };
    }
    return { ok: false, error: "Wybrana data nie jest dostępna (kolizja z inną rezerwacją lub wyłącznością)." };
  }

  return {
    ok: true,
    blockStartMs,
    blockEndMs,
    startMs,
    endMs,
    reservationDate: input.reservationDate,
    endTimeLabel: end.toFormat("HH:mm"),
    startTimeLabel: start.toFormat("HH:mm"),
    maxGuests: ev.maxGuests != null ? ev.maxGuests : cap,
  };
}

async function allocateHallReservationNumber(db) {
  return allocateSharedReservationNumber(db, "hall");
}

module.exports = {
  WARSAW,
  BLOCKING,
  dtFromDateAndTime,
  assertNotPastCalendarDateWarsaw,
  computeBlockEndMs,
  rangesOverlap,
  checkHallAvailability,
  loadOverlappingReservations,
  isFullBlockLargeHall,
  allocateHallReservationNumber,
  evaluateLargeHallOverlap,
  evaluateSmallHallOverlap,
};
