/**
 * Cloud Functions — moduł hotelowy (Firestore + SMTP + cron).
 * Routing: HTTPS endpoint `hotelApi` z parametrem ?op=... (Functions nie obsługują ścieżek podfunkcji bez Hosting rewrite).
 */
const { onRequest } = require("firebase-functions/v2/https");
const { onSchedule } = require("firebase-functions/v2/scheduler");
const { initializeApp, getApps } = require("firebase-admin/app");
const { getFirestore, FieldValue, Timestamp } = require("firebase-admin/firestore");
const { parsePhoneNumberFromString } = require("libphonenumber-js");

const {
  checkNightsAvailable,
  computeLineItems,
  allocateReservationNumber,
  assertDatesValid,
  enumerateNights,
  getReservation,
  claimNightsInTransactionAsync,
  swapNightsInTransaction,
  releaseNightsForReservation,
  nightsCount,
} = require("./lib/reservationLogic");

const { checkRateLimit } = require("./lib/rateLimit");
const { checkSpamBlock, setSpamBlock } = require("./lib/bookingSpamBlock");
const {
  SESSION_MS,
  EMAIL_LINK_MS,
  HOTEL_PENDING_MS,
} = require("./lib/bookingConstants");
const {
  renderTemplate,
  getMailTemplate,
  sendMail,
  escapeHtml,
} = require("./lib/mail");
const {
  json,
  verifyAdminAuth,
  hashToken,
  randomToken,
  verifyTurnstile,
  roomsListFromItems,
} = require("./lib/apiHelpers");

if (!getApps().length) {
  initializeApp();
}

const db = getFirestore();

function hotelName() {
  return process.env.HOTEL_NAME || "Średzka Korona";
}

function publicSiteUrl() {
  return (process.env.PUBLIC_SITE_URL || "https://example.com").replace(/\/$/, "");
}

function adminNotifyEmail() {
  return process.env.ADMIN_NOTIFY_EMAIL || "";
}

function corsHeaders(req) {
  const origin = req.headers.origin || "";
  const allowed = (process.env.CORS_ORIGINS || "*")
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean);
  const allow =
    allowed.includes("*") || allowed.length === 0
      ? "*"
      : allowed.includes(origin)
        ? origin
        : allowed[0] || "*";
  return {
    "Access-Control-Allow-Origin": allow,
    "Access-Control-Allow-Methods": "GET,POST,PATCH,PUT,DELETE,OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type, Authorization",
    "Access-Control-Max-Age": "3600",
  };
}

function withCors(res, headers) {
  Object.entries(headers).forEach(([k, v]) => res.set(k, v));
}

async function appendAudit(db, { action, reservationId, actorEmail, details }) {
  await db.collection("hotelAuditLog").add({
    action,
    reservationId: reservationId || null,
    actorEmail: actorEmail || null,
    details: details || {},
    createdAt: FieldValue.serverTimestamp(),
  });
}

function validatePhone(prefix, national) {
  const p = String(prefix || "").trim();
  const n = String(national || "").replace(/[^\d]/g, "");
  const full = `${p}${n}`;
  const parsed = parsePhoneNumberFromString(full);
  if (!parsed || !parsed.isValid()) {
    return null;
  }
  return parsed.format("E.164");
}

async function loadRoomsMap() {
  const snap = await db.collection("hotelRooms").get();
  const map = {};
  snap.forEach((d) => {
    map[d.id] = { id: d.id, ...d.data() };
  });
  return map;
}

async function loadActiveRoomsList() {
  const snap = await db
    .collection("hotelRooms")
    .where("active", "==", true)
    .orderBy("sortOrder", "asc")
    .get()
    .catch(async () => {
      const s2 = await db.collection("hotelRooms").where("active", "==", true).get();
      return s2;
    });
  const list = [];
  snap.forEach((d) => list.push({ id: d.id, ...d.data() }));
  list.sort((a, b) => (a.sortOrder || 0) - (b.sortOrder || 0));
  return list;
}

async function deleteReservationItems(db, reservationId) {
  const q = await db.collection("hotelReservationItems").where("reservationId", "==", reservationId).get();
  const batch = db.batch();
  q.forEach((d) => batch.delete(d.ref));
  await batch.commit();
}

async function saveReservationItems(db, reservationId, items) {
  const batch = db.batch();
  items.forEach((item) => {
    const ref = db.collection("hotelReservationItems").doc();
    batch.set(ref, {
      reservationId,
      ...item,
      createdAt: FieldValue.serverTimestamp(),
    });
  });
  await batch.commit();
}

function buildMailVars(reservation, items, extra = {}) {
  const nights = nightsCount(reservation.dateFrom, reservation.dateTo);
  return {
    reservationId: reservation.id,
    reservationNumber: reservation.humanNumber || reservation.id,
    fullName: reservation.customerName || "",
    email: reservation.email || "",
    phone: `${reservation.phonePrefix || ""} ${reservation.phoneNational || ""}`.trim(),
    roomsList: roomsListFromItems(items),
    dateFrom: reservation.dateFrom,
    dateTo: reservation.dateTo,
    nights: String(nights),
    totalPrice: String(reservation.totalPrice ?? ""),
    customerNote: reservation.customerNote || "",
    adminNote: reservation.adminNote || "",
    confirmationLink: extra.confirmationLink || "",
    hotelName: hotelName(),
    ...extra,
  };
}

async function sendTemplated(db, key, to, vars) {
  const t = await getMailTemplate(db, key);
  const subject = renderTemplate(t.subject, vars);
  const html = renderTemplate(t.bodyHtml, vars);
  await sendMail(key, { to, subject, html });
}

exports.hotelApi = onRequest(
  {
    region: "europe-west1",
    timeoutSeconds: 120,
    memory: "512MiB",
  },
  async (req, res) => {
    const headers = corsHeaders(req);
    withCors(res, headers);
    if (req.method === "OPTIONS") {
      res.status(204).send("");
      return;
    }

    const url = new URL(req.url, "http://localhost");
    const op = url.searchParams.get("op") || "";

    try {
      if (req.method === "GET" && op === "health") {
        json(res, { ok: true, service: "hotelApi" });
        return;
      }

      if (req.method === "GET" && op === "public-rooms") {
        const rooms = await loadActiveRoomsList();
        json(res, {
          rooms: rooms.map((r) => ({
            id: r.id,
            name: r.name,
            pricePerNight: r.pricePerNight,
            maxGuests: r.maxGuests,
            bedsSingle: r.bedsSingle ?? 0,
            bedsDouble: r.bedsDouble ?? 0,
            bedsChild: r.bedsChild ?? 0,
            description: r.description || "",
            imageUrls: r.imageUrls || [],
          })),
        });
        return;
      }

      if (req.method === "POST" && op === "public-availability") {
        const body = typeof req.body === "object" && req.body ? req.body : JSON.parse(req.body || "{}");
        const { dateFrom, dateTo } = body;
        assertDatesValid(dateFrom, dateTo);
        const nights = enumerateNights(dateFrom, dateTo);
        const rooms = await loadActiveRoomsList();
        const available = [];
        for (const room of rooms) {
          const chk = await checkNightsAvailable(db, [room.id], nights, null);
          if (chk.ok) {
            available.push({
              id: room.id,
              name: room.name,
              pricePerNight: room.pricePerNight,
              maxGuests: room.maxGuests,
              bedsSingle: room.bedsSingle ?? 0,
              bedsDouble: room.bedsDouble ?? 0,
              bedsChild: room.bedsChild ?? 0,
              description: room.description || "",
              imageUrls: room.imageUrls || [],
            });
          }
        }
        json(res, { dateFrom, dateTo, nights: nights.length, availableRoomIds: available.map((r) => r.id), rooms: available });
        return;
      }

      if (req.method === "POST" && op === "public-reservation-draft") {
        const body = typeof req.body === "object" && req.body ? req.body : JSON.parse(req.body || "{}");
        const hp = body.hpCompanyWebsite;
        if (hp) {
          json(res, { ok: true });
          return;
        }

        const ip = req.headers["x-forwarded-for"]?.split(",")[0]?.trim() || req.ip || "unknown";
        const emailKey = String(body.email || "").toLowerCase().trim();
        const spam = await checkSpamBlock(db, "hotel", ip, emailKey);
        if (spam.blocked) {
          json(
            res,
            {
              error: `Odczekaj około ${spam.waitMinutes} min. przed kolejnym zgłoszeniem z tego urządzenia lub adresu e-mail.`,
            },
            429
          );
          return;
        }
        const okRlIp = await checkRateLimit(db, `ip:${ip}:draft`);
        const okRlEm = !emailKey || (await checkRateLimit(db, `em:${emailKey}:draft`));
        if (!okRlIp || !okRlEm) {
          json(res, { error: "Zbyt wiele prób. Spróbuj później." }, 429);
          return;
        }

        const turnOk = await verifyTurnstile(body.turnstileToken, ip);
        if (!turnOk) {
          json(res, { error: "Weryfikacja anty-spam nie powiodła się." }, 400);
          return;
        }

        const sessionStartedAt = Number(body.sessionStartedAt || 0);
        if (!sessionStartedAt || Date.now() - sessionStartedAt > SESSION_MS) {
          json(res, { error: "Sesja rezerwacji wygasła (30 min). Rozpocznij od nowa." }, 400);
          return;
        }

        const { dateFrom, dateTo, roomIds, fullName, email, phonePrefix, phoneNational, customerNote, termsAccepted } = body;
        if (!termsAccepted) {
          json(res, { error: "Wymagana akceptacja regulaminu." }, 400);
          return;
        }
        assertDatesValid(dateFrom, dateTo);
        const phoneE164 = validatePhone(phonePrefix, phoneNational);
        if (!phoneE164) {
          json(res, { error: "Nieprawidłowy numer telefonu z prefiksem międzynarodowym." }, 400);
          return;
        }
        if (!fullName || !email || !String(email).includes("@")) {
          json(res, { error: "Wypełnij imię i nazwisko oraz poprawny e-mail." }, 400);
          return;
        }
        if (!Array.isArray(roomIds) || !roomIds.length) {
          json(res, { error: "Wybierz co najmniej jeden pokój." }, 400);
          return;
        }

        const roomsMap = await loadRoomsMap();
        const { items, total } = computeLineItems(roomsMap, roomIds, dateFrom, dateTo);
        const nights = enumerateNights(dateFrom, dateTo);
        const avail = await checkNightsAvailable(db, roomIds, nights, null);
        if (!avail.ok) {
          json(res, { error: "Wybrane pokoje nie są już dostępne w tym terminie. Wróć i wybierz ponownie." }, 409);
          return;
        }

        const humanNumber = await allocateReservationNumber(db);
        const token = randomToken();
        const tokenHash = hashToken(token);
        const now = Date.now();
        const resRef = db.collection("hotelReservations").doc();
        const confirmationLink = `${publicSiteUrl()}/Hotel/potwierdzenie.html?token=${encodeURIComponent(token)}`;

        await db.runTransaction(async (tx) => {
          tx.set(resRef, {
            humanNumber,
            status: "email_verification_pending",
            customerName: String(fullName).trim(),
            email: String(email).trim().toLowerCase(),
            phonePrefix: String(phonePrefix || "").trim(),
            phoneNational: String(phoneNational || "").replace(/[^\d]/g, ""),
            phoneE164,
            customerNote: String(customerNote || "").trim().slice(0, 2000),
            adminNote: "",
            dateFrom,
            dateTo,
            totalPrice: total,
            confirmationTokenHash: tokenHash,
            emailVerificationExpiresAt: Timestamp.fromMillis(now + EMAIL_LINK_MS),
            pendingExpiresAt: null,
            nightKeys: [],
            createdAt: FieldValue.serverTimestamp(),
            updatedAt: FieldValue.serverTimestamp(),
            source: "web",
          });
        });

        await saveReservationItems(db, resRef.id, items);

        const vars = buildMailVars(
          {
            id: resRef.id,
            humanNumber,
            customerName: String(fullName).trim(),
            email,
            phonePrefix,
            phoneNational,
            customerNote,
            dateFrom,
            dateTo,
            totalPrice: total,
          },
          items,
          { confirmationLink }
        );
        await sendTemplated(db, "confirm_email", vars.email, vars);
        await setSpamBlock(db, "hotel", ip, emailKey);

        await appendAudit(db, {
          action: "reservation_draft_created",
          reservationId: resRef.id,
          details: { humanNumber },
        });

        json(res, {
          ok: true,
          reservationId: resRef.id,
          humanNumber,
          message: "Wysłano wiadomość z linkiem potwierdzającym.",
        });
        return;
      }

      if (req.method === "POST" && op === "public-reservation-confirm") {
        const body = typeof req.body === "object" && req.body ? req.body : JSON.parse(req.body || "{}");
        const token = String(body.token || "").trim();
        if (!token) {
          json(res, { error: "Brak tokenu." }, 400);
          return;
        }
        const th = hashToken(token);
        const q = await db.collection("hotelReservations").where("confirmationTokenHash", "==", th).limit(1).get();
        if (q.empty) {
          json(res, { error: "Nieprawidłowy lub wygasły link." }, 400);
          return;
        }
        const doc = q.docs[0];
        const resData = doc.data();
        const reservationId = doc.id;

        if (resData.status !== "email_verification_pending") {
          json(res, { error: "Ta rezerwacja została już przetworzona." }, 400);
          return;
        }
        const exp = resData.emailVerificationExpiresAt?.toMillis?.() || 0;
        if (exp && Date.now() > exp) {
          json(res, { error: "Link wygasł (minęło 2 godziny). Złóż zgłoszenie ponownie." }, 400);
          return;
        }

        const itemsSnap = await db.collection("hotelReservationItems").where("reservationId", "==", reservationId).get();
        const items = [];
        itemsSnap.forEach((d) => items.push(d.data()));
        const roomIdsFromItems = [...new Set(items.map((i) => i.roomId))];
        if (!roomIdsFromItems.length) {
          json(res, { error: "Brak pozycji rezerwacji." }, 400);
          return;
        }
        const nights = enumerateNights(resData.dateFrom, resData.dateTo);

        try {
          await db.runTransaction(async (tx) => {
            const snap = await tx.get(doc.ref);
            const cur = snap.data();
            if (cur.status !== "email_verification_pending") {
              throw new Error("STATUS_CHANGED");
            }
            const nightKeys = await claimNightsInTransactionAsync(tx, db, {
              reservationId,
              roomIds: roomIdsFromItems,
              nights,
              statusForLocks: "pending",
            });
            const pendingUntil = Timestamp.fromMillis(Date.now() + HOTEL_PENDING_MS);
            tx.update(doc.ref, {
              status: "pending",
              nightKeys,
              confirmationTokenHash: FieldValue.delete(),
              emailVerificationExpiresAt: FieldValue.delete(),
              pendingExpiresAt: pendingUntil,
              updatedAt: FieldValue.serverTimestamp(),
            });
          });
        } catch (e) {
          if (e.message === "STATUS_CHANGED") {
            json(res, { error: "Ta rezerwacja została już przetworzona." }, 400);
            return;
          }
          if (String(e.message || "").includes("CONFLICT")) {
            json(res, { error: "Termin został zajęty przez inną osobę. Skontaktuj się z recepcją." }, 409);
            return;
          }
          throw e;
        }

        const reread = await getReservation(db, reservationId);
        const items2 = [];
        const iq = await db.collection("hotelReservationItems").where("reservationId", "==", reservationId).get();
        iq.forEach((d) => items2.push(d.data()));

        const varsBase = buildMailVars({ ...reread, id: reservationId }, items2, {});
        await sendTemplated(db, "pending_client", varsBase.email, varsBase);
        const adm = adminNotifyEmail();
        if (adm) {
          await sendTemplated(db, "pending_admin", adm, varsBase);
        }

        await appendAudit(db, {
          action: "email_confirmed_pending",
          reservationId,
          details: {},
        });

        json(res, { ok: true, status: "pending", reservationId, humanNumber: reread.humanNumber });
        return;
      }

      /* ——— Admin ——— */
      const authHeader = req.headers.authorization || "";
      let adminUser;
      try {
        adminUser = await verifyAdminAuth(require("firebase-admin"), authHeader);
      } catch (e) {
        if (e.message === "UNAUTHORIZED" || e.message === "FORBIDDEN") {
          json(res, { error: "Brak uprawnień." }, 401);
          return;
        }
        throw e;
      }

      if (req.method === "GET" && op === "admin-rooms-list") {
        const snap = await db.collection("hotelRooms").orderBy("sortOrder", "asc").get().catch(async () => {
          return db.collection("hotelRooms").get();
        });
        const rooms = [];
        snap.forEach((d) => rooms.push({ id: d.id, ...d.data() }));
        rooms.sort((a, b) => (a.sortOrder || 0) - (b.sortOrder || 0));
        json(res, { rooms });
        return;
      }

      if (req.method === "PUT" && op === "admin-room-upsert") {
        const body = typeof req.body === "object" && req.body ? req.body : JSON.parse(req.body || "{}");
        const { id, ...fields } = body;
        if (!id) {
          json(res, { error: "Brak id pokoju." }, 400);
          return;
        }
        const ref = db.collection("hotelRooms").doc(id);
        await ref.set(
          {
            ...fields,
            updatedAt: FieldValue.serverTimestamp(),
            updatedBy: adminUser.email,
          },
          { merge: true }
        );
        await appendAudit(db, { action: "room_upsert", actorEmail: adminUser.email, details: { id } });
        json(res, { ok: true });
        return;
      }

      if (req.method === "GET" && op === "admin-reservations-list") {
        const status = url.searchParams.get("status") || "all";
        let query = db.collection("hotelReservations").orderBy("createdAt", "desc").limit(200);
        if (status && status !== "all") {
          query = db.collection("hotelReservations").where("status", "==", status).orderBy("createdAt", "desc").limit(200);
        }
        const snap = await query.get().catch(async () => {
          const s = await db.collection("hotelReservations").limit(200).get();
          return s;
        });
        const rows = [];
        for (const d of snap.docs) {
          const x = { id: d.id, ...d.data() };
          const itemsQ = await db.collection("hotelReservationItems").where("reservationId", "==", d.id).get();
          const items = [];
          itemsQ.forEach((iq) => items.push(iq.data()));
          rows.push(formatReservationRow(x, items));
        }
        rows.sort((a, b) => (b.createdAtMs || 0) - (a.createdAtMs || 0));
        json(res, { reservations: rows });
        return;
      }

      if (req.method === "GET" && op === "admin-reservation-get") {
        const id = url.searchParams.get("id");
        if (!id) {
          json(res, { error: "Brak id." }, 400);
          return;
        }
        const r = await getReservation(db, id);
        if (!r) {
          json(res, { error: "Nie znaleziono." }, 404);
          return;
        }
        const itemsQ = await db.collection("hotelReservationItems").where("reservationId", "==", id).get();
        const items = [];
        itemsQ.forEach((iq) => items.push({ id: iq.id, ...iq.data() }));
        json(res, { reservation: formatReservationRow(r, items), items });
        return;
      }

      if (req.method === "PATCH" && op === "admin-reservation-update") {
        const body = typeof req.body === "object" && req.body ? req.body : JSON.parse(req.body || "{}");
        const { id, adminNote, customerName, customerNote, dateFrom, dateTo, roomIds } = body;
        if (!id) {
          json(res, { error: "Brak id." }, 400);
          return;
        }
        const ref = db.collection("hotelReservations").doc(id);
        const before = await getReservation(db, id);
        if (!before) {
          json(res, { error: "Nie znaleziono." }, 404);
          return;
        }

        if (roomIds || dateFrom || dateTo) {
          const df = dateFrom || before.dateFrom;
          const dt = dateTo || before.dateTo;
          const rids = roomIds || (await itemsRoomIds(db, id));
          assertDatesValid(df, dt);
          const nights = enumerateNights(df, dt);
          const avail = await checkNightsAvailable(db, rids, nights, id);
          if (!avail.ok) {
            json(res, { error: "Konflikt terminów z inną rezerwacją." }, 409);
            return;
          }
          const roomsMap = await loadRoomsMap();
          const { items: newItems, total } = computeLineItems(roomsMap, rids, df, dt);
          await db.runTransaction(async (tx) => {
            const snap = await tx.get(ref);
            const cur = snap.data();
            const nk = await swapNightsInTransaction(tx, db, {
              reservationId: id,
              oldNightKeys: cur.nightKeys || [],
              roomIds: rids,
              nights,
              statusForLocks: cur.status === "confirmed" ? "confirmed" : "pending",
            });
            tx.update(ref, {
              dateFrom: df,
              dateTo: dt,
              nightKeys: nk,
              totalPrice: total,
              adminNote: adminNote !== undefined ? String(adminNote) : before.adminNote,
              customerName: customerName !== undefined ? String(customerName) : before.customerName,
              customerNote: customerNote !== undefined ? String(customerNote) : before.customerNote,
              updatedAt: FieldValue.serverTimestamp(),
              updatedBy: adminUser.email,
            });
          });
          await deleteReservationItems(db, id);
          await saveReservationItems(db, id, newItems);
        } else {
          await ref.update({
            adminNote: adminNote !== undefined ? String(adminNote) : before.adminNote,
            customerName: customerName !== undefined ? String(customerName) : before.customerName,
            customerNote: customerNote !== undefined ? String(customerNote) : before.customerNote,
            updatedAt: FieldValue.serverTimestamp(),
            updatedBy: adminUser.email,
          });
        }

        await appendAudit(db, {
          action: "reservation_update",
          reservationId: id,
          actorEmail: adminUser.email,
        });
        json(res, { ok: true });
        return;
      }

      if (req.method === "POST" && op === "admin-reservation-create") {
        const body = typeof req.body === "object" && req.body ? req.body : JSON.parse(req.body || "{}");
        const {
          dateFrom,
          dateTo,
          roomIds,
          fullName,
          email,
          phonePrefix,
          phoneNational,
          customerNote,
          status: targetStatus,
          adminNote,
        } = body;
        assertDatesValid(dateFrom, dateTo);
        const phoneE164 = validatePhone(phonePrefix, phoneNational);
        if (!phoneE164) {
          json(res, { error: "Telefon nieprawidłowy." }, 400);
          return;
        }
        const roomsMap = await loadRoomsMap();
        const { items, total } = computeLineItems(roomsMap, roomIds, dateFrom, dateTo);
        const nights = enumerateNights(dateFrom, dateTo);
        const avail = await checkNightsAvailable(db, roomIds, nights, null);
        if (!avail.ok) {
          json(res, { error: "Termin zajęty." }, 409);
          return;
        }
        const humanNumber = await allocateReservationNumber(db);
        const resRef = db.collection("hotelReservations").doc();
        const st = targetStatus === "confirmed" ? "confirmed" : "pending";
        const pendingUntil = Timestamp.fromMillis(Date.now() + HOTEL_PENDING_MS);

        await db.runTransaction(async (tx) => {
          tx.set(resRef, {
            humanNumber,
            status: st,
            customerName: String(fullName || "").trim(),
            email: String(email || "").trim().toLowerCase(),
            phonePrefix: String(phonePrefix || "").trim(),
            phoneNational: String(phoneNational || "").replace(/[^\d]/g, ""),
            phoneE164,
            customerNote: String(customerNote || "").trim(),
            adminNote: String(adminNote || "").trim(),
            dateFrom,
            dateTo,
            totalPrice: total,
            confirmationTokenHash: null,
            emailVerificationExpiresAt: null,
            pendingExpiresAt: st === "pending" ? pendingUntil : null,
            nightKeys: [],
            createdAt: FieldValue.serverTimestamp(),
            updatedAt: FieldValue.serverTimestamp(),
            source: "admin_manual",
            createdBy: adminUser.email,
          });
        });

        try {
          await saveReservationItems(db, resRef.id, items);
          await db.runTransaction(async (tx) => {
            const s = await tx.get(resRef);
            if (!s.exists) {
              throw new Error("Brak dokumentu rezerwacji.");
            }
            const nk = await claimNightsInTransactionAsync(tx, db, {
              reservationId: resRef.id,
              roomIds,
              nights,
              statusForLocks: st === "confirmed" ? "confirmed" : "pending",
            });
            tx.update(resRef, { nightKeys: nk, updatedAt: FieldValue.serverTimestamp() });
          });
        } catch (err) {
          await deleteReservationItems(db, resRef.id);
          await resRef.delete().catch(() => {});
          throw err;
        }

        const r0 = await getReservation(db, resRef.id);
        const vars = buildMailVars({ ...r0, id: resRef.id }, items, {});
        if (st === "pending") {
          await sendTemplated(db, "pending_client", vars.email, vars);
        } else {
          await sendTemplated(db, "confirmed_client", vars.email, vars);
        }
        await appendAudit(db, {
          action: "reservation_manual_create",
          reservationId: resRef.id,
          actorEmail: adminUser.email,
        });
        json(res, { ok: true, reservationId: resRef.id, humanNumber });
        return;
      }

      if (req.method === "POST" && op === "admin-reservation-confirm") {
        const body = typeof req.body === "object" && req.body ? req.body : JSON.parse(req.body || "{}");
        const { id } = body;
        const ref = db.collection("hotelReservations").doc(id);
        const before = await getReservation(db, id);
        if (!before || before.status !== "pending") {
          json(res, { error: "Tylko status „oczekujące” można potwierdzić." }, 400);
          return;
        }

        await db.runTransaction(async (tx) => {
          const snap = await tx.get(ref);
          const cur = snap.data();
          const nk = cur.nightKeys || [];
          for (const key of nk) {
            const rref = db.collection("hotelRoomNights").doc(key);
            await tx.get(rref);
            tx.update(rref, { lockStatus: "confirmed", updatedAt: FieldValue.serverTimestamp() });
          }
          tx.update(ref, {
            status: "confirmed",
            pendingExpiresAt: FieldValue.delete(),
            updatedAt: FieldValue.serverTimestamp(),
            updatedBy: adminUser.email,
          });
        });

        const itemsQ = await db.collection("hotelReservationItems").where("reservationId", "==", id).get();
        const items = [];
        itemsQ.forEach((d) => items.push(d.data()));
        const vars = buildMailVars({ ...before, id, status: "confirmed" }, items, {});
        await sendTemplated(db, "confirmed_client", vars.email, vars);

        await appendAudit(db, {
          action: "reservation_confirmed",
          reservationId: id,
          actorEmail: adminUser.email,
        });
        json(res, { ok: true });
        return;
      }

      if (req.method === "POST" && op === "admin-reservation-cancel") {
        const body = typeof req.body === "object" && req.body ? req.body : JSON.parse(req.body || "{}");
        const { id } = body;
        const before = await getReservation(db, id);
        if (!before) {
          json(res, { error: "Nie znaleziono." }, 404);
          return;
        }
        await releaseNightsForReservation(db, id);
        await db.collection("hotelReservations").doc(id).update({
          status: "cancelled",
          pendingExpiresAt: FieldValue.delete(),
          emailVerificationExpiresAt: FieldValue.delete(),
          updatedAt: FieldValue.serverTimestamp(),
          updatedBy: adminUser.email,
        });

        const itemsQ = await db.collection("hotelReservationItems").where("reservationId", "==", id).get();
        const items = [];
        itemsQ.forEach((d) => items.push(d.data()));
        const vars = buildMailVars({ ...before, id, status: "cancelled" }, items, {});
        if (before.email) {
          await sendTemplated(db, "cancelled_client", vars.email, vars);
        }
        const adm = adminNotifyEmail();
        if (adm) {
          await sendTemplated(db, "cancelled_admin", adm, vars);
        }

        await appendAudit(db, {
          action: "reservation_cancelled",
          reservationId: id,
          actorEmail: adminUser.email,
        });
        json(res, { ok: true });
        return;
      }

      if (req.method === "POST" && op === "admin-manual-block") {
        const body = typeof req.body === "object" && req.body ? req.body : JSON.parse(req.body || "{}");
        const { dateFrom, dateTo, roomIds, note } = body;
        assertDatesValid(dateFrom, dateTo);
        const nights = enumerateNights(dateFrom, dateTo);
        const avail = await checkNightsAvailable(db, roomIds, nights, null);
        if (!avail.ok) {
          json(res, { error: "Część terminów jest już zajęta." }, 409);
          return;
        }
        const humanNumber = await allocateReservationNumber(db);
        const resRef = db.collection("hotelReservations").doc();
        await db.runTransaction(async (tx) => {
          tx.set(resRef, {
            humanNumber,
            status: "manual_block",
            customerName: "Blokada terminu",
            email: "",
            phonePrefix: "",
            phoneNational: "",
            phoneE164: "",
            customerNote: "",
            adminNote: String(note || "").slice(0, 2000),
            dateFrom,
            dateTo,
            totalPrice: 0,
            nightKeys: [],
            createdAt: FieldValue.serverTimestamp(),
            updatedAt: FieldValue.serverTimestamp(),
            source: "admin_block",
            createdBy: adminUser.email,
          });
        });
        try {
          await db.runTransaction(async (tx) => {
            const s = await tx.get(resRef);
            if (!s.exists) {
              throw new Error("Brak dokumentu blokady.");
            }
            const nk = await claimNightsInTransactionAsync(tx, db, {
              reservationId: resRef.id,
              roomIds,
              nights,
              statusForLocks: "manual_block",
            });
            tx.update(resRef, { nightKeys: nk, updatedAt: FieldValue.serverTimestamp() });
          });
        } catch (err) {
          await resRef.delete().catch(() => {});
          throw err;
        }
        await appendAudit(db, {
          action: "manual_block",
          reservationId: resRef.id,
          actorEmail: adminUser.email,
        });
        json(res, { ok: true, reservationId: resRef.id });
        return;
      }

      if (req.method === "GET" && op === "admin-mail-templates") {
        const keys = Object.keys(require("./lib/mail").DEFAULT_TEMPLATES);
        const out = {};
        for (const k of keys) {
          out[k] = await getMailTemplate(db, k);
        }
        json(res, { templates: out });
        return;
      }

      if (req.method === "PUT" && op === "admin-mail-template-save") {
        const body = typeof req.body === "object" && req.body ? req.body : JSON.parse(req.body || "{}");
        const { key, subject, bodyHtml } = body;
        if (!key) {
          json(res, { error: "Brak klucza." }, 400);
          return;
        }
        await db.collection("hotelMailTemplates").doc(key).set(
          {
            subject: String(subject || ""),
            bodyHtml: String(bodyHtml || ""),
            updatedAt: FieldValue.serverTimestamp(),
            updatedBy: adminUser.email,
          },
          { merge: true }
        );
        await appendAudit(db, { action: "mail_template_save", actorEmail: adminUser.email, details: { key } });
        json(res, { ok: true });
        return;
      }

      json(res, { error: "Nieznana operacja. Użyj parametru ?op=..." }, 404);
    } catch (err) {
      console.error(err);
      const msg = err.message && String(err.message).includes("CONFLICT")
        ? err.message.replace(/^CONFLICT:\s*/, "")
        : err.message || "Błąd serwera.";
      const code = msg.includes("CONFLICT") || err.message?.includes("CONFLICT") ? 409 : 500;
      json(res, { error: msg }, code);
    }
  }
);

function formatReservationRow(x, items) {
  const createdAt = x.createdAt?.toMillis?.() || 0;
  const pendingExp = x.pendingExpiresAt?.toMillis?.() || null;
  const emailExp = x.emailVerificationExpiresAt?.toMillis?.() || null;
  const statusUi = {
    email_verification_pending: "E-mail do potwierdzenia",
    pending: "Oczekujące",
    confirmed: "Zarezerwowane",
    cancelled: "Anulowane",
    expired: "Wygasłe",
    manual_block: "Blokada terminu",
  };
  return {
    id: x.id,
    humanNumber: x.humanNumber,
    customerName: x.customerName,
    email: x.email,
    phone: `${x.phonePrefix || ""} ${x.phoneNational || ""}`.trim() || x.phoneE164,
    status: x.status,
    statusLabel: statusUi[x.status] || x.status,
    dateFrom: x.dateFrom,
    dateTo: x.dateTo,
    nights: nightsCount(x.dateFrom, x.dateTo),
    totalPrice: x.totalPrice,
    customerNote: x.customerNote,
    adminNote: x.adminNote,
    items,
    pendingExpiresAt: pendingExp,
    emailVerificationExpiresAt: emailExp,
    createdAtMs: createdAt,
    roomLabels: items.map((i) => i.roomNameSnapshot).join(", "),
  };
}

async function itemsRoomIds(db, reservationId) {
  const q = await db.collection("hotelReservationItems").where("reservationId", "==", reservationId).get();
  const ids = [];
  q.forEach((d) => ids.push(d.data().roomId));
  return [...new Set(ids)];
}

/** Cron: wygaśnięcie linku e-mail (2h) oraz oczekiwania na admina (3 dni) */
exports.hotelExpireCron = onSchedule(
  {
    schedule: "every 15 minutes",
    region: "europe-west1",
    timeZone: "Europe/Warsaw",
  },
  async () => {
    const now = Timestamp.now();

    const expEmail = await db
      .collection("hotelReservations")
      .where("status", "==", "email_verification_pending")
      .where("emailVerificationExpiresAt", "<", now)
      .limit(50)
      .get()
      .catch(() => ({ empty: true, docs: [] }));

    if (expEmail && !expEmail.empty) {
      for (const d of expEmail.docs) {
        const data = d.data();
        await db.collection("hotelReservations").doc(d.id).update({
          status: "expired",
          updatedAt: FieldValue.serverTimestamp(),
        });
        await deleteReservationItems(db, d.id);
        const items = [];
        const vars = buildMailVars({ ...data, id: d.id }, items, {});
        if (data.email) {
          await sendTemplated(db, "expired_email_client", data.email, vars);
        }
        await appendAudit(db, {
          action: "expired_email_verification",
          reservationId: d.id,
          details: {},
        });
      }
    }

    const expPending = await db
      .collection("hotelReservations")
      .where("status", "==", "pending")
      .where("pendingExpiresAt", "<", now)
      .limit(50)
      .get()
      .catch(() => ({ empty: true, docs: [] }));

    if (expPending && !expPending.empty) {
      for (const d of expPending.docs) {
        const data = d.data();
        await releaseNightsForReservation(db, d.id);
        await db.collection("hotelReservations").doc(d.id).update({
          status: "expired",
          pendingExpiresAt: FieldValue.delete(),
          updatedAt: FieldValue.serverTimestamp(),
        });
        const iq = await db.collection("hotelReservationItems").where("reservationId", "==", d.id).get();
        const items = [];
        iq.forEach((x) => items.push(x.data()));
        const vars = buildMailVars({ ...data, id: d.id }, items, {});
        if (data.email) {
          await sendTemplated(db, "expired_pending_client", data.email, vars);
        }
        const adm = adminNotifyEmail();
        if (adm) {
          await sendTemplated(db, "expired_pending_admin", adm, vars);
        }
        await appendAudit(db, {
          action: "expired_pending_admin_timeout",
          reservationId: d.id,
          details: {},
        });
      }
    }

    return null;
  }
);

/* --- Restauracja: eksport API (osobny plik) --- */
const { restaurantApi } = require("./restaurantApi");
exports.restaurantApi = restaurantApi;

const { restaurantExpireCron } = require("./restaurantCron");
exports.restaurantExpireCron = restaurantExpireCron;

const { hallApi } = require("./hallApi");
exports.hallApi = hallApi;

const { hallExpireCron } = require("./hallCron");
exports.hallExpireCron = hallExpireCron;
