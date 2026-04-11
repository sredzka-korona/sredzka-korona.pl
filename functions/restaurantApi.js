/**
 * Cloud Functions — moduł restauracji (HTTPS restaurantApi ?op=...).
 */
const { randomUUID } = require("node:crypto");
const { onRequest } = require("firebase-functions/v2/https");
const { initializeApp, getApps } = require("firebase-admin/app");
const { getFirestore, FieldValue, Timestamp } = require("firebase-admin/firestore");
const { parsePhoneNumberFromString } = require("libphonenumber-js");

const { checkRateLimit } = require("./lib/rateLimit");
const { checkSpamBlock, setSpamBlock } = require("./lib/bookingSpamBlock");
const {
  SESSION_MS,
  EMAIL_LINK_MS,
  RESTAURANT_PENDING_MS,
} = require("./lib/bookingConstants");
const {
  renderTemplate,
  getRestaurantMailTemplate,
  sendMail,
  buildBrandedEmail,
} = require("./lib/mail");
const {
  json,
  verifyAdminAuth,
  hashToken,
  randomToken,
  verifyTurnstile,
} = require("./lib/apiHelpers");

const {
  computeWindowMs,
  warsawFromParts,
  getReservation,
  loadSettings,
  loadTablesList,
  filterBookableTables,
  findAvailableTableIds,
  allocateRestaurantNumber,
  releaseLocksForReservation,
  claimTableLocksInTransaction,
  replaceTableLocksInTransaction,
  setReservationAndTableLocksInTransaction,
  assertReservationWindowInSettings,
  assertNotPast,
  cleanupBufferMinutes,
  BLOCKING,
} = require("./lib/restaurantLogic");
const { ensureFormattedReservationNumber, formatHumanReservationNumber } = require("./lib/humanNumber");

if (!getApps().length) {
  initializeApp();
}

const db = getFirestore();

function restaurantName() {
  return process.env.RESTAURANT_NAME || process.env.HOTEL_NAME || "Średzka Korona — Restauracja";
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

async function appendRestaurantAudit(db, { action, reservationId, actorEmail, details }) {
  await db.collection("restaurantAuditLog").add({
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

async function ensureRestaurantDefaults(db) {
  const setRef = db.collection("restaurantSettings").doc("default");
  const s = await setRef.get();
  if (!s.exists) {
    await setRef.set({
      tableCount: 5,
      maxGuestsPerTable: 4,
      reservationOpenTime: "12:00",
      reservationCloseTime: "22:00",
      timeSlotMinutes: 30,
      updatedAt: FieldValue.serverTimestamp(),
    });
  }
  const tables = await db.collection("restaurantTables").limit(1).get();
  if (tables.empty) {
    const batch = db.batch();
    for (let i = 1; i <= 5; i += 1) {
      const id = `table-${i}`;
      batch.set(db.collection("restaurantTables").doc(id), {
        number: i,
        zone: "sala",
        active: true,
        hidden: false,
        description: "",
        sortOrder: i,
        createdAt: FieldValue.serverTimestamp(),
      });
    }
    await batch.commit();
  }
}

function formatTimeFromMs(ms) {
  const { DateTime } = require("luxon");
  return DateTime.fromMillis(ms, { zone: "Europe/Warsaw" }).toFormat("HH:mm");
}

function formatDateFromMs(ms) {
  const { DateTime } = require("luxon");
  return DateTime.fromMillis(ms, { zone: "Europe/Warsaw" }).toFormat("yyyy-MM-dd");
}

function buildRestaurantMailVars(res, tableDocsById, extra = {}) {
  const tid = res.assignedTableIds || [];
  const labels = tid.map((id) => {
    const t = tableDocsById[id];
    return t ? `Stół ${t.number}` : id;
  });
  const startMs = res.startDateTime?.toMillis?.() || res.startMs;
  const endMs = res.endDateTime?.toMillis?.() || res.endMs;
  return {
    reservationId: res.id,
    reservationNumber: ensureFormattedReservationNumber(res, "restaurant") || res.id,
    fullName: res.fullName || "",
    email: res.email || "",
    phone: `${res.phonePrefix || ""} ${res.phoneNational || ""}`.trim(),
    date: res.reservationDate || (startMs ? formatDateFromMs(startMs) : ""),
    timeFrom: startMs ? formatTimeFromMs(startMs) : "",
    timeTo: endMs ? formatTimeFromMs(endMs) : "",
    durationHours: res.durationHours != null ? String(res.durationHours) : "",
    tablesCount: String(res.tablesCount ?? ""),
    tablesList: labels.join(", "),
    guestsCount: String(res.guestsCount ?? ""),
    joinTables: res.joinTables ? "tak" : "nie",
    customerNote: res.customerNote || "",
    adminNote: res.adminNote || "",
    confirmationLink: extra.confirmationLink || "",
    restaurantName: restaurantName(),
    ...extra,
  };
}

async function sendRestaurantTemplated(db, key, to, vars) {
  const t = await getRestaurantMailTemplate(db, key);
  const subject = renderTemplate(t.subject, vars);
  const htmlFragment = renderTemplate(t.bodyHtml, vars);
  const email = buildBrandedEmail({
    subject,
    htmlFragment,
    brandName: restaurantName(),
    mailHeaderService: "restaurant",
    mailHeaderKey: key,
    reservationNumber: vars.reservationNumber,
    serviceLabel: "Restauracja",
    siteUrl: publicSiteUrl(),
    serviceUrl: `${publicSiteUrl()}/Restauracja/`,
    preheader: `Rezerwacja stolika ${vars.reservationNumber || ""}`.trim(),
    actionUrl:
      key === "restaurant_confirm_email" || key === "rest_confirm_email" ? vars.confirmationLink || "" : "",
    actionLabel: "Potwierdź adres e-mail",
  });
  await sendMail(key, { to, subject, html: email.html });
}

async function loadTablesMap(db) {
  const list = await loadTablesList(db);
  const map = {};
  list.forEach((t) => {
    map[t.id] = t;
  });
  return map;
}

async function loadBookableTables(db) {
  return filterBookableTables(await loadTablesList(db));
}

async function syncSettingsTableCount(db, updatedBy) {
  const activeTables = await loadBookableTables(db);
  const tableCount = activeTables.length;
  await db.collection("restaurantSettings").doc("default").set(
    {
      tableCount,
      updatedAt: FieldValue.serverTimestamp(),
      ...(updatedBy ? { updatedBy } : {}),
    },
    { merge: true }
  );
  return tableCount;
}

async function createOrRestoreRestaurantTable(db, adminEmail) {
  const list = await loadTablesList(db);
  const removedTable = [...list]
    .filter((table) => table.active === false || table.hidden === true)
    .sort((left, right) => (left.number || 0) - (right.number || 0))[0];

  if (removedTable) {
    await db.collection("restaurantTables").doc(removedTable.id).set(
      {
        active: true,
        hidden: false,
        removedAt: FieldValue.delete(),
        removedBy: FieldValue.delete(),
        updatedAt: FieldValue.serverTimestamp(),
        updatedBy: adminEmail || null,
      },
      { merge: true }
    );
    await syncSettingsTableCount(db, adminEmail);
    return { restored: true, table: { ...removedTable, active: true, hidden: false } };
  }

  const nextNumber = list.reduce((max, table) => Math.max(max, Number(table.number) || 0), 0) + 1;
  const id = `table-${nextNumber}`;
  const payload = {
    number: nextNumber,
    zone: "",
    active: true,
    hidden: false,
    description: "",
    sortOrder: nextNumber,
    createdAt: FieldValue.serverTimestamp(),
    createdBy: adminEmail || "system",
    updatedAt: FieldValue.serverTimestamp(),
    updatedBy: adminEmail || null,
  };
  await db.collection("restaurantTables").doc(id).set(payload, { merge: true });
  await syncSettingsTableCount(db, adminEmail);
  return {
    restored: false,
    table: {
      id,
      number: nextNumber,
      zone: "",
      active: true,
      hidden: false,
      description: "",
      sortOrder: nextNumber,
    },
  };
}

async function removeRestaurantTable(db, tableId, adminEmail) {
  const ref = db.collection("restaurantTables").doc(tableId);
  const snap = await ref.get();
  if (!snap.exists) {
    throw new Error("Nie znaleziono stolika.");
  }
  const table = { id: snap.id, ...snap.data() };
  if (table.active === false || table.hidden === true) {
    throw new Error("Ten stolik jest już usunięty.");
  }
  if (await hasFutureBlockingReservationForTable(db, tableId)) {
    throw new Error(`Nie można usunąć stolika ${table.number}, bo ma przyszłą rezerwację albo blokadę.`);
  }
  await ref.set(
    {
      active: false,
      hidden: true,
      removedAt: FieldValue.serverTimestamp(),
      removedBy: adminEmail || null,
      updatedAt: FieldValue.serverTimestamp(),
      updatedBy: adminEmail || null,
    },
    { merge: true }
  );
  await syncSettingsTableCount(db, adminEmail);
  return table;
}

/** Synchronizuje widoczność stolików z tableCount i zwraca ostrzeżenia */
async function syncTablesWithTargetCount(db, targetCount, adminEmail) {
  const warnings = [];
  const list = await loadTablesList(db);
  const byNum = [...list].sort((a, b) => (a.number || 0) - (b.number || 0));
  for (const t of byNum) {
    if ((t.number || 0) <= targetCount) {
      if (t.hidden && t.active !== false) {
        await db.collection("restaurantTables").doc(t.id).update({
          hidden: false,
          updatedAt: FieldValue.serverTimestamp(),
          updatedBy: adminEmail || null,
        });
      }
      continue;
    }
    const future = await hasFutureBlockingReservationForTable(db, t.id);
    if (future) {
      warnings.push(
        `Stół ${t.number}: ma przyszłą rezerwację lub blokadę — nie oznaczono jako ukryty. Zmniejsz liczbę stolików lub przenieś rezerwacje.`
      );
      continue;
    }
    await db.collection("restaurantTables").doc(t.id).update({
      hidden: true,
      updatedAt: FieldValue.serverTimestamp(),
      updatedBy: adminEmail || null,
    });
  }
  const maxNum = byNum.length ? byNum[byNum.length - 1].number || 0 : 0;
  if (targetCount > maxNum) {
    const batch = db.batch();
    for (let n = maxNum + 1; n <= targetCount; n += 1) {
      const id = `table-${n}`;
      batch.set(db.collection("restaurantTables").doc(id), {
        number: n,
        zone: "sala",
        active: true,
        hidden: false,
        description: "",
        sortOrder: n,
        createdAt: FieldValue.serverTimestamp(),
        createdBy: adminEmail || "system",
      });
    }
    await batch.commit();
  }
  return warnings;
}

async function hasFutureBlockingReservationForTable(db, tableId) {
  const now = Date.now();
  const q = await db
    .collection("restaurantTableLocks")
    .where("tableId", "==", tableId)
    .where("blockEndMs", ">", now)
    .limit(20)
    .get();
  for (const doc of q.docs) {
    const rid = doc.data().reservationId;
    const r = await getReservation(db, rid);
    if (r && BLOCKING.has(r.status)) {
      return true;
    }
  }
  return false;
}

function formatRestaurantRow(x, tableMap) {
  const createdAt = x.createdAt?.toMillis?.() || 0;
  const pendingExp = x.pendingExpiresAt?.toMillis?.() || null;
  const emailExp = x.emailVerificationExpiresAt?.toMillis?.() || null;
  const statusUi = {
    email_verification_pending: "E-mail do potwierdzenia",
    pending: "Oczekujące",
    confirmed: "Zarezerwowane",
    cancelled: "Anulowane",
    expired: "Wygasłe",
    manual_block: "Blokada stolików",
  };
  const startMs = x.startDateTime?.toMillis?.();
  const endMs = x.endDateTime?.toMillis?.();
  const ids = x.assignedTableIds || [];
  const tableLabels = ids
    .map((id) => {
      const t = tableMap[id];
      return t ? `Stół ${t.number}` : id;
    })
    .join(", ");
  return {
    id: x.id,
    humanNumber: x.humanNumber,
    humanNumberLabel: formatHumanReservationNumber(x, "restaurant") || x.humanNumber || x.id,
    fullName: x.fullName,
    email: x.email,
    phonePrefix: x.phonePrefix || "",
    phoneNational: x.phoneNational || "",
    phone: `${x.phonePrefix || ""} ${x.phoneNational || ""}`.trim() || x.phoneE164,
    status: x.status,
    statusLabel: statusUi[x.status] || x.status,
    reservationDate: x.reservationDate,
    startTime: x.startTime || "",
    startDateTime: startMs,
    endDateTime: endMs,
    durationHours: x.durationHours,
    tablesCount: x.tablesCount,
    assignedTableIds: ids,
    assignedTablesLabel: tableLabels,
    guestsCount: x.guestsCount,
    joinTables: Boolean(x.joinTables),
    customerNote: x.customerNote,
    adminNote: x.adminNote,
    pendingExpiresAt: pendingExp,
    emailVerificationExpiresAt: emailExp,
    createdAtMs: createdAt,
    cleanupBufferMinutes: x.cleanupBufferMinutes ?? cleanupBufferMinutes(),
  };
}

function isYmdFirebase(value) {
  return /^\d{4}-\d{2}-\d{2}$/.test(String(value || "").trim());
}

function mapCateringRecipientDoc(id, d) {
  const data = d || {};
  return {
    id,
    displayName: data.displayName || "",
    contactFirstName: data.contactFirstName || "",
    contactLastName: data.contactLastName || "",
    email: data.email || "",
    phonePrefix: data.phonePrefix || "+48",
    phoneNational: data.phoneNational || "",
    street: data.street || "",
    buildingNumber: data.buildingNumber || "",
    postalCode: data.postalCode || "",
    city: data.city || "",
    extraInfo: data.extraInfo || "",
  };
}

async function listCateringRecipientsFirestore(db) {
  const snap = await db.collection("cateringRecipients").limit(500).get();
  const rows = snap.docs.map((doc) => mapCateringRecipientDoc(doc.id, doc.data()));
  rows.sort((a, b) =>
    String(a.displayName).localeCompare(String(b.displayName), "pl", { sensitivity: "base" })
  );
  return rows;
}

async function assertCateringRecipientDeletableFirestore(db, id) {
  const now = Date.now();
  const blocking = new Set(["email_verification_pending", "pending", "confirmed", "manual_block"]);
  const q = await db.collection("restaurantReservations").where("recipientId", "==", id).limit(200).get();
  for (const doc of q.docs) {
    const d = doc.data();
    if (!blocking.has(d.status)) continue;
    const endMs = Number(d.endMs || 0);
    if (!endMs) continue;
    const bufMs = Number(d.cleanupBufferMinutes ?? cleanupBufferMinutes()) * 60000;
    if (endMs + bufMs > now) {
      return "Nie można usunąć odbiorcy powiązanego z aktywną lub przyszłą rezerwacją dostawy.";
    }
  }
  return null;
}

const MAX_CATERING_REPEAT_OCCURRENCES_FIREBASE = 250;
const CATERING_INDEFINITE_UNTIL_YEARS_FIREBASE = 5;

function cateringDateFromYmdFirebase(ymd) {
  const [y, m, d] = String(ymd).split("-").map((x) => Number(x));
  const dt = new Date(y, m - 1, d);
  return Number.isFinite(dt.getTime()) ? dt : null;
}

function cateringYmdFromDateFirebase(dt) {
  return `${dt.getFullYear()}-${String(dt.getMonth() + 1).padStart(2, "0")}-${String(dt.getDate()).padStart(2, "0")}`;
}

function cateringAddOneCalendarMonthFirebase(dt) {
  const y = dt.getFullYear();
  const m = dt.getMonth();
  const day = dt.getDate();
  const nm = m + 1;
  const ny = nm > 11 ? y + 1 : y;
  const nmonth = nm > 11 ? 0 : nm;
  const lastDay = new Date(ny, nmonth + 1, 0).getDate();
  const nd = Math.min(day, lastDay);
  return new Date(ny, nmonth, nd);
}

function cateringEffectiveRepeatUntilFirebase(reservationDate, repeatUntilRaw, repeatIndefinite) {
  const u = String(repeatUntilRaw || "").trim();
  if (repeatIndefinite || !u) {
    const start = cateringDateFromYmdFirebase(reservationDate);
    if (!start) throw new Error("Nieprawidłowa data pierwszej dostawy.");
    const end = new Date(start);
    end.setFullYear(end.getFullYear() + CATERING_INDEFINITE_UNTIL_YEARS_FIREBASE);
    return cateringYmdFromDateFirebase(end);
  }
  return u;
}

function expandCateringRepeatDatesFirebase(reservationDate, repeatMode, repeatWeekday, repeatUntilRaw, options = {}) {
  const repeatIndefinite = Boolean(options.repeatIndefinite);
  const repeatWeekdays = Array.isArray(options.repeatWeekdays) ? options.repeatWeekdays : [];
  const rd = String(reservationDate || "").trim();
  if (!isYmdFirebase(rd)) throw new Error("Nieprawidłowa data pierwszej dostawy.");
  const mode = String(repeatMode || "none").toLowerCase();
  if (!mode || mode === "none") {
    return [rd];
  }
  const until = cateringEffectiveRepeatUntilFirebase(rd, repeatUntilRaw, repeatIndefinite);
  if (!isYmdFirebase(until)) throw new Error("Nieprawidłowy zakres dat.");
  if (until.localeCompare(rd) < 0) {
    throw new Error("Data końca powtarzania nie może być wcześniejsza od pierwszej dostawy.");
  }
  const endD = cateringDateFromYmdFirebase(until);
  if (!endD) throw new Error("Nieprawidłowa data końca powtarzania.");
  const dates = [];

  if (mode === "selected_days") {
    const set = new Set(
      repeatWeekdays.map((x) => Number(x)).filter((n) => Number.isInteger(n) && n >= 0 && n <= 6)
    );
    if (!set.size) throw new Error("Wybierz co najmniej jeden dzień tygodnia.");
    let cur = cateringDateFromYmdFirebase(rd);
    if (!cur) throw new Error("Nieprawidłowa data pierwszej dostawy.");
    while (cur <= endD && dates.length < MAX_CATERING_REPEAT_OCCURRENCES_FIREBASE) {
      if (set.has(cur.getDay())) {
        dates.push(cateringYmdFromDateFirebase(cur));
      }
      cur = new Date(cur.getFullYear(), cur.getMonth(), cur.getDate() + 1);
    }
    if (!dates.length) throw new Error("Brak terminów w podanym zakresie.");
    return dates;
  }

  if (mode === "weekly") {
    let cur = cateringDateFromYmdFirebase(rd);
    if (!cur) throw new Error("Nieprawidłowa data pierwszej dostawy.");
    while (cur <= endD && dates.length < MAX_CATERING_REPEAT_OCCURRENCES_FIREBASE) {
      dates.push(cateringYmdFromDateFirebase(cur));
      cur.setDate(cur.getDate() + 7);
    }
    if (!dates.length) throw new Error("Brak terminów w podanym zakresie.");
    return dates;
  }

  if (mode === "biweekly") {
    let cur = cateringDateFromYmdFirebase(rd);
    if (!cur) throw new Error("Nieprawidłowa data pierwszej dostawy.");
    while (cur <= endD && dates.length < MAX_CATERING_REPEAT_OCCURRENCES_FIREBASE) {
      dates.push(cateringYmdFromDateFirebase(cur));
      cur.setDate(cur.getDate() + 14);
    }
    if (!dates.length) throw new Error("Brak terminów w podanym zakresie.");
    return dates;
  }

  if (mode === "monthly") {
    let cur = cateringDateFromYmdFirebase(rd);
    if (!cur) throw new Error("Nieprawidłowa data pierwszej dostawy.");
    while (cur <= endD && dates.length < MAX_CATERING_REPEAT_OCCURRENCES_FIREBASE) {
      dates.push(cateringYmdFromDateFirebase(cur));
      cur = cateringAddOneCalendarMonthFirebase(cur);
    }
    if (!dates.length) throw new Error("Brak terminów w podanym zakresie.");
    return dates;
  }

  throw new Error("Nieobsługiwany tryb powtarzania.");
}

const restaurantApi = onRequest(
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
        json(res, { ok: true, service: "restaurantApi" });
        return;
      }

      if (req.method === "GET" && op === "public-settings") {
        await ensureRestaurantDefaults(db);
        const settings = (await loadSettings(db)) || {};
        const tables = filterBookableForPublic(await loadTablesList(db));
        const slotMinutes = Number(settings.timeSlotMinutes || 30);
        const open = settings.reservationOpenTime || "12:00";
        const close = settings.reservationCloseTime || "22:00";
        let slots = buildTimeSlots(open, close, slotMinutes);
        if (!slots.length) {
          slots = ["12:00", "13:00", "14:00", "15:00", "18:00", "19:00", "20:00"];
        }
        json(res, {
          maxGuestsPerTable: Number(settings.maxGuestsPerTable || 4),
          tableCount: tables.length,
          reservationOpenTime: open,
          reservationCloseTime: close,
          timeSlotMinutes: slotMinutes,
          timeSlots: slots,
          restaurantName: restaurantName(),
        });
        return;
      }

      if (req.method === "POST" && op === "public-availability") {
        await ensureRestaurantDefaults(db);
        const body = typeof req.body === "object" && req.body ? req.body : JSON.parse(req.body || "{}");
        const { reservationDate, startTime, durationHours, tablesCount } = body;
        const settings = await loadSettings(db);
        const maxGuests = Number(settings?.maxGuestsPerTable || 4);
        const tc = Number(tablesCount || 1);
        if (tc < 1) {
          json(res, { error: "Wybierz co najmniej jeden stolik." }, 400);
          return;
        }
        const { startMs, endMs } = computeWindowMs(reservationDate, startTime, durationHours);
        assertNotPast(startMs);
        assertReservationWindowInSettings(settings, startMs, endMs);
        const avail = await findAvailableTableIds(db, {
          startMs,
          endMs,
          tablesNeeded: tc,
          joinTables: Boolean(body.joinTables),
          excludeReservationId: null,
        });
        json(res, {
          ok: avail.ok,
          available: avail.ok,
          message: avail.ok ? null : "Brak wystarczającej liczby wolnych stolików w tym terminie.",
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
        const spam = await checkSpamBlock(db, "restaurant", ip, emailKey);
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
        const okRlIp = await checkRateLimit(db, `rest:ip:${ip}:draft`);
        const okRlEm = !emailKey || (await checkRateLimit(db, `rest:em:${emailKey}:draft`));
        const fp = String(body.fingerprint || "").slice(0, 64);
        const okRlFp = !fp || (await checkRateLimit(db, `rest:fp:${fp}:draft`));
        if (!okRlIp || !okRlEm || !okRlFp) {
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
          json(res, { error: "Wymagana akceptacja regulaminu." }, 400);
          return;
        }

        await ensureRestaurantDefaults(db);
        const settings = await loadSettings(db);
        const maxGuestsPerTable = Number(settings?.maxGuestsPerTable || 4);

        const {
          reservationDate,
          startTime,
          durationHours,
          tablesCount,
          guestsCount,
          joinTables,
          customerNote,
          fullName,
          email,
          phonePrefix,
          phoneNational,
        } = body;

        const tc = Number(tablesCount || 0);
        const gc = Number(guestsCount || 0);
        if (tc < 1 || gc < 1) {
          json(res, { error: "Podaj liczbę stolików i gości (min. 1)." }, 400);
          return;
        }
        if (gc > tc * maxGuestsPerTable) {
          json(res, { error: `Maksymalnie ${tc * maxGuestsPerTable} gości przy ${tc} stolikach.` }, 400);
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

        const { startMs, endMs } = computeWindowMs(reservationDate, startTime, durationHours);
        assertNotPast(startMs);
        assertReservationWindowInSettings(settings, startMs, endMs);

        const avail = await findAvailableTableIds(db, {
          startMs,
          endMs,
          tablesNeeded: tc,
          joinTables: Boolean(joinTables),
          excludeReservationId: null,
        });
        if (!avail.ok) {
          json(res, { error: "Brak wolnych stolików w wybranym terminie. Wybierz inny czas." }, 409);
          return;
        }

        const humanNumber = await allocateRestaurantNumber(db);
        const token = randomToken();
        const tokenHash = hashToken(token);
        const now = Date.now();
        const resRef = db.collection("restaurantReservations").doc();
        const confirmationLink = `${publicSiteUrl()}/Restauracja/potwierdzenie.html?token=${encodeURIComponent(token)}`;

        const dur = Number(durationHours);
        await db.runTransaction(async (tx) => {
          tx.set(resRef, {
            humanNumber,
            status: "email_verification_pending",
            fullName: String(fullName).trim(),
            email: String(email).trim().toLowerCase(),
            phonePrefix: String(phonePrefix || "").trim(),
            phoneNational: String(phoneNational || "").replace(/[^\d]/g, ""),
            phoneE164,
            guestsCount: gc,
            tablesCount: tc,
            joinTables: Boolean(joinTables),
            customerNote: String(customerNote || "").trim().slice(0, 2000),
            adminNote: "",
            reservationDate: String(reservationDate).trim(),
            startTime: String(startTime).trim(),
            durationHours: dur,
            startDateTime: Timestamp.fromMillis(startMs),
            endDateTime: Timestamp.fromMillis(endMs),
            startMs,
            endMs,
            cleanupBufferMinutes: cleanupBufferMinutes(),
            assignedTableIds: [],
            confirmationTokenHash: tokenHash,
            emailVerificationExpiresAt: Timestamp.fromMillis(now + EMAIL_LINK_MS),
            pendingExpiresAt: null,
            createdAt: FieldValue.serverTimestamp(),
            updatedAt: FieldValue.serverTimestamp(),
            source: "web",
          });
        });

        const tableMap = await loadTablesMap(db);
        const vars = buildRestaurantMailVars(
          {
            id: resRef.id,
            humanNumber,
            fullName,
            email,
            phonePrefix,
            phoneNational,
            reservationDate,
            durationHours: dur,
            tablesCount: tc,
            guestsCount: gc,
            joinTables: Boolean(joinTables),
            customerNote,
            startDateTime: Timestamp.fromMillis(startMs),
            endDateTime: Timestamp.fromMillis(endMs),
            startMs,
            endMs,
          },
          tableMap,
          { confirmationLink }
        );
        await sendRestaurantTemplated(db, "restaurant_confirm_email", vars.email, vars);
        await setSpamBlock(db, "restaurant", ip, emailKey);

        await appendRestaurantAudit(db, {
          action: "restaurant_draft_created",
          reservationId: resRef.id,
          details: { humanNumber: ensureFormattedReservationNumber(humanNumber, "restaurant") || humanNumber },
        });

        json(res, {
          ok: true,
          reservationId: resRef.id,
          humanNumber: ensureFormattedReservationNumber(humanNumber, "restaurant") || humanNumber,
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
        const q = await db.collection("restaurantReservations").where("confirmationTokenHash", "==", th).limit(1).get();
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
            humanNumber: formatHumanReservationNumber(resData, "restaurant") || resData.humanNumber,
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

        const startMs = resData.startDateTime?.toMillis?.() || resData.startMs;
        const endMs = resData.endDateTime?.toMillis?.() || resData.endMs;
        const tc = Number(resData.tablesCount || 1);

        const alloc = await findAvailableTableIds(db, {
          startMs,
          endMs,
          tablesNeeded: tc,
          joinTables: Boolean(resData.joinTables),
          excludeReservationId: reservationId,
        });
        if (!alloc.ok || !alloc.tableIds?.length) {
          json(res, { error: "Termin został zajęty. Spróbuj wybrać inny czas lub skontaktuj się z lokalem." }, 409);
          return;
        }

        try {
          await db.runTransaction(async (tx) => {
            const snap = await tx.get(doc.ref);
            const cur = snap.data();
            if (cur.status !== "email_verification_pending") {
              throw new Error("STATUS_CHANGED");
            }
            await claimTableLocksInTransaction(tx, db, {
              reservationId,
              tableIds: alloc.tableIds,
              startMs,
              endMs,
              excludeReservationId: null,
            });
            const pendingUntil = Timestamp.fromMillis(Date.now() + RESTAURANT_PENDING_MS);
            tx.update(doc.ref, {
              status: "pending",
              assignedTableIds: alloc.tableIds,
              emailVerificationExpiresAt: FieldValue.delete(),
              pendingExpiresAt: pendingUntil,
              updatedAt: FieldValue.serverTimestamp(),
            });
          });
        } catch (e) {
          if (e.message === "STATUS_CHANGED") {
            const latest = await getReservation(db, reservationId);
            if (latest && (latest.status === "pending" || latest.status === "confirmed")) {
              json(res, {
                ok: true,
                status: latest.status,
                reservationId,
                humanNumber: formatHumanReservationNumber(latest, "restaurant") || latest.humanNumber,
              });
              return;
            }
            json(res, { error: "Ta rezerwacja została już przetworzona." }, 400);
            return;
          }
          if (e.message === "CONFLICT" || String(e.message || "").includes("CONFLICT")) {
            json(res, { error: "Termin został zajęty. Spróbuj wybrać inny czas lub skontaktuj się z lokalem." }, 409);
            return;
          }
          throw e;
        }

        await appendRestaurantAudit(db, {
          action: "restaurant_email_confirmed",
          reservationId,
          details: {},
        });

        json(res, {
          ok: true,
          status: "pending",
          reservationId,
          humanNumber: formatHumanReservationNumber(resData, "restaurant") || resData.humanNumber,
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

      if (req.method === "GET" && op === "admin-settings") {
        await ensureRestaurantDefaults(db);
        const settings = (await loadSettings(db)) || {};
        const activeTables = await loadBookableTables(db);
        settings.tableCount = activeTables.length;
        json(res, { settings });
        return;
      }

      if (req.method === "PUT" && op === "admin-settings-save") {
        const body = typeof req.body === "object" && req.body ? req.body : JSON.parse(req.body || "{}");
        const {
          maxGuestsPerTable,
          reservationOpenTime,
          reservationCloseTime,
          timeSlotMinutes,
        } = body;
        const openTime = String(reservationOpenTime || "12:00").trim();
        const closeTime = String(reservationCloseTime || "22:00").trim();
        const openMinutes = parseTimeToMinutes(openTime);
        const closeMinutes = parseTimeToMinutes(closeTime);
        if (openMinutes == null || closeMinutes == null) {
          json(res, { error: "Godziny muszą być podane w formacie HH:MM." }, 400);
          return;
        }
        if (openMinutes > closeMinutes) {
          json(res, { error: "Godzina otwarcia nie może być później niż godzina zamknięcia." }, 400);
          return;
        }
        const activeTables = await loadBookableTables(db);
        const tc = activeTables.length;
        await db.collection("restaurantSettings").doc("default").set(
          {
            tableCount: tc,
            maxGuestsPerTable: Math.max(1, Math.min(50, Number(maxGuestsPerTable || 4))),
            reservationOpenTime: openTime,
            reservationCloseTime: closeTime,
            timeSlotMinutes: [15, 30, 60].includes(Number(timeSlotMinutes)) ? Number(timeSlotMinutes) : 30,
            updatedAt: FieldValue.serverTimestamp(),
            updatedBy: adminUser.email,
          },
          { merge: true }
        );
        await appendRestaurantAudit(db, {
          action: "restaurant_settings_save",
          actorEmail: adminUser.email,
          details: { tableCount: tc },
        });
        json(res, { ok: true, warnings: [] });
        return;
      }

      if (req.method === "GET" && op === "admin-tables-list") {
        await ensureRestaurantDefaults(db);
        const tables = await loadBookableTables(db);
        json(res, { tables });
        return;
      }

      if (req.method === "POST" && op === "admin-table-create") {
        const created = await createOrRestoreRestaurantTable(db, adminUser.email);
        await appendRestaurantAudit(db, {
          action: "restaurant_table_create",
          actorEmail: adminUser.email,
          details: {
            id: created.table.id,
            number: created.table.number,
            restored: created.restored,
          },
        });
        json(res, { ok: true, table: created.table, restored: created.restored });
        return;
      }

      if ((req.method === "DELETE" || req.method === "POST") && op === "admin-table-delete") {
        const body = typeof req.body === "object" && req.body ? req.body : JSON.parse(req.body || "{}");
        const tableId = String(body.id || "").trim();
        if (!tableId) {
          json(res, { error: "Brak id stolika." }, 400);
          return;
        }
        const removed = await removeRestaurantTable(db, tableId, adminUser.email);
        await appendRestaurantAudit(db, {
          action: "restaurant_table_delete",
          actorEmail: adminUser.email,
          details: {
            id: removed.id,
            number: removed.number,
          },
        });
        json(res, { ok: true, table: removed });
        return;
      }

      if (req.method === "GET" && op === "admin-reservations-list") {
        const status = url.searchParams.get("status") || "all";
        let query = db.collection("restaurantReservations").orderBy("createdAt", "desc").limit(250);
        if (status === "active") {
          query = db
            .collection("restaurantReservations")
            .where("status", "in", ["pending", "confirmed"])
            .orderBy("createdAt", "desc")
            .limit(250);
        } else if (status && status !== "all") {
          query = db
            .collection("restaurantReservations")
            .where("status", "==", status)
            .orderBy("createdAt", "desc")
            .limit(250);
        }
        const snap = await query.get().catch(async () => db.collection("restaurantReservations").limit(250).get());
        const tableMap = await loadTablesMap(db);
        const rows = [];
        for (const d of snap.docs) {
          const x = { id: d.id, ...d.data() };
          rows.push(formatRestaurantRow(x, tableMap));
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
        const tableMap = await loadTablesMap(db);
        json(res, { reservation: formatRestaurantRow(r, tableMap) });
        return;
      }

      if (req.method === "PATCH" && op === "admin-reservation-update") {
        const body = typeof req.body === "object" && req.body ? req.body : JSON.parse(req.body || "{}");
        const {
          id,
          adminNote,
          fullName,
          customerNote,
          reservationDate,
          startTime,
          durationHours,
          tablesCount,
          guestsCount,
          joinTables,
          assignedTableIds,
        } = body;
        if (!id) {
          json(res, { error: "Brak id." }, 400);
          return;
        }
        const before = await getReservation(db, id);
        if (!before) {
          json(res, { error: "Nie znaleziono." }, 404);
          return;
        }
        const ref = db.collection("restaurantReservations").doc(id);
        const settings = await loadSettings(db);
        const maxG = Number(settings?.maxGuestsPerTable || 4);

        const needsTimeChange =
          reservationDate || startTime || durationHours || tablesCount || (assignedTableIds && assignedTableIds.length);
        if (needsTimeChange && (before.status === "pending" || before.status === "confirmed")) {
          const rd = reservationDate || before.reservationDate;
          const st = startTime || before.startTime;
          const dur = Number(durationHours || before.durationHours);
          const tc = Number(tablesCount || before.tablesCount);
          const gc = Number(guestsCount != null ? guestsCount : before.guestsCount);
          if (gc > tc * maxG) {
            json(res, { error: `Maksymalnie ${tc * maxG} gości.` }, 400);
            return;
          }
          const { startMs, endMs } = computeWindowMs(rd, st, dur);
          assertNotPast(startMs);
          assertReservationWindowInSettings(settings, startMs, endMs);

          let tableIds = assignedTableIds;
          if (!tableIds || !tableIds.length) {
            const alloc = await findAvailableTableIds(db, {
              startMs,
              endMs,
              tablesNeeded: tc,
              joinTables: joinTables != null ? Boolean(joinTables) : before.joinTables,
              excludeReservationId: id,
            });
            if (!alloc.ok) {
              json(res, { error: "Brak wolnych stolików / konflikt terminu." }, 409);
              return;
            }
            tableIds = alloc.tableIds;
          } else {
            if (!Array.isArray(tableIds) || tableIds.length !== tc) {
              json(res, { error: "Lista stolików musi mieć tyle pozycji, ile wybrano stolików." }, 400);
              return;
            }
            const conflictCheck = await verifyManualTablesFree(db, tableIds, startMs, endMs, id);
            if (!conflictCheck.ok) {
              json(res, { error: conflictCheck.error || "Konflikt stolików." }, 409);
              return;
            }
          }

          await db.runTransaction(async (tx) => {
            const s = await tx.get(ref);
            const cur = s.data();
            if (!cur) {
              throw new Error("missing");
            }
            await replaceTableLocksInTransaction(tx, db, {
              reservationId: id,
              tableIds,
              startMs,
              endMs,
            });
            tx.update(ref, {
              fullName: fullName !== undefined ? String(fullName).trim() : cur.fullName,
              customerNote: customerNote !== undefined ? String(customerNote).trim() : cur.customerNote,
              adminNote: adminNote !== undefined ? String(adminNote).trim() : cur.adminNote,
              reservationDate: rd,
              startTime: st,
              durationHours: dur,
              startDateTime: Timestamp.fromMillis(startMs),
              endDateTime: Timestamp.fromMillis(endMs),
              startMs,
              endMs,
              tablesCount: tc,
              guestsCount: gc,
              joinTables: joinTables != null ? Boolean(joinTables) : cur.joinTables,
              assignedTableIds: tableIds,
              updatedAt: FieldValue.serverTimestamp(),
              updatedBy: adminUser.email,
            });
          });
        } else {
          await ref.update({
            adminNote: adminNote !== undefined ? String(adminNote) : before.adminNote,
            fullName: fullName !== undefined ? String(fullName).trim() : before.fullName,
            customerNote: customerNote !== undefined ? String(customerNote).trim() : before.customerNote,
            updatedAt: FieldValue.serverTimestamp(),
            updatedBy: adminUser.email,
          });
        }

        await appendRestaurantAudit(db, {
          action: "restaurant_reservation_update",
          reservationId: id,
          actorEmail: adminUser.email,
        });
        json(res, { ok: true });
        return;
      }

      if (req.method === "POST" && op === "admin-reservation-create") {
        const body = typeof req.body === "object" && req.body ? req.body : JSON.parse(req.body || "{}");
        const {
          reservationDate,
          startTime,
          durationHours,
          tablesCount,
          guestsCount,
          joinTables,
          fullName,
          email,
          phonePrefix,
          phoneNational,
          customerNote,
          adminNote,
          status: targetStatus,
          assignedTableIds: manualTables,
        } = body;

        await ensureRestaurantDefaults(db);
        const settings = await loadSettings(db);
        const maxG = Number(settings?.maxGuestsPerTable || 4);
        const tc = Number(tablesCount || 1);
        const gc = Number(guestsCount || 1);
        if (gc > tc * maxG) {
          json(res, { error: `Maksymalnie ${tc * maxG} gości.` }, 400);
          return;
        }
        const phoneE164 = validatePhone(phonePrefix, phoneNational);
        if (!phoneE164) {
          json(res, { error: "Telefon nieprawidłowy." }, 400);
          return;
        }
        const { startMs, endMs } = computeWindowMs(reservationDate, startTime, durationHours);
        assertNotPast(startMs);
        assertReservationWindowInSettings(settings, startMs, endMs);

        let tableIds = manualTables;
        if (!tableIds?.length) {
          const alloc = await findAvailableTableIds(db, {
            startMs,
            endMs,
            tablesNeeded: tc,
            joinTables: Boolean(joinTables),
            excludeReservationId: null,
          });
          if (!alloc.ok) {
            json(res, { error: "Termin zajęty lub brak stolików." }, 409);
            return;
          }
          tableIds = alloc.tableIds;
        } else {
          const ok = await verifyManualTablesFree(db, tableIds, startMs, endMs, null);
          if (!ok.ok) {
            json(res, { error: ok.error || "Konflikt." }, 409);
            return;
          }
        }

        const st = targetStatus === "confirmed" ? "confirmed" : "pending";
        const humanNumber = await allocateRestaurantNumber(db);
        const resRef = db.collection("restaurantReservations").doc();
        const dur = Number(durationHours);
        const pendingUntil = Timestamp.fromMillis(Date.now() + RESTAURANT_PENDING_MS);

        const reservationPayload = {
          humanNumber,
          status: st,
          fullName: String(fullName || "").trim(),
          email: String(email || "").trim().toLowerCase(),
          phonePrefix: String(phonePrefix || "").trim(),
          phoneNational: String(phoneNational || "").replace(/[^\d]/g, ""),
          phoneE164,
          guestsCount: gc,
          tablesCount: tc,
          joinTables: Boolean(joinTables),
          customerNote: String(customerNote || "").trim(),
          adminNote: String(adminNote || "").trim(),
          reservationDate: String(reservationDate).trim(),
          startTime: String(startTime).trim(),
          durationHours: dur,
          startDateTime: Timestamp.fromMillis(startMs),
          endDateTime: Timestamp.fromMillis(endMs),
          startMs,
          endMs,
          cleanupBufferMinutes: cleanupBufferMinutes(),
          assignedTableIds: tableIds,
          confirmationTokenHash: null,
          emailVerificationExpiresAt: null,
          pendingExpiresAt: st === "pending" ? pendingUntil : null,
          createdAt: FieldValue.serverTimestamp(),
          updatedAt: FieldValue.serverTimestamp(),
          source: "admin_manual",
          createdBy: adminUser.email,
        };

        await db.runTransaction(async (tx) => {
          await setReservationAndTableLocksInTransaction(tx, db, {
            resRef,
            reservationPayload,
            tableIds,
            startMs,
            endMs,
          });
        });

        const r0 = await getReservation(db, resRef.id);
        const tableMap = await loadTablesMap(db);
        const vars = buildRestaurantMailVars({ ...r0, id: resRef.id }, tableMap, {});
        if (st === "confirmed") {
          await sendRestaurantTemplated(db, "restaurant_confirmed_client", vars.email, vars);
        }
        await appendRestaurantAudit(db, {
          action: "restaurant_manual_create",
          reservationId: resRef.id,
          actorEmail: adminUser.email,
        });
        json(res, { ok: true, reservationId: resRef.id, humanNumber });
        return;
      }

      if (req.method === "POST" && op === "admin-reservation-confirm") {
        const body = typeof req.body === "object" && req.body ? req.body : JSON.parse(req.body || "{}");
        const { id } = body;
        const before = await getReservation(db, id);
        if (!before || before.status !== "pending") {
          json(res, { error: "Tylko status „oczekujące” można potwierdzić." }, 400);
          return;
        }
        await db.collection("restaurantReservations").doc(id).update({
          status: "confirmed",
          pendingExpiresAt: FieldValue.delete(),
          updatedAt: FieldValue.serverTimestamp(),
          updatedBy: adminUser.email,
        });
        const tableMap = await loadTablesMap(db);
        const vars = buildRestaurantMailVars({ ...before, id, status: "confirmed" }, tableMap, {});
        if (before.email) {
          await sendRestaurantTemplated(db, "restaurant_confirmed_client", vars.email, vars);
        }
        await appendRestaurantAudit(db, {
          action: "restaurant_confirmed",
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
        if (!["pending", "confirmed", "email_verification_pending"].includes(String(before.status || "").trim())) {
          json(res, { error: "Nie można anulować tego statusu." }, 400);
          return;
        }
        const reservationEndMs = before.endDateTime?.toMillis?.() || Number(before.endMs || 0);
        if (reservationEndMs && reservationEndMs <= Date.now()) {
          json(res, { error: "Nie można odwołać rezerwacji, która już minęła." }, 400);
          return;
        }
        await releaseLocksForReservation(db, id);
        await db.collection("restaurantReservations").doc(id).update({
          status: "cancelled",
          pendingExpiresAt: FieldValue.delete(),
          emailVerificationExpiresAt: FieldValue.delete(),
          updatedAt: FieldValue.serverTimestamp(),
          updatedBy: adminUser.email,
        });
        const tableMap = await loadTablesMap(db);
        const vars = buildRestaurantMailVars({ ...before, id, status: "cancelled" }, tableMap, {});
        if (before.email) {
          await sendRestaurantTemplated(db, "restaurant_cancelled_client", vars.email, vars);
        }
        await appendRestaurantAudit(db, {
          action: "restaurant_cancelled",
          reservationId: id,
          actorEmail: adminUser.email,
        });
        json(res, { ok: true });
        return;
      }

      if (req.method === "POST" && op === "admin-manual-block") {
        const body = typeof req.body === "object" && req.body ? req.body : JSON.parse(req.body || "{}");
        const { reservationDate, startTime, endTime, tableIds, note } = body;
        if (!Array.isArray(tableIds) || !tableIds.length) {
          json(res, { error: "Podaj stoliki." }, 400);
          return;
        }
        const start = warsawFromParts(reservationDate, startTime);
        const end = warsawFromParts(reservationDate, endTime);
        if (!start || !end || end <= start) {
          json(res, { error: "Nieprawidłowy zakres czasu." }, 400);
          return;
        }
        const startMs = start.toMillis();
        const endMs = end.toMillis();
        const ok = await verifyManualTablesFree(db, tableIds, startMs, endMs, null);
        if (!ok.ok) {
          json(res, { error: ok.error || "Konflikt." }, 409);
          return;
        }
        const humanNumber = await allocateRestaurantNumber(db);
        const resRef = db.collection("restaurantReservations").doc();
        const durH = (endMs - startMs) / (60 * 60 * 1000);

        const reservationPayload = {
          humanNumber,
          status: "manual_block",
          fullName: "Blokada stolików",
          email: "",
          phonePrefix: "",
          phoneNational: "",
          phoneE164: "",
          guestsCount: 0,
          tablesCount: tableIds.length,
          joinTables: false,
          customerNote: "",
          adminNote: String(note || "").slice(0, 2000),
          reservationDate: String(reservationDate),
          startTime: String(startTime),
          durationHours: Math.ceil(durH * 100) / 100,
          startDateTime: Timestamp.fromMillis(startMs),
          endDateTime: Timestamp.fromMillis(endMs),
          startMs,
          endMs,
          cleanupBufferMinutes: cleanupBufferMinutes(),
          assignedTableIds: tableIds,
          createdAt: FieldValue.serverTimestamp(),
          updatedAt: FieldValue.serverTimestamp(),
          source: "admin_block",
          createdBy: adminUser.email,
        };

        await db.runTransaction(async (tx) => {
          await setReservationAndTableLocksInTransaction(tx, db, {
            resRef,
            reservationPayload,
            tableIds,
            startMs,
            endMs,
          });
        });

        await appendRestaurantAudit(db, {
          action: "restaurant_manual_block",
          reservationId: resRef.id,
          actorEmail: adminUser.email,
        });
        json(res, { ok: true, reservationId: resRef.id });
        return;
      }

      if (req.method === "GET" && op === "admin-mail-templates") {
        const keys = Object.keys(require("./lib/mail").RESTAURANT_DEFAULT_TEMPLATES);
        const out = {};
        for (const k of keys) {
          out[k] = await getRestaurantMailTemplate(db, k);
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
        await db.collection("restaurantMailTemplates").doc(key).set(
          {
            subject: String(subject || ""),
            bodyHtml: String(bodyHtml || ""),
            updatedAt: FieldValue.serverTimestamp(),
            updatedBy: adminUser.email,
          },
          { merge: true }
        );
        await appendRestaurantAudit(db, {
          action: "restaurant_mail_template_save",
          actorEmail: adminUser.email,
          details: { key },
        });
        json(res, { ok: true });
        return;
      }

      if (req.method === "GET" && op === "admin-catering-recipients-list") {
        const recipients = await listCateringRecipientsFirestore(db);
        json(res, { recipients });
        return;
      }

      if (req.method === "PUT" && op === "admin-catering-recipient-save") {
        const body = typeof req.body === "object" && req.body ? req.body : JSON.parse(req.body || "{}");
        const displayName = String(body.displayName || "").trim();
        if (!displayName) {
          json(res, { error: "Podaj nazwę odbiorcy." }, 400);
          return;
        }
        const email = String(body.email || "").trim().toLowerCase();
        if (!email.includes("@")) {
          json(res, { error: "Podaj prawidłowy e-mail odbiorcy." }, 400);
          return;
        }
        const phoneE164 = validatePhone(body.phonePrefix, body.phoneNational);
        if (!phoneE164) {
          json(res, { error: "Podaj prawidłowy numer telefonu." }, 400);
          return;
        }
        const id = String(body.id || "").trim() || randomUUID();
        const payload = {
          displayName: displayName.slice(0, 200),
          contactFirstName: String(body.contactFirstName || "").trim().slice(0, 80),
          contactLastName: String(body.contactLastName || "").trim().slice(0, 80),
          email: email.slice(0, 180),
          phonePrefix: String(body.phonePrefix || "+48").trim().slice(0, 8),
          phoneNational: String(body.phoneNational || "").replace(/[^\d]/g, "").slice(0, 32),
          phoneE164,
          street: String(body.street || "").trim().slice(0, 200),
          buildingNumber: String(body.buildingNumber || "").trim().slice(0, 80),
          postalCode: String(body.postalCode || "").trim().slice(0, 16),
          city: String(body.city || "").trim().slice(0, 120),
          extraInfo: String(body.extraInfo || "").trim().slice(0, 2000),
          updatedAt: FieldValue.serverTimestamp(),
          updatedBy: adminUser.email,
        };
        const ref = db.collection("cateringRecipients").doc(id);
        const existing = await ref.get();
        if (!existing.exists) {
          payload.createdAt = FieldValue.serverTimestamp();
          payload.createdBy = adminUser.email;
        }
        await ref.set(payload, { merge: true });
        const saved = await ref.get();
        await appendRestaurantAudit(db, {
          action: "catering_recipient_save",
          actorEmail: adminUser.email,
          details: { id },
        });
        json(res, { ok: true, recipient: mapCateringRecipientDoc(saved.id, saved.data()) });
        return;
      }

      if ((req.method === "DELETE" || req.method === "POST") && op === "admin-catering-recipient-delete") {
        const body = typeof req.body === "object" && req.body ? req.body : JSON.parse(req.body || "{}");
        const id = String(body.id || url.searchParams.get("id") || "").trim();
        if (!id) {
          json(res, { error: "Brak id odbiorcy." }, 400);
          return;
        }
        const blockMsg = await assertCateringRecipientDeletableFirestore(db, id);
        if (blockMsg) {
          json(res, { error: blockMsg }, 409);
          return;
        }
        await db.collection("cateringRecipients").doc(id).delete();
        await appendRestaurantAudit(db, {
          action: "catering_recipient_delete",
          actorEmail: adminUser.email,
          details: { id },
        });
        json(res, { ok: true });
        return;
      }

      if (req.method === "POST" && op === "admin-catering-delivery-create") {
        const body = typeof req.body === "object" && req.body ? req.body : JSON.parse(req.body || "{}");
        const recipientId = String(body.recipientId || "").trim();
        if (!recipientId) {
          json(res, { error: "Wybierz odbiorcę." }, 400);
          return;
        }
        const recSnap = await db.collection("cateringRecipients").doc(recipientId).get();
        if (!recSnap.exists) {
          json(res, { error: "Nie znaleziono odbiorcy." }, 400);
          return;
        }
        const rec = recSnap.data();
        const startTime = String(body.startTime || "").trim();
        const durationHours = Number(body.durationHours);
        if (!Number.isFinite(durationHours) || durationHours <= 0) {
          json(res, { error: "Nieprawidłowy czas trwania." }, 400);
          return;
        }
        const repeatModeRaw = String(body.repeatMode || "none").toLowerCase();
        if (
          repeatModeRaw &&
          repeatModeRaw !== "none" &&
          !body.repeatIndefinite &&
          !String(body.repeatUntil || "").trim()
        ) {
          json(res, { error: "Podaj datę końca powtarzania albo zaznacz „bezterminowo”." }, 400);
          return;
        }
        let dates;
        try {
          dates = expandCateringRepeatDatesFirebase(
            String(body.reservationDate || "").trim(),
            body.repeatMode,
            Number(body.repeatWeekday),
            body.repeatUntil,
            {
              repeatIndefinite: Boolean(body.repeatIndefinite),
              repeatWeekdays: Array.isArray(body.repeatWeekdays) ? body.repeatWeekdays : [],
            }
          );
        } catch (e) {
          json(res, { error: e.message || "Nieprawidłowe daty." }, 400);
          return;
        }
        const description = String(body.description || "").trim().slice(0, 2000);
        const adminNote = String(body.adminNote || "").trim().slice(0, 2000);
        const stRaw = String(body.status || "confirmed").trim();
        const st = stRaw === "pending" ? "pending" : "confirmed";
        const phoneE164 = validatePhone(rec.phonePrefix, rec.phoneNational);
        if (!phoneE164) {
          json(res, { error: "U odbiorcy zapisany jest nieprawidłowy telefon — popraw kartę odbiorcy." }, 400);
          return;
        }
        const createdIds = [];
        for (const reservationDate of dates) {
          let startMs;
          let endMs;
          try {
            ({ startMs, endMs } = computeWindowMs(reservationDate, startTime, durationHours));
          } catch (e) {
            json(res, { error: e.message || "Nieprawidłowa data lub godzina." }, 400);
            return;
          }
          try {
            assertNotPast(startMs);
          } catch (e) {
            json(res, { error: e.message || "Termin w przeszłości." }, 400);
            return;
          }
          const humanNumber = await allocateRestaurantNumber(db);
          const resRef = db.collection("restaurantReservations").doc();
          const pendingUntil = Timestamp.fromMillis(Date.now() + RESTAURANT_PENDING_MS);
          const reservationPayload = {
            humanNumber,
            status: st,
            cateringDelivery: true,
            recipientId,
            fullName: String(rec.displayName || "").trim(),
            email: String(rec.email || "").trim().toLowerCase(),
            phonePrefix: String(rec.phonePrefix || "+48").trim(),
            phoneNational: String(rec.phoneNational || "").replace(/[^\d]/g, ""),
            phoneE164,
            guestsCount: 1,
            tablesCount: 1,
            joinTables: false,
            placePreference: "no_preference",
            customerNote: description,
            adminNote,
            reservationDate,
            startTime,
            durationHours,
            startDateTime: Timestamp.fromMillis(startMs),
            endDateTime: Timestamp.fromMillis(endMs),
            startMs,
            endMs,
            cleanupBufferMinutes: cleanupBufferMinutes(),
            assignedTableIds: [],
            confirmationTokenHash: null,
            emailVerificationExpiresAt: null,
            pendingExpiresAt: st === "pending" ? pendingUntil : null,
            createdAt: FieldValue.serverTimestamp(),
            updatedAt: FieldValue.serverTimestamp(),
            source: "admin_catering_delivery",
            createdBy: adminUser.email,
          };
          await db.runTransaction(async (tx) => {
            await setReservationAndTableLocksInTransaction(tx, db, {
              resRef,
              reservationPayload,
              tableIds: [],
              startMs,
              endMs,
            });
          });
          createdIds.push(resRef.id);
        }
        await appendRestaurantAudit(db, {
          action: "catering_delivery_create",
          actorEmail: adminUser.email,
          details: { count: createdIds.length, recipientId },
        });
        json(res, { ok: true, reservationIds: createdIds, count: createdIds.length });
        return;
      }

      json(res, { error: "Nieznana operacja. Użyj parametru ?op=..." }, 404);
    } catch (err) {
      console.error(err);
      const msg =
        err.message && String(err.message).includes("CONFLICT")
          ? err.message.replace(/^CONFLICT:\s*/, "")
          : err.message || "Błąd serwera.";
      const code = msg.includes("CONFLICT") || err.message?.includes("CONFLICT") ? 409 : 500;
      json(res, { error: msg }, code);
    }
  }
);

function filterBookableForPublic(list) {
  return list.filter((t) => t.active !== false && t.hidden !== true);
}

function buildTimeSlots(openStr, closeStr, stepMin) {
  const m0 = parseTimeToMinutes(openStr);
  const m1 = parseTimeToMinutes(closeStr);
  if (m0 == null || m1 == null || m0 >= m1) {
    return [];
  }
  const out = [];
  for (let m = m0; m < m1; m += stepMin) {
    const h = Math.floor(m / 60);
    const mm = m % 60;
    out.push(`${String(h).padStart(2, "0")}:${String(mm).padStart(2, "0")}`);
  }
  return out;
}

function parseTimeToMinutes(value) {
  const match = String(value || "").trim().match(/^([01]\d|2[0-3]):([0-5]\d)$/);
  if (!match) {
    return null;
  }
  return Number(match[1]) * 60 + Number(match[2]);
}

async function verifyManualTablesFree(db, tableIds, startMs, endMs, excludeReservationId) {
  const { isTableFree, blockEndMsFromEnd } = require("./lib/restaurantLogic");
  const blockEnd = blockEndMsFromEnd(endMs);
  for (const tid of tableIds) {
    const free = await isTableFree(db, tid, startMs, blockEnd, excludeReservationId);
    if (!free) {
      return { ok: false, error: `Stół ${tid} jest zajęty w tym czasie.` };
    }
  }
  return { ok: true };
}

module.exports = { restaurantApi };
