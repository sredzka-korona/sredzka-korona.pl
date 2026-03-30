/**
 * Seed 14 pokoi do kolekcji hotelRooms.
 * Uruchomienie (w katalogu functions/, z ustawionym projektem Firebase / ADC):
 *   npm run seed:rooms
 *
 * Wymaga: zmiennej GOOGLE_APPLICATION_CREDENTIALS lub `firebase login` + application default credentials.
 */
const admin = require("firebase-admin");

if (!admin.apps.length) {
  admin.initializeApp();
}

const db = admin.firestore();

const ROOMS = [
  { id: "room-01", name: "Pokój 101", pricePerNight: 280, maxGuests: 1, bedsSingle: 1, bedsDouble: 0, bedsChild: 0, sortOrder: 1 },
  { id: "room-02", name: "Pokój 102", pricePerNight: 280, maxGuests: 1, bedsSingle: 1, bedsDouble: 0, bedsChild: 0, sortOrder: 2 },
  { id: "room-03", name: "Pokój 201", pricePerNight: 320, maxGuests: 2, bedsSingle: 0, bedsDouble: 1, bedsChild: 0, sortOrder: 3 },
  { id: "room-04", name: "Pokój 202", pricePerNight: 320, maxGuests: 2, bedsSingle: 0, bedsDouble: 1, bedsChild: 0, sortOrder: 4 },
  { id: "room-05", name: "Pokój 203", pricePerNight: 340, maxGuests: 2, bedsSingle: 2, bedsDouble: 0, bedsChild: 0, sortOrder: 5 },
  { id: "room-06", name: "Pokój 204", pricePerNight: 340, maxGuests: 2, bedsSingle: 0, bedsDouble: 1, bedsChild: 0, sortOrder: 6 },
  { id: "room-07", name: "Apartament 301", pricePerNight: 420, maxGuests: 3, bedsSingle: 0, bedsDouble: 1, bedsChild: 1, sortOrder: 7 },
  { id: "room-08", name: "Apartament 302", pricePerNight: 420, maxGuests: 3, bedsSingle: 1, bedsDouble: 1, bedsChild: 0, sortOrder: 8 },
  { id: "room-09", name: "Pokój rodzinny 303", pricePerNight: 450, maxGuests: 4, bedsSingle: 0, bedsDouble: 2, bedsChild: 0, sortOrder: 9 },
  { id: "room-10", name: "Pokój 304", pricePerNight: 360, maxGuests: 2, bedsSingle: 0, bedsDouble: 1, bedsChild: 0, sortOrder: 10 },
  { id: "room-11", name: "Pokój 305", pricePerNight: 360, maxGuests: 2, bedsSingle: 0, bedsDouble: 1, bedsChild: 0, sortOrder: 11 },
  { id: "room-12", name: "Studio 401", pricePerNight: 380, maxGuests: 2, bedsSingle: 0, bedsDouble: 1, bedsChild: 0, sortOrder: 12 },
  { id: "room-13", name: "Studio 402", pricePerNight: 380, maxGuests: 2, bedsSingle: 0, bedsDouble: 1, bedsChild: 0, sortOrder: 13 },
  { id: "room-14", name: "Apartament Premium 403", pricePerNight: 520, maxGuests: 4, bedsSingle: 0, bedsDouble: 2, bedsChild: 0, sortOrder: 14 },
];

async function run() {
  const batch = db.batch();
  const now = admin.firestore.FieldValue.serverTimestamp();
  for (const r of ROOMS) {
    const { id, ...fields } = r;
    const ref = db.collection("hotelRooms").doc(id);
    batch.set(
      ref,
      {
        ...fields,
        description: "",
        imageUrls: [],
        active: true,
        updatedAt: now,
      },
      { merge: true }
    );
  }
  await batch.commit();
  await db.collection("hotelSettings").doc("settings").set(
    {
      hotelName: "Średzka Korona",
      updatedAt: now,
    },
    { merge: true }
  );
  console.log("Zapisano 14 pokoi oraz hotelSettings/settings.");
  process.exit(0);
}

run().catch((e) => {
  console.error(e);
  process.exit(1);
});
