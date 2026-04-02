/**
 * Cloud Functions — moduł sal (HTTPS hallApi ?op=...).
 */
const { onRequest } = require("firebase-functions/v2/https");
const { initializeApp, getApps } = require("firebase-admin/app");
const { getFirestore, FieldValue, Timestamp } = require("firebase-admin/firestore");
const { parsePhoneNumberFromString } = require("libphonenumber-js");

const { checkRateLimit } = require("./lib/rateLimit");
const { checkSpamBlock, setSpamBlock } = require("./lib/bookingSpamBlock");
const {
  SESSION_MS,
  EMAIL_LINK_MS,
  HALL_PENDING_MS,
  HALL_EXTEND_THRESHOLD_MS,
} = require("./lib/bookingConstants");
const {
  checkHallAvailability,
  allocateHallReservationNumber,
  dtFromDateAndTime,
  WARSAW,
  assertNotPastCalendarDateWarsaw,
} = require("./lib/hallLogic");
const { formatHumanReservationNumber } = require("./lib/humanNumber");
const {
  renderTemplate,
  getHallMailTemplate,
  sendMail,
  HALL_DEFAULT_TEMPLATES,
  buildBrandedEmail,
} = require("./lib/mail");
const {
  json,
  verifyAdminAuth,
  hashToken,
  randomToken,
  verifyTurnstile,
} = require("./lib/apiHelpers");

if (!getApps().length) {
  initializeApp();
}

const db = getFirestore();
const FIXED_HALL_OPEN_TIME = "00:00";
const FIXED_HALL_CLOSE_TIME = "00:00";

function venueName() {
  return process.env.VENUE_NAME || process.env.HOTEL_NAME || "Średzka Korona";
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

async function appendVenueAudit(db, { action, reservationId, actorEmail, details }) {
  await db.collection("venueAuditLog").add({
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

async function ensureVenueSettings(db) {
  const ref = db.collection("venueSettings").doc("default");
  const s = await ref.get();
  if (!s.exists) {
    await ref.set({
      hallOpenTime: FIXED_HALL_OPEN_TIME,
      hallCloseTime: FIXED_HALL_CLOSE_TIME,
      nextHallHumanNumber: 3000,
      updatedAt: FieldValue.serverTimestamp(),
    });
  }
}

async function ensureHallDefaults(db) {
  await ensureVenueSettings(db);
  const smallRef = db.collection("venueHalls").doc("hall-small");
  const largeRef = db.collection("venueHalls").doc("hall-large");
  const [s1, s2] = await Promise.all([smallRef.get(), largeRef.get()]);
  if (!s1.exists) {
    await smallRef.set({
      name: "Sala mała",
      capacity: 40,
      active: true,
      hallKind: "small",
      description: "Sala kameralna — wyłączność.",
      exclusiveRule: "always",
      bufferMinutes: 60,
      fullBlockGuestThreshold: 100,
      sortOrder: 1,
      updatedAt: FieldValue.serverTimestamp(),
    });
  }
  if (!s2.exists) {
    await largeRef.set({
      name: "Sala duża",
      capacity: 120,
      active: true,
      hallKind: "large",
      description: "Sala duża — możliwość współdzielenia do limitu miejsc.",
      exclusiveRule: "optional",
      bufferMinutes: 60,
      fullBlockGuestThreshold: 100,
      sortOrder: 2,
      updatedAt: FieldValue.serverTimestamp(),
    });
  }
}

function assertEventWithinHallHours(settings, reservationDate, startTime, durationHours) {
  const openT = FIXED_HALL_OPEN_TIME;
  const closeT = FIXED_HALL_CLOSE_TIME;
  const start = dtFromDateAndTime(reservationDate, startTime);
  if (!start) return { ok: false, error: "Nieprawidłowa data lub godzina." };
  const end = start.plus({ hours: Number(durationHours) || 0 });
  if (end.day !== start.day || end.month !== start.month || end.year !== start.year) {
    return { ok: false, error: "Rezerwacja musi zakończyć się tego samego dnia." };
  }
  const [oh, om] = openT.split(":").map((x) => parseInt(x, 10));
  const [ch, cm] = closeT.split(":").map((x) => parseInt(x, 10));
  const openM = oh * 60 + (om || 0);
  let closeM = ch * 60 + (cm || 0);
  if (closeM <= openM) {
    closeM += 24 * 60;
  }
  const sm = start.hour * 60 + start.minute;
  const em = end.hour * 60 + end.minute;
  if (sm < openM || em > closeM) {
    return { ok: false, error: `Rezerwacje tylko w godzinach ${openT}–${closeT}.` };
  }
  return { ok: true };
}

function buildHallMailVars(res, hall, extra = {}) {
  const start = res.startDateTime?.toDate?.() || new Date(res.startMs || 0);
  const end = res.endDateTime?.toDate?.() || new Date(res.endMs || 0);
  const thr = Number(hall?.fullBlockGuestThreshold) || 100;
  const fullBlock =
    Boolean(res.exclusive) || Number(res.guestsCount || 0) >= thr;
  return {
    reservationId: res.id,
    reservationNumber: formatHumanReservationNumber(res, "hall") || String(res.id),
    fullName: res.fullName || "",
    email: res.email || "",
    phone: `${res.phonePrefix || ""} ${res.phoneNational || ""}`.trim() || res.phoneE164 || "",
    hallName: res.hallNameSnapshot || hall?.name || "",
    date: res.reservationDate || "",
    timeFrom: res.startTimeLabel || start.toLocaleTimeString("pl-PL", { hour: "2-digit", minute: "2-digit", timeZone: WARSAW }),
    timeTo: res.endTimeLabel || end.toLocaleTimeString("pl-PL", { hour: "2-digit", minute: "2-digit", timeZone: WARSAW }),
    durationHours: res.durationUnspecified
      ? "nie określono"
      : `${Number(res.durationHours ?? 0)} h`,
    guestsCount: String(res.guestsCount ?? ""),
    eventType: res.eventType || "",
    exclusive: res.exclusive ? "tak" : "nie",
    fullBlockLabel: fullBlock ? "tak (pełna blokada sali)" : "nie",
    customerNote: res.customerNote || "",
    adminNote: res.adminNote || "",
    confirmationLink: extra.confirmationLink || "",
    venueName: venueName(),
    expiresAt: extra.expiresAt || "",
    ...extra,
  };
}

async function sendHallTemplated(db, key, to, vars) {
  const t = await getHallMailTemplate(db, key);
  const subject = renderTemplate(t.subject, vars);
  const htmlFragment = renderTemplate(t.bodyHtml, vars);
  const email = buildBrandedEmail({
    subject,
    htmlFragment,
    brandName: venueName(),
    serviceLabel: "Przyjęcia i sale",
    siteUrl: publicSiteUrl(),
    serviceUrl: `${publicSiteUrl()}/Przyjec/`,
    preheader: `Zgłoszenie ${vars.reservationNumber || ""}`.trim(),
    actionUrl: key === "hall_confirm_email" ? vars.confirmationLink || "" : "",
    actionLabel: "Potwierdź zgłoszenie",
  });
  await sendMail(key, { to, subject, html: email.html });
}

function formatHallRow(x, hallMap = {}) {
  const hall = hallMap[x.hallId] || {};
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
  const thr = Number(hall.fullBlockGuestThreshold || x.fullBlockGuestThresholdSnap || 100);
  const fullBlock = Boolean(x.exclusive) || Number(x.guestsCount || 0) >= thr;
  const sharedLarge =
    (hall.hallKind || x.hallKindSnapshot) === "large" && !fullBlock;
  let extendAvailable = false;
  if (x.status === "pending" && pendingExp) {
    const left = pendingExp - Date.now();
    extendAvailable = left <= HALL_EXTEND_THRESHOLD_MS && left > 0;
  }
  return {
    id: x.id,
    humanNumber: x.humanNumber,
    humanNumberLabel: formatHumanReservationNumber(x, "hall") || x.humanNumber || x.id,
    hallId: x.hallId,
    hallName: x.hallNameSnapshot || hall.name || x.hallId,
    hallKindSnapshot: x.hallKindSnapshot,
    fullName: x.fullName,
    email: x.email,
    phone: `${x.phonePrefix || ""} ${x.phoneNational || ""}`.trim() || x.phoneE164,
    status: x.status,
    statusLabel: statusUi[x.status] || x.status,
    reservationDate: x.reservationDate,
    startTime: x.startTime,
    durationHours: x.durationHours,
    durationUnspecified: Boolean(x.durationUnspecified),
    startDateTime: x.startDateTime?.toMillis?.() || x.startMs,
    endDateTime: x.endDateTime?.toMillis?.() || x.endMs,
    guestsCount: x.guestsCount,
    exclusive: Boolean(x.exclusive),
    fullBlock,
    sharedLarge,
    eventType: x.eventType || "",
    customerNote: x.customerNote || "",
    adminNote: x.adminNote || "",
    pendingExpiresAt: pendingExp,
    emailVerificationExpiresAt: emailExp,
    extendAvailable,
    createdAtMs: createdAt,
    blockStartMs: x.blockStartMs,
    blockEndMs: x.blockEndMs,
  };
}

const hallApi = onRequest(
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
        json(res, { ok: true, service: "hallApi" });
        return;
      }

      if (req.method === "GET" && op === "public-halls") {
        await ensureHallDefaults(db);
        const snap = await db.collection("venueHalls").orderBy("sortOrder", "asc").get().catch(async () => {
          return db.collection("venueHalls").get();
        });
        const halls = [];
        snap.forEach((d) => {
          const h = d.data();
          if (h.active === false) return;
          halls.push({
            id: d.id,
            name: h.name,
            capacity: h.capacity,
            hallKind: h.hallKind,
            description: h.description || "",
            bufferMinutes: h.bufferMinutes ?? 60,
            fullBlockGuestThreshold: h.fullBlockGuestThreshold ?? 100,
            sortOrder: h.sortOrder || 0,
          });
        });
        halls.sort((a, b) => a.sortOrder - b.sortOrder);
        json(res, { halls });
        return;
      }

      if (req.method === "POST" && op === "public-availability") {
        await ensureHallDefaults(db);
        const body = typeof req.body === "object" && req.body ? req.body : JSON.parse(req.body || "{}");
        const { hallId, reservationDate, startTime, durationHours, guestsCount, exclusive } = body;
        if (!hallId || !reservationDate || !startTime) {
          json(res, { error: "Brak parametrów sali lub terminu." }, 400);
          return;
        }
        const pastCal = assertNotPastCalendarDateWarsaw(reservationDate);
        if (!pastCal.ok) {
          json(res, { ok: false, available: false, error: pastCal.error, maxGuests: 0 });
          return;
        }
        const hallSnap = await db.collection("venueHalls").doc(hallId).get();
        if (!hallSnap.exists || hallSnap.data().active === false) {
          json(res, { error: "Sala niedostępna." }, 400);
          return;
        }
        const settings = (await db.collection("venueSettings").doc("default").get()).data() || {};
        const hv = assertEventWithinHallHours(settings, reservationDate, startTime, durationHours);
        if (!hv.ok) {
          json(res, { ok: false, available: false, error: hv.error, maxGuests: 0 });
          return;
        }
        const hall = { id: hallSnap.id, ...hallSnap.data() };
        const chk = await checkHallAvailability(db, hall, {
          reservationDate,
          startTime,
          durationHours,
          guestsCount: Number(guestsCount) || 1,
          exclusive: hall.hallKind === "small" ? true : Boolean(exclusive),
        });
        if (!chk.ok) {
          json(res, {
            ok: false,
            available: false,
            error: chk.error,
            maxGuests: chk.maxGuests ?? 0,
          });
          return;
        }
        json(res, {
          ok: true,
          available: true,
          maxGuests: chk.maxGuests ?? hall.capacity,
        });
        return;
      }

      if (req.method === "POST" && op === "public-reservation-draft") {
        const body = typeof req.body === "object" && req.body ? req.body : JSON.parse(req.body || "{}");
        if (body.hpCompanyWebsite) {
          json(res, { ok: true });
          return;
        }

        const ip = req.headers["x-forwarded-for"]?.split(",")[0]?.trim() || req.ip || "unknown";
        const emailKey = String(body.email || "").toLowerCase().trim();
        const spam = await checkSpamBlock(db, "hall", ip, emailKey);
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

        const okRlIp = await checkRateLimit(db, `hall:ip:${ip}:draft`);
        const okRlEm = !emailKey || (await checkRateLimit(db, `hall:em:${emailKey}:draft`));
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

        if (!body.termsAccepted) {
          json(res, { error: "Wymagana akceptacja regulaminu i oświadczeń." }, 400);
          return;
        }

        await ensureHallDefaults(db);
        await ensureVenueSettings(db);
        const settings = (await db.collection("venueSettings").doc("default").get()).data() || {};

        const {
          hallId,
          reservationDate,
          startTime,
          durationHours,
          durationUnspecified,
          guestsCount,
          exclusive,
          eventType,
          customerNote,
          fullName,
          email,
          phonePrefix,
          phoneNational,
        } = body;

        if (!hallId || !reservationDate || !startTime) {
          json(res, { error: "Wybór sali i terminu jest wymagany." }, 400);
          return;
        }

        const pastCalDraft = assertNotPastCalendarDateWarsaw(reservationDate);
        if (!pastCalDraft.ok) {
          json(res, { error: pastCalDraft.error }, 400);
          return;
        }

        const hallSnap = await db.collection("venueHalls").doc(hallId).get();
        if (!hallSnap.exists || hallSnap.data().active === false) {
          json(res, { error: "Sala niedostępna." }, 400);
          return;
        }
        const hall = { id: hallSnap.id, ...hallSnap.data() };
        const gc = Number(guestsCount || 0);
        const excl = hall.hallKind === "small" ? true : Boolean(exclusive);

        const hv = assertEventWithinHallHours(settings, reservationDate, startTime, durationHours);
        if (!hv.ok) {
          json(res, { error: hv.error }, 400);
          return;
        }

        const chk = await checkHallAvailability(db, hall, {
          reservationDate,
          startTime,
          durationHours,
          guestsCount: gc,
          exclusive: excl,
        });
        if (!chk.ok) {
          json(res, { error: chk.error || "Termin niedostępny." }, 409);
          return;
        }

        const phoneE164 = validatePhone(phonePrefix, phoneNational);
        if (!phoneE164) {
          json(res, { error: "Nieprawidłowy numer telefonu z prefiksem międzynarodowym." }, 400);
          return;
        }
        if (!fullName || !email || !String(email).includes("@")) {
          json(res, { error: "Wypełnij imię i nazwisko oraz poprawny e-mail." }, 400);
          return;
        }
        if (!String(eventType || "").trim()) {
          json(res, { error: "Podaj rodzaj imprezy." }, 400);
          return;
        }

        const humanNumber = await allocateHallReservationNumber(db);
        const token = randomToken();
        const tokenHash = hashToken(token);
        const now = Date.now();
        const resRef = db.collection("venueReservations").doc();
        const confirmationLink = `${publicSiteUrl()}/Przyjec/potwierdzenie.html?token=${encodeURIComponent(token)}`;

        const dur = Number(durationHours);
        const durationUnspecifiedFlag = Boolean(durationUnspecified);

        await db.runTransaction(async (tx) => {
          tx.set(resRef, {
            humanNumber,
            status: "email_verification_pending",
            hallId: hall.id,
            hallNameSnapshot: hall.name,
            hallKindSnapshot: hall.hallKind,
            fullBlockGuestThresholdSnap: hall.fullBlockGuestThreshold ?? 100,
            fullName: String(fullName).trim(),
            email: String(email).trim().toLowerCase(),
            phonePrefix: String(phonePrefix || "").trim(),
            phoneNational: String(phoneNational || "").replace(/[^\d]/g, ""),
            phoneE164,
            guestsCount: gc,
            exclusive: excl,
            eventType: String(eventType || "").trim().slice(0, 500),
            customerNote: String(customerNote || "").trim().slice(0, 2000),
            adminNote: "",
            reservationDate: String(reservationDate).trim(),
            startTime: String(startTime).trim(),
            durationHours: dur,
            durationUnspecified: durationUnspecifiedFlag,
            startTimeLabel: chk.startTimeLabel,
            endTimeLabel: chk.endTimeLabel,
            startDateTime: Timestamp.fromMillis(chk.startMs),
            endDateTime: Timestamp.fromMillis(chk.endMs),
            startMs: chk.startMs,
            endMs: chk.endMs,
            bufferMinutes: hall.bufferMinutes ?? 60,
            confirmationTokenHash: tokenHash,
            emailVerificationExpiresAt: Timestamp.fromMillis(now + EMAIL_LINK_MS),
            pendingExpiresAt: null,
            blockStartMs: null,
            blockEndMs: null,
            createdAt: FieldValue.serverTimestamp(),
            updatedAt: FieldValue.serverTimestamp(),
            source: "web",
          });
        });

        const vars = buildHallMailVars(
          {
            id: resRef.id,
            humanNumber,
            fullName,
            email,
            phonePrefix,
            phoneNational,
            reservationDate,
            startTime,
            durationHours: dur,
            durationUnspecified: durationUnspecifiedFlag,
            guestsCount: gc,
            exclusive: excl,
            eventType,
            customerNote,
            startDateTime: Timestamp.fromMillis(chk.startMs),
            endDateTime: Timestamp.fromMillis(chk.endMs),
            startTimeLabel: chk.startTimeLabel,
            endTimeLabel: chk.endTimeLabel,
          },
          hall,
          { confirmationLink }
        );
        await sendHallTemplated(db, "hall_confirm_email", vars.email, vars);
        await setSpamBlock(db, "hall", ip, emailKey);

        await appendVenueAudit(db, {
          action: "hall_draft_created",
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
        const q = await db.collection("venueReservations").where("confirmationTokenHash", "==", th).limit(1).get();
        if (q.empty) {
          json(res, { error: "Nieprawidłowy lub wygasły link." }, 400);
          return;
        }
        const doc = q.docs[0];
        const resData = doc.data();
        const reservationId = doc.id;

        if (resData.status === "pending" || resData.status === "confirmed") {
          json(res, {
            ok: true,
            status: resData.status,
            reservationId,
            humanNumber: formatHumanReservationNumber(resData, "hall") || resData.humanNumber,
          });
          return;
        }
        if (resData.status !== "email_verification_pending") {
          json(
            res,
            { error: resData.status === "expired" ? "Link wygasł (minęło 2 godziny). Złóż zgłoszenie ponownie." : "Ta rezerwacja została już przetworzona." },
            400
          );
          return;
        }
        const exp = resData.emailVerificationExpiresAt?.toMillis?.() || 0;
        if (exp && Date.now() > exp) {
          json(res, { error: "Link wygasł (minęło 2 godziny). Złóż zgłoszenie ponownie." }, 400);
          return;
        }

        const hallSnap = await db.collection("venueHalls").doc(resData.hallId).get();
        if (!hallSnap.exists) {
          json(res, { error: "Sala nie istnieje." }, 400);
          return;
        }
        const hall = { id: hallSnap.id, ...hallSnap.data() };

        const chk = await checkHallAvailability(db, hall, {
          reservationDate: resData.reservationDate,
          startTime: resData.startTime,
          durationHours: resData.durationHours,
          guestsCount: resData.guestsCount,
          exclusive: resData.exclusive,
        });
        if (!chk.ok) {
          json(res, { error: chk.error || "Termin przestał być dostępny." }, 409);
          return;
        }

        try {
          await db.runTransaction(async (tx) => {
            const snap = await tx.get(doc.ref);
            const cur = snap.data();
            if (cur.status !== "email_verification_pending") {
              throw new Error("STATUS_CHANGED");
            }
            const pendingUntil = Timestamp.fromMillis(Date.now() + HALL_PENDING_MS);
            tx.update(doc.ref, {
              status: "pending",
              blockStartMs: chk.startMs,
              blockEndMs: chk.blockEndMs,
              emailVerificationExpiresAt: FieldValue.delete(),
              pendingExpiresAt: pendingUntil,
              updatedAt: FieldValue.serverTimestamp(),
            });
          });
        } catch (e) {
          if (e.message === "STATUS_CHANGED") {
            const latest = await db.collection("venueReservations").doc(reservationId).get();
            if (latest.exists) {
              const latestData = latest.data();
              if (latestData && (latestData.status === "pending" || latestData.status === "confirmed")) {
                json(res, {
                  ok: true,
                  status: latestData.status,
                  reservationId,
                  humanNumber: formatHumanReservationNumber(latestData, "hall") || latestData.humanNumber,
                });
                return;
              }
            }
            json(res, { error: "Ta rezerwacja została już przetworzona." }, 400);
            return;
          }
          if (e.message === "CONFLICT") {
            json(res, { error: "Termin został zajęty. Skontaktuj się z obsługą obiektu." }, 409);
            return;
          }
          throw e;
        }

        await appendVenueAudit(db, {
          action: "hall_email_confirmed",
          reservationId,
          details: {},
        });

        json(res, {
          ok: true,
          status: "pending",
          reservationId,
          humanNumber: formatHumanReservationNumber(resData, "hall") || resData.humanNumber,
        });
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

      if (req.method === "GET" && op === "admin-halls-list") {
        await ensureHallDefaults(db);
        const snap = await db.collection("venueHalls").get();
        const halls = [];
        snap.forEach((d) => halls.push({ id: d.id, ...d.data() }));
        halls.sort((a, b) => (a.sortOrder || 0) - (b.sortOrder || 0));
        json(res, { halls });
        return;
      }

      if (req.method === "PUT" && op === "admin-hall-upsert") {
        const body = typeof req.body === "object" && req.body ? req.body : JSON.parse(req.body || "{}");
        const { id, ...fields } = body;
        if (!id) {
          json(res, { error: "Brak id sali." }, 400);
          return;
        }
        await db.collection("venueHalls").doc(id).set(
          {
            ...fields,
            updatedAt: FieldValue.serverTimestamp(),
            updatedBy: adminUser.email,
          },
          { merge: true }
        );
        await appendVenueAudit(db, { action: "hall_upsert", actorEmail: adminUser.email, details: { id } });
        json(res, { ok: true });
        return;
      }

      if (req.method === "GET" && op === "admin-reservations-list") {
        await ensureHallDefaults(db);
        const status = url.searchParams.get("status") || "all";
        let query = db.collection("venueReservations").orderBy("createdAt", "desc").limit(300);
        if (status === "active") {
          query = db
            .collection("venueReservations")
            .where("status", "in", ["pending", "confirmed"])
            .orderBy("createdAt", "desc")
            .limit(300);
        } else if (status && status !== "all") {
          query = db
            .collection("venueReservations")
            .where("status", "==", status)
            .orderBy("createdAt", "desc")
            .limit(300);
        }
        const snap = await query.get().catch(async () => {
          return db.collection("venueReservations").limit(300).get();
        });
        const hallSnap = await db.collection("venueHalls").get();
        const hallMap = {};
        hallSnap.forEach((h) => {
          hallMap[h.id] = h.data();
        });
        const rows = [];
        for (const d of snap.docs) {
          rows.push(formatHallRow({ id: d.id, ...d.data() }, hallMap));
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
        const d = await db.collection("venueReservations").doc(id).get();
        if (!d.exists) {
          json(res, { error: "Nie znaleziono." }, 404);
          return;
        }
        const x = { id: d.id, ...d.data() };
        const hall = (await db.collection("venueHalls").doc(x.hallId).get()).data() || {};
        json(res, { reservation: formatHallRow(x, { [x.hallId]: hall }) });
        return;
      }

      if (req.method === "POST" && op === "admin-reservation-confirm") {
        const body = typeof req.body === "object" && req.body ? req.body : JSON.parse(req.body || "{}");
        const { id } = body;
        if (!id) {
          json(res, { error: "Brak id." }, 400);
          return;
        }
        const ref = db.collection("venueReservations").doc(id);
        const snap = await ref.get();
        if (!snap.exists) {
          json(res, { error: "Nie znaleziono." }, 404);
          return;
        }
        const cur = snap.data();
        if (cur.status !== "pending") {
          json(res, { error: "Tylko status „oczekujące” można potwierdzić." }, 400);
          return;
        }
        const hallSnap = await db.collection("venueHalls").doc(cur.hallId).get();
        const hall = { id: hallSnap.id, ...hallSnap.data() };

        await ref.update({
          status: "confirmed",
          pendingExpiresAt: FieldValue.delete(),
          updatedAt: FieldValue.serverTimestamp(),
          updatedBy: adminUser.email,
        });

        const reread = (await ref.get()).data();
        const vars = buildHallMailVars({ ...reread, id }, hall, {});
        await sendHallTemplated(db, "hall_confirmed_client", vars.email, vars);
        await appendVenueAudit(db, {
          action: "hall_admin_confirm",
          reservationId: id,
          actorEmail: adminUser.email,
          details: {},
        });
        json(res, { ok: true });
        return;
      }

      if (req.method === "POST" && op === "admin-reservation-cancel") {
        const body = typeof req.body === "object" && req.body ? req.body : JSON.parse(req.body || "{}");
        const { id } = body;
        if (!id) {
          json(res, { error: "Brak id." }, 400);
          return;
        }
        const ref = db.collection("venueReservations").doc(id);
        const snap = await ref.get();
        if (!snap.exists) {
          json(res, { error: "Nie znaleziono." }, 404);
          return;
        }
        const cur = snap.data();
        if (!["pending", "confirmed", "email_verification_pending"].includes(cur.status)) {
          json(res, { error: "Nie można anulować tego statusu." }, 400);
          return;
        }
        await ref.update({
          status: "cancelled",
          pendingExpiresAt: FieldValue.delete(),
          emailVerificationExpiresAt: FieldValue.delete(),
          blockStartMs: FieldValue.delete(),
          blockEndMs: FieldValue.delete(),
          updatedAt: FieldValue.serverTimestamp(),
          updatedBy: adminUser.email,
        });
        const hall = (await db.collection("venueHalls").doc(cur.hallId).get()).data() || {};
        const vars = buildHallMailVars({ ...cur, id }, hall, {});
        if (cur.email) {
          await sendHallTemplated(db, "hall_cancelled_client", cur.email, vars);
        }
        await appendVenueAudit(db, {
          action: "hall_admin_cancel",
          reservationId: id,
          actorEmail: adminUser.email,
          details: {},
        });
        json(res, { ok: true });
        return;
      }

      if (req.method === "POST" && op === "admin-extend-pending") {
        const body = typeof req.body === "object" && req.body ? req.body : JSON.parse(req.body || "{}");
        const { id } = body;
        if (!id) {
          json(res, { error: "Brak id." }, 400);
          return;
        }
        const ref = db.collection("venueReservations").doc(id);
        const snap = await ref.get();
        if (!snap.exists) {
          json(res, { error: "Nie znaleziono." }, 404);
          return;
        }
        const cur = snap.data();
        if (cur.status !== "pending") {
          json(res, { error: "Tylko oczekujące można przedłużyć." }, 400);
          return;
        }
        const pexp = cur.pendingExpiresAt?.toMillis?.() || 0;
        const left = pexp - Date.now();
        if (left > HALL_EXTEND_THRESHOLD_MS) {
          json(res, { error: "Przedłużenie dostępne gdy do końca terminu pozostały 3 dni lub mniej." }, 400);
          return;
        }
        const newExp = Timestamp.fromMillis(pexp + 7 * 24 * 60 * 60 * 1000);
        await ref.update({
          pendingExpiresAt: newExp,
          updatedAt: FieldValue.serverTimestamp(),
          updatedBy: adminUser.email,
        });
        const vars = buildHallMailVars(
          { ...cur, id },
          (await db.collection("venueHalls").doc(cur.hallId).get()).data() || {},
          { expiresAt: newExp.toDate().toLocaleString("pl-PL", { timeZone: WARSAW }) }
        );
        if (cur.email) {
          await sendHallTemplated(db, "hall_extended_pending_client", cur.email, vars);
        }
        await appendVenueAudit(db, {
          action: "hall_extend_pending",
          reservationId: id,
          actorEmail: adminUser.email,
          details: {},
        });
        json(res, { ok: true, pendingExpiresAt: newExp.toMillis() });
        return;
      }

      if (req.method === "PATCH" && op === "admin-reservation-update") {
        const body = typeof req.body === "object" && req.body ? req.body : JSON.parse(req.body || "{}");
        const { id, adminNote, ...rest } = body;
        if (!id) {
          json(res, { error: "Brak id." }, 400);
          return;
        }
        const ref = db.collection("venueReservations").doc(id);
        const snap = await ref.get();
        if (!snap.exists) {
          json(res, { error: "Nie znaleziono." }, 404);
          return;
        }
        const cur = snap.data();
        if (["cancelled", "expired"].includes(cur.status)) {
          json(res, { error: "Nie można edytować tego rekordu." }, 400);
          return;
        }

        const hallSnap = await db.collection("venueHalls").doc(rest.hallId || cur.hallId).get();
        if (!hallSnap.exists) {
          json(res, { error: "Nieprawidłowa sala." }, 400);
          return;
        }
        const hall = { id: hallSnap.id, ...hallSnap.data() };

        const reservationDate = rest.reservationDate || cur.reservationDate;
        const startTime = rest.startTime || cur.startTime;
        const durationHours = rest.durationHours != null ? rest.durationHours : cur.durationHours;
        const guestsCount = rest.guestsCount != null ? rest.guestsCount : cur.guestsCount;
        const exclusive =
          hall.hallKind === "small" ? true : rest.exclusive != null ? Boolean(rest.exclusive) : cur.exclusive;

        const chk = await checkHallAvailability(
          db,
          hall,
          { reservationDate, startTime, durationHours, guestsCount, exclusive },
          id
        );
        if (!chk.ok) {
          json(res, { error: chk.error || "Konflikt terminu." }, 409);
          return;
        }

        const patch = {
          updatedAt: FieldValue.serverTimestamp(),
          updatedBy: adminUser.email,
        };
        if (adminNote !== undefined) patch.adminNote = String(adminNote || "").slice(0, 2000);
        if (rest.fullName !== undefined) patch.fullName = String(rest.fullName).trim();
        if (rest.email !== undefined) patch.email = String(rest.email).trim().toLowerCase();
        if (rest.phonePrefix !== undefined) patch.phonePrefix = String(rest.phonePrefix).trim();
        if (rest.phoneNational !== undefined) patch.phoneNational = String(rest.phoneNational).replace(/[^\d]/g, "");
        if (rest.eventType !== undefined) patch.eventType = String(rest.eventType).slice(0, 500);
        if (rest.customerNote !== undefined) patch.customerNote = String(rest.customerNote).slice(0, 2000);
        if (rest.hallId !== undefined) patch.hallId = hall.id;
        if (rest.hallId !== undefined) {
          patch.hallNameSnapshot = hall.name;
          patch.hallKindSnapshot = hall.hallKind;
          patch.fullBlockGuestThresholdSnap = hall.fullBlockGuestThreshold ?? 100;
        }

        patch.reservationDate = reservationDate;
        patch.startTime = startTime;
        patch.durationHours = Number(durationHours);
        patch.startTimeLabel = chk.startTimeLabel;
        patch.endTimeLabel = chk.endTimeLabel;
        patch.startDateTime = Timestamp.fromMillis(chk.startMs);
        patch.endDateTime = Timestamp.fromMillis(chk.endMs);
        patch.startMs = chk.startMs;
        patch.endMs = chk.endMs;
        patch.guestsCount = Number(guestsCount);
        patch.exclusive = exclusive;

        if (["pending", "confirmed", "manual_block"].includes(cur.status)) {
          patch.blockStartMs = chk.startMs;
          patch.blockEndMs = chk.blockEndMs;
        }

        if (rest.phonePrefix !== undefined || rest.phoneNational !== undefined) {
          const phoneE164 = validatePhone(
            rest.phonePrefix !== undefined ? rest.phonePrefix : cur.phonePrefix,
            rest.phoneNational !== undefined ? rest.phoneNational : cur.phoneNational
          );
          if (phoneE164) patch.phoneE164 = phoneE164;
        }

        await ref.update(patch);
        await appendVenueAudit(db, {
          action: "hall_reservation_update",
          reservationId: id,
          actorEmail: adminUser.email,
          details: {},
        });
        json(res, { ok: true });
        return;
      }

      if (req.method === "POST" && op === "admin-reservation-create") {
        const body = typeof req.body === "object" && req.body ? req.body : JSON.parse(req.body || "{}");
        await ensureHallDefaults(db);
        const {
          hallId,
          reservationDate,
          startTime,
          durationHours,
          guestsCount,
          exclusive,
          eventType,
          customerNote,
          fullName,
          email,
          phonePrefix,
          phoneNational,
          status: wantStatus,
        } = body;
        if (!hallId || !reservationDate || !startTime) {
          json(res, { error: "Wymagana sala i termin." }, 400);
          return;
        }
        const hallSnap = await db.collection("venueHalls").doc(hallId).get();
        if (!hallSnap.exists) {
          json(res, { error: "Sala nie istnieje." }, 400);
          return;
        }
        const hall = { id: hallSnap.id, ...hallSnap.data() };
        const settings = (await db.collection("venueSettings").doc("default").get()).data() || {};
        const hv = assertEventWithinHallHours(settings, reservationDate, startTime, durationHours);
        if (!hv.ok) {
          json(res, { error: hv.error }, 400);
          return;
        }
        const st =
          wantStatus === "confirmed"
            ? "confirmed"
            : wantStatus === "manual_block"
              ? "manual_block"
              : "pending";
        let gc = Number(guestsCount || 1);
        let excl = hall.hallKind === "small" ? true : Boolean(exclusive);
        if (st === "manual_block") {
          gc = 1;
          excl = true;
        }
        const chk = await checkHallAvailability(db, hall, {
          reservationDate,
          startTime,
          durationHours,
          guestsCount: gc,
          exclusive: excl,
        });
        if (!chk.ok) {
          json(res, { error: chk.error }, 409);
          return;
        }
        const phoneE164 = validatePhone(phonePrefix, phoneNational);
        if (!phoneE164) {
          json(res, { error: "Telefon nieprawidłowy." }, 400);
          return;
        }
        const humanNumber = await allocateHallReservationNumber(db);
        const ref = db.collection("venueReservations").doc();
        const pendingUntil =
          st === "pending" ? Timestamp.fromMillis(Date.now() + HALL_PENDING_MS) : null;

        const doc = {
          humanNumber,
          status: st,
          hallId: hall.id,
          hallNameSnapshot: hall.name,
          hallKindSnapshot: hall.hallKind,
          fullBlockGuestThresholdSnap: hall.fullBlockGuestThreshold ?? 100,
          fullName: String(fullName || "Blokada").trim(),
          email: String(email || adminUser.email).trim().toLowerCase(),
          phonePrefix: String(phonePrefix || "+48").trim(),
          phoneNational: String(phoneNational || "").replace(/[^\d]/g, ""),
          phoneE164,
          guestsCount: st === "manual_block" ? 0 : gc,
          exclusive: excl,
          eventType: String(eventType || "—").slice(0, 500),
          customerNote: String(customerNote || "").slice(0, 2000),
          adminNote: String(body.adminNote || "").slice(0, 2000),
          reservationDate,
          startTime: String(startTime).trim(),
          durationHours: Number(durationHours),
          startTimeLabel: chk.startTimeLabel,
          endTimeLabel: chk.endTimeLabel,
          startDateTime: Timestamp.fromMillis(chk.startMs),
          endDateTime: Timestamp.fromMillis(chk.endMs),
          startMs: chk.startMs,
          endMs: chk.endMs,
          bufferMinutes: hall.bufferMinutes ?? 60,
          blockStartMs: chk.startMs,
          blockEndMs: chk.blockEndMs,
          confirmationTokenHash: null,
          emailVerificationExpiresAt: null,
          pendingExpiresAt: pendingUntil,
          createdAt: FieldValue.serverTimestamp(),
          updatedAt: FieldValue.serverTimestamp(),
          source: "admin",
          createdBy: adminUser.email,
        };
        if (st === "manual_block") {
          doc.eventType = "Blokada terminu";
        }
        await ref.set(doc);
        await appendVenueAudit(db, {
          action: "hall_admin_create",
          reservationId: ref.id,
          actorEmail: adminUser.email,
          details: { humanNumber, status: st },
        });
        json(res, { ok: true, id: ref.id, humanNumber });
        return;
      }

      if (req.method === "GET" && op === "admin-venue-settings") {
        await ensureVenueSettings(db);
        json(res, {
          settings: {
            hallOpenTime: FIXED_HALL_OPEN_TIME,
            hallCloseTime: FIXED_HALL_CLOSE_TIME,
          },
        });
        return;
      }

      if (req.method === "PUT" && op === "admin-venue-settings-save") {
        await ensureVenueSettings(db);
        await db.collection("venueSettings").doc("default").set(
          {
            hallOpenTime: FIXED_HALL_OPEN_TIME,
            hallCloseTime: FIXED_HALL_CLOSE_TIME,
            updatedAt: FieldValue.serverTimestamp(),
            updatedBy: adminUser.email,
          },
          { merge: true }
        );
        await appendVenueAudit(db, {
          action: "venue_settings_save",
          actorEmail: adminUser.email,
          details: {},
        });
        json(res, { ok: true });
        return;
      }

      if (req.method === "GET" && op === "admin-mail-templates") {
        const keys = Object.keys(HALL_DEFAULT_TEMPLATES);
        const out = {};
        for (const k of keys) {
          out[k] = await getHallMailTemplate(db, k);
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
        await db.collection("venueMailTemplates").doc(key).set(
          {
            subject: String(subject || ""),
            bodyHtml: String(bodyHtml || ""),
            updatedAt: FieldValue.serverTimestamp(),
            updatedBy: adminUser.email,
          },
          { merge: true }
        );
        await appendVenueAudit(db, {
          action: "hall_mail_template_save",
          actorEmail: adminUser.email,
          details: { key },
        });
        json(res, { ok: true });
        return;
      }

      json(res, { error: "Nieznana operacja." }, 404);
    } catch (err) {
      console.error(err);
      json(res, { error: err.message || "Błąd serwera." }, 500);
    }
  }
);

module.exports = { hallApi };
