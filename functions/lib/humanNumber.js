const { DateTime } = require("luxon");
const { FieldValue, Timestamp } = require("firebase-admin/firestore");

const WARSAW = "Europe/Warsaw";

function reservationTypeLabel(service) {
  if (service === "hotel") return "HOTEL";
  if (service === "restaurant") return "RESTAURACJA";
  return "PRZYJĘCIA";
}

function currentWarsawYear() {
  return DateTime.now().setZone(WARSAW).year;
}

function reservationCollectionName(service) {
  if (service === "hotel") return "hotelReservations";
  if (service === "restaurant") return "restaurantReservations";
  return "venueReservations";
}

function timestampToWarsawYear(value) {
  if (!value) return null;
  if (typeof value.toMillis === "function") {
    return DateTime.fromMillis(value.toMillis(), { zone: WARSAW }).year;
  }
  if (value instanceof Date) {
    return DateTime.fromJSDate(value, { zone: WARSAW }).year;
  }
  const asNumber = Number(value);
  if (Number.isFinite(asNumber) && asNumber > 0) {
    return DateTime.fromMillis(asNumber, { zone: WARSAW }).year;
  }
  return null;
}

function extractReservationSequenceAndYear(rawValue) {
  const raw = String(rawValue || "").trim();
  if (!raw) return { sequence: null, year: null };
  const modern = raw.match(/^(\d+)\/(\d{4})\/(?:HOTEL|RESTAURACJA|PRZYJĘCIA)$/u);
  if (modern) {
    return {
      sequence: Number(modern[1]),
      year: Number(modern[2]),
    };
  }
  const legacyHotelOrRestaurant = raw.match(/^[A-Z]{2}-(\d{4})-(\d+)$/u);
  if (legacyHotelOrRestaurant) {
    return {
      sequence: Number(legacyHotelOrRestaurant[2]),
      year: Number(legacyHotelOrRestaurant[1]),
    };
  }
  if (/^\d+$/u.test(raw)) {
    return {
      sequence: Number(raw),
      year: null,
    };
  }
  return { sequence: null, year: null };
}

function formatHumanReservationNumber(recordOrRaw, service) {
  if (recordOrRaw == null) return "";
  const record =
    typeof recordOrRaw === "object" && !Array.isArray(recordOrRaw)
      ? recordOrRaw
      : { humanNumber: recordOrRaw };
  const raw =
    record.humanNumber ??
    record.human_number ??
    recordOrRaw;
  const rawText = String(raw || "").trim();
  if (!rawText) return "";
  if (/^\d+\/\d{4}\/(?:HOTEL|RESTAURACJA|PRZYJĘCIA)$/u.test(rawText)) {
    return rawText;
  }
  const parsed = extractReservationSequenceAndYear(rawText);
  const year =
    parsed.year ||
    timestampToWarsawYear(record.createdAt) ||
    timestampToWarsawYear(record.created_at) ||
    timestampToWarsawYear(record.startDateTime) ||
    timestampToWarsawYear(record.start_ms);
  if (parsed.sequence && year) {
    return `${parsed.sequence}/${year}/${reservationTypeLabel(service)}`;
  }
  return rawText;
}

function ensureFormattedReservationNumber(recordOrRaw, service, fallbackYear = currentWarsawYear()) {
  const formatted = formatHumanReservationNumber(recordOrRaw, service);
  if (!formatted) return "";
  if (!/^\d+$/u.test(formatted)) return formatted;
  const sequence = Number(formatted);
  const year = Number(fallbackYear);
  if (!Number.isInteger(sequence) || !Number.isInteger(year) || year < 2000 || year > 2100) {
    return formatted;
  }
  return `${sequence}/${year}/${reservationTypeLabel(service)}`;
}

function yearBounds(year) {
  const start = DateTime.fromObject({ year, month: 1, day: 1, hour: 0, minute: 0, second: 0, millisecond: 0 }, { zone: WARSAW });
  const end = start.plus({ years: 1 });
  return {
    start: Timestamp.fromDate(start.toJSDate()),
    end: Timestamp.fromDate(end.toJSDate()),
  };
}

async function allocateSharedReservationNumber(db, service, year = currentWarsawYear()) {
  const numericYear = Number(year);
  if (!Number.isInteger(numericYear) || numericYear < 2000 || numericYear > 2100) {
    throw new Error("Nieprawidłowy rok numeracji.");
  }
  const normalizedService = String(service || "").trim().toLowerCase() || "hotel";
  const counterRef = db.collection("bookingCounters").doc(`year_${numericYear}_${normalizedService}`);
  const reservationsRef = db.collection(reservationCollectionName(normalizedService));
  return db.runTransaction(async (tx) => {
    const counterSnap = await tx.get(counterRef);
    let nextSeq = Number(counterSnap.data()?.nextSeq || 0);
    if (!nextSeq) {
      const { start, end } = yearBounds(numericYear);
      const snapshot = await tx.get(reservationsRef.where("createdAt", ">=", start).where("createdAt", "<", end));
      let totalCount = 0;
      let maxSequence = 0;
      totalCount += snapshot.size;
      snapshot.forEach((doc) => {
        const data = doc.data() || {};
        const parsed = extractReservationSequenceAndYear(data.humanNumber);
        if (parsed.year === numericYear && Number(parsed.sequence || 0) > maxSequence) {
          maxSequence = Number(parsed.sequence || 0);
        }
      });
      nextSeq = Math.max(totalCount, maxSequence, 0) + 1;
    }
    tx.set(
      counterRef,
      {
        nextSeq: nextSeq + 1,
        updatedAt: FieldValue.serverTimestamp(),
      },
      { merge: true }
    );
    return `${nextSeq}/${numericYear}/${reservationTypeLabel(service)}`;
  });
}

module.exports = {
  reservationTypeLabel,
  currentWarsawYear,
  formatHumanReservationNumber,
  ensureFormattedReservationNumber,
  allocateSharedReservationNumber,
};
